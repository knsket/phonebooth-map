#!/usr/bin/env python3
"""
空の「最寄駅」を推定して補完する。

推定ロジック:
  1. 施設名/設置場所詳細/住所/ジオコード住所から「◯◯駅」「◯◯空港」を抽出
  2. 1で確信度が不足する場合のみ Google API で補完
     - Reverse Geocoding (result_type=train/subway/transit_station)
     - Places Nearby Search (type=train_station / subway_station)

使い方:
  python3 scripts/fill_station.py --dry-run
  python3 scripts/fill_station.py --limit 50 --dry-run
  python3 scripts/fill_station.py --limit 20
  python3 scripts/fill_station.py
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "docs" / "phone_booth_telework_box_list.csv"
DEFAULT_CACHE = Path(__file__).resolve().parent / ".station_infer_cache.json"

GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"
PLACES_NEARBY_URL = "https://maps.googleapis.com/maps/api/place/nearbysearch/json"

MISSING_MARKERS = {
    "",
    "-",
    "ー",
    "なし",
    "情報なし",
    "最寄駅なし",
    "最寄り駅なし",
    "最寄駅情報なし",
    "最寄り駅情報なし",
}

STATION_PATTERN = re.compile(r"([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー\-]{1,24}駅)")
AIRPORT_PATTERN = re.compile(r"([A-Za-z0-9\u3040-\u30ff\u3400-\u9fffー\-]{1,24}空港)")
STOPWORDS = {"最寄駅", "最寄り駅", "情報なし", "駅", "空港"}

TEXT_FIELD_WEIGHTS: list[tuple[str, str, int]] = [
    ("施設名", "name", 80),
    ("設置場所詳細", "details", 95),
    ("住所", "address", 55),
    ("ジオコード住所", "geocode_address", 45),
]


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def normalize_station_value(value: str) -> str:
    value = value.strip().replace("　", "").replace(" ", "")
    return value


def is_station_missing(value: str) -> bool:
    return normalize_station_value(value) in MISSING_MARKERS


def canonical_station_name(name: str) -> str:
    text = name.strip()
    text = text.replace("　", " ").strip(" /／・、,()（）")
    text = re.sub(r"^(?:JR|ＪＲ)\s*", "", text)
    text = re.sub(r"\s+", "", text)
    return text


def extract_station_tokens(text: str) -> list[str]:
    if not text:
        return []

    tokens: list[str] = []
    for m in STATION_PATTERN.findall(text):
        tokens.append(m)
    for m in AIRPORT_PATTERN.findall(text):
        tokens.append(m)

    unique: list[str] = []
    for token in tokens:
        cleaned = canonical_station_name(token)
        if not cleaned or cleaned in STOPWORDS:
            continue
        if len(cleaned) < 2:
            continue
        if cleaned not in unique:
            unique.append(cleaned)
    return unique


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    return fieldnames, rows


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def load_cache(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_cache(path: Path, cache: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def add_score(
    score_map: dict[str, int],
    source_map: dict[str, set[str]],
    station: str,
    score: int,
    source: str,
) -> None:
    if not station:
        return
    score_map[station] = score_map.get(station, 0) + score
    source_map.setdefault(station, set()).add(source)


def infer_from_text(row: dict[str, str]) -> tuple[dict[str, int], dict[str, set[str]]]:
    score_map: dict[str, int] = {}
    source_map: dict[str, set[str]] = {}

    for column, source, weight in TEXT_FIELD_WEIGHTS:
        text = row.get(column, "")
        tokens = extract_station_tokens(text)
        for index, token in enumerate(tokens):
            # 同じ欄に複数候補があるときは先頭候補をやや優先
            bonus = max(0, 10 - index * 3)
            add_score(score_map, source_map, token, weight + bonus, source)

    return score_map, source_map


def call_json_api(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "phonebooth-map-station-filler/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def reverse_geocode_station(lat: str, lng: str, api_key: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "latlng": f"{lat},{lng}",
            "key": api_key,
            "language": "ja",
            "result_type": "train_station|subway_station|transit_station",
        }
    )
    return call_json_api(f"{GEOCODE_URL}?{params}")


def nearby_station(lat: str, lng: str, api_key: str, station_type: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "location": f"{lat},{lng}",
            "rankby": "distance",
            "type": station_type,
            "language": "ja",
            "key": api_key,
        }
    )
    return call_json_api(f"{PLACES_NEARBY_URL}?{params}")


def extract_from_geocode_result(result: dict) -> list[str]:
    tokens: list[str] = []

    for component in result.get("address_components", []):
        types = set(component.get("types", []))
        if {"train_station", "subway_station", "transit_station"} & types:
            name = canonical_station_name(component.get("long_name", ""))
            if name:
                tokens.append(name)

    formatted = result.get("formatted_address", "")
    tokens.extend(extract_station_tokens(formatted))

    unique: list[str] = []
    for token in tokens:
        if token not in unique:
            unique.append(token)
    return unique


def infer_from_google(
    row: dict[str, str],
    api_key: str,
    cache: dict[str, dict],
    cache_path: Path,
    delay: float,
) -> tuple[dict[str, int], dict[str, set[str]], int]:
    lat = row.get("緯度", "").strip()
    lng = row.get("経度", "").strip()
    if not lat or not lng:
        return {}, {}, 0

    score_map: dict[str, int] = {}
    source_map: dict[str, set[str]] = {}
    api_calls = 0

    # Reverse geocoding
    rev_key = f"reverse:{lat},{lng}"
    if rev_key in cache:
        rev_payload = cache[rev_key]
    else:
        rev_payload = reverse_geocode_station(lat, lng, api_key)
        cache[rev_key] = rev_payload
        save_cache(cache_path, cache)
        api_calls += 1
        time.sleep(delay)

    if rev_payload.get("status") == "OK":
        for index, result in enumerate(rev_payload.get("results", [])[:3]):
            for token in extract_from_geocode_result(result):
                add_score(score_map, source_map, token, 52 - index * 8, "google_reverse")

    # Nearby search train/subway
    for station_type in ("train_station", "subway_station"):
        nb_key = f"nearby:{station_type}:{lat},{lng}"
        if nb_key in cache:
            nb_payload = cache[nb_key]
        else:
            nb_payload = nearby_station(lat, lng, api_key, station_type)
            cache[nb_key] = nb_payload
            save_cache(cache_path, cache)
            api_calls += 1
            time.sleep(delay)

        if nb_payload.get("status") != "OK":
            continue

        for index, place in enumerate(nb_payload.get("results", [])[:3]):
            name = place.get("name", "")
            vicinity = place.get("vicinity", "")
            tokens = extract_station_tokens(name) + extract_station_tokens(vicinity)
            for token in tokens:
                add_score(
                    score_map,
                    source_map,
                    token,
                    48 - index * 9,
                    f"google_nearby_{station_type}",
                )

    return score_map, source_map, api_calls


def pick_best_station(
    text_scores: dict[str, int],
    text_sources: dict[str, set[str]],
    google_scores: dict[str, int],
    google_sources: dict[str, set[str]],
) -> tuple[str, int, set[str]] | None:
    merged_scores: dict[str, int] = {}
    merged_sources: dict[str, set[str]] = {}

    all_keys = set(text_scores) | set(google_scores)
    for key in all_keys:
        score = text_scores.get(key, 0) + google_scores.get(key, 0)
        # テキスト抽出とGoogle推定が一致した候補は加点
        if key in text_scores and key in google_scores:
            score += 10
        merged_scores[key] = score
        merged_sources[key] = set()
        merged_sources[key].update(text_sources.get(key, set()))
        merged_sources[key].update(google_sources.get(key, set()))

    if not merged_scores:
        return None

    best_station = sorted(
        merged_scores.keys(),
        key=lambda k: (-merged_scores[k], len(k), k),
    )[0]
    return best_station, merged_scores[best_station], merged_sources[best_station]


def main() -> int:
    parser = argparse.ArgumentParser(description="Fill missing station names using text + Google APIs")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=None, help="省略時は入力ファイルを上書き")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--limit", type=int, default=0, help="処理件数上限（0=全件）")
    parser.add_argument("--delay", type=float, default=0.08, help="API呼び出し間隔（秒）")
    parser.add_argument("--min-score", type=int, default=70, help="このスコア以上を採用")
    parser.add_argument("--sample", type=int, default=12, help="ログ表示サンプル件数")
    parser.add_argument("--dry-run", action="store_true", help="書き込みせずに推定結果を表示")
    parser.add_argument(
        "--no-google",
        action="store_true",
        help="Google APIを使わずテキスト抽出のみで推定する",
    )
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()

    if not args.input.exists():
        print(f"入力ファイルが見つかりません: {args.input}", file=sys.stderr)
        return 1

    fieldnames, rows = read_csv(args.input)
    output_path = args.output or args.input

    targets = [row for row in rows if is_station_missing(row.get("最寄駅", ""))]
    if args.limit > 0:
        targets = targets[: args.limit]

    use_google = not args.no_google
    if use_google and not api_key:
        print("GOOGLE_MAPS_API_KEY が未設定のため Google API 補完をスキップします。")
        use_google = False

    cache = load_cache(args.cache)
    inferred = 0
    unresolved = 0
    api_calls = 0
    method_counts = {
        "text_only": 0,
        "google_only": 0,
        "text+google": 0,
        "low_confidence": 0,
        "no_candidate": 0,
    }
    samples: list[str] = []

    for index, row in enumerate(targets, start=1):
        text_scores, text_sources = infer_from_text(row)

        google_scores: dict[str, int] = {}
        google_sources: dict[str, set[str]] = {}
        best = pick_best_station(text_scores, text_sources, {}, {})

        # テキスト抽出で十分な確度がある場合はAPIを呼ばない（コスト削減）
        need_google = use_google and (best is None or best[1] < args.min_score)
        if need_google:
            g_scores, g_sources, new_calls = infer_from_google(row, api_key, cache, args.cache, args.delay)
            google_scores = g_scores
            google_sources = g_sources
            api_calls += new_calls

        best = pick_best_station(text_scores, text_sources, google_scores, google_sources)
        if not best:
            unresolved += 1
            method_counts["no_candidate"] += 1
            continue

        station, score, sources = best

        if score < args.min_score:
            unresolved += 1
            method_counts["low_confidence"] += 1
            if len(samples) < args.sample:
                samples.append(f"- [LOW {score}] {row.get('施設名','')} -> 候補: {station} / source={','.join(sorted(sources))}")
            continue

        has_text = any(s.startswith(("name", "details", "address", "geocode_address")) for s in sources)
        has_google = any(s.startswith("google_") for s in sources)
        if has_text and has_google:
            method_counts["text+google"] += 1
        elif has_text:
            method_counts["text_only"] += 1
        else:
            method_counts["google_only"] += 1

        if len(samples) < args.sample:
            samples.append(f"- [{score}] {row.get('施設名','')} -> {station} / source={','.join(sorted(sources))}")

        inferred += 1
        if not args.dry_run:
            row["最寄駅"] = station

        if index % 100 == 0 or index == len(targets):
            print(
                f"[{index}/{len(targets)}] inferred={inferred} unresolved={unresolved} api_calls={api_calls}"
            )
            if not args.dry_run:
                write_csv(output_path, fieldnames, rows)

    if not args.dry_run:
        write_csv(output_path, fieldnames, rows)

    print("=== 最寄駅補完サマリー ===")
    print(f"対象件数: {len(targets)}")
    print(f"補完成功: {inferred}")
    print(f"未補完: {unresolved}")
    print(f"Google API呼び出し: {api_calls}")
    print(
        "内訳: "
        f"text_only={method_counts['text_only']}, "
        f"text+google={method_counts['text+google']}, "
        f"google_only={method_counts['google_only']}, "
        f"low_confidence={method_counts['low_confidence']}, "
        f"no_candidate={method_counts['no_candidate']}"
    )
    print("--- サンプル ---")
    for line in samples:
        print(line)
    if args.dry_run:
        print("dry-run のためファイルは更新していません。")
    else:
        print(f"更新先: {output_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
