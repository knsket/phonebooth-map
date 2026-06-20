#!/usr/bin/env python3
"""
住所なし行（767件）を Google Places Text Search API で再ジオコーディングする。

Geocoding API より POI 名（STATION BOOTH / CocoDesk 等）のヒット精度が高い。

使い方:
  python3 scripts/geocode_improve.py --dry-run
  python3 scripts/geocode_improve.py --limit 20
  python3 scripts/geocode_improve.py
"""

from __future__ import annotations

import argparse
import csv
import json
import math
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
DEFAULT_CACHE = Path(__file__).resolve().parent / ".places_cache.json"
PLACES_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"

METHOD_COLUMN = "ジオコード方法"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def normalize(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[（）()【】\[\]・/／\\|｜、,.．\s　]", "", text)
    text = text.replace("stationbooth", "stationbooth").replace("booth", "booth")
    return text


def extract_keywords(text: str) -> set[str]:
    cleaned = re.sub(r"[（）()].*?[）)]", "", text)
    parts = re.split(r"[\s　/／]+", cleaned)
    keywords: set[str] = set()
    for part in parts:
        part = part.strip()
        if len(part) >= 2:
            keywords.add(normalize(part))
        station = re.search(r"([\u4e00-\u9fff\u30a0-\u30ffA-Za-z0-9]+?)駅", part)
        if station:
            keywords.add(normalize(station.group(0)))
    return {k for k in keywords if len(k) >= 2}


def extract_station_name(text: str) -> str | None:
    match = re.search(r"([\u4e00-\u9fff\u30a0-\u30ffA-Za-z0-9]+?)駅", text)
    if match:
        return match.group(0)
    return None


def validate_place(row: dict[str, str], place: dict, score: int) -> bool:
    if score < 6:
        return False

    prefecture = row.get("都道府県", "").strip()
    formatted = place.get("formatted_address", "")
    if prefecture and prefecture not in formatted:
        return False

    facility = row.get("施設名", "")
    detail = row.get("設置場所詳細", "")
    station = extract_station_name(facility) or extract_station_name(detail) or extract_station_name(row.get("最寄駅", ""))
    place_text = normalize(f"{place.get('name', '')} {formatted}")

    if station and normalize(station) not in place_text:
        return False

    service = row.get("サービス名", "")
    if service in {"STATION BOOTH", "CocoDesk", "EXPRESS WORK-Booth", "EXPRESS WORK-Lounge"}:
        service_norm = normalize(service.replace("-", ""))
        place_norm = normalize(place.get("name", ""))
        if service_norm not in place_norm and normalize(facility) not in place_norm:
            return False

    return True


def score_place(row: dict[str, str], place: dict) -> int:
    facility = row.get("施設名", "")
    detail = row.get("設置場所詳細", "")
    service = row.get("サービス名", "")
    target_keywords = extract_keywords(f"{service} {facility} {detail}")
    place_text = normalize(
        f"{place.get('name', '')} {place.get('formatted_address', '')}"
    )
    score = 0
    for keyword in target_keywords:
        if keyword in place_text:
            score += 3
    if normalize(service) and normalize(service) in place_text:
        score += 5
    if normalize(facility) and normalize(facility) in place_text:
        score += 8
    station_match = re.search(r"([\u4e00-\u9fff\u30a0-\u30ffA-Za-z0-9]+?)駅", facility)
    if station_match and normalize(station_match.group(0)) in place_text:
        score += 4
    return score


def build_place_queries(row: dict[str, str]) -> list[str]:
    prefecture = row.get("都道府県", "").strip()
    service = row.get("サービス名", "").strip()
    facility = row.get("施設名", "").strip()
    detail = row.get("設置場所詳細", "").strip()
    station = row.get("最寄駅", "").strip()

    queries: list[str] = []
    if service and facility:
        queries.append(f"{service} {facility} {prefecture}")
        queries.append(f"{service} {facility}")
    if facility:
        queries.append(f"{facility} {prefecture}")
        queries.append(facility)
    if detail:
        queries.append(f"{detail} {prefecture}")
    if station:
        station_name = station if station.endswith("駅") else f"{station}駅"
        queries.append(f"{service} {station_name} {prefecture}".strip())

    seen: set[str] = set()
    unique: list[str] = []
    for query in queries:
        query = query.strip()
        if query and query not in seen:
            seen.add(query)
            unique.append(query)
    return unique


def haversine_m(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    radius = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlat = math.radians(lat2 - lat1)
    dlng = math.radians(lng2 - lng1)
    a = math.sin(dlat / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlng / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def load_cache(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_cache(path: Path, cache: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def places_search(query: str, api_key: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "query": query,
            "key": api_key,
            "language": "ja",
            "region": "jp",
        }
    )
    url = f"{PLACES_URL}?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "phonebooth-map-geocoder/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def find_best_place(
    row: dict[str, str],
    api_key: str,
    cache: dict[str, dict],
    cache_path: Path,
    delay: float,
) -> dict | None:
    for query in build_place_queries(row):
        if query in cache:
            cached = cache[query]
        else:
            payload = places_search(query, api_key)
            cached = {
                "status": payload.get("status", "UNKNOWN"),
                "results": payload.get("results", [])[:5],
                "error_message": payload.get("error_message", ""),
            }
            cache[query] = cached
            save_cache(cache_path, cache)
            time.sleep(delay)

        if cached["status"] not in {"OK", "ZERO_RESULTS"}:
            return {
                "status": cached["status"],
                "query": query,
                "error_message": cached.get("error_message", ""),
            }

        best = None
        best_score = 0
        for place in cached.get("results", []):
            score = score_place(row, place)
            if score > best_score:
                best_score = score
                best = place

        if best and validate_place(row, best, best_score):
            location = best["geometry"]["location"]
            return {
                "status": "OK",
                "query": query,
                "score": best_score,
                "lat": str(location["lat"]),
                "lng": str(location["lng"]),
                "formatted_address": best.get("formatted_address", ""),
                "place_name": best.get("name", ""),
                "place_id": best.get("place_id", ""),
            }

    return None


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


def main() -> int:
    parser = argparse.ArgumentParser(description="Improve geocoding for rows without address")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--delay", type=float, default=0.12)
    parser.add_argument("--min-move-m", type=float, default=30.0, help="更新する最小移動距離(m)")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()

    fieldnames, rows = read_csv(args.input)
    if METHOD_COLUMN not in fieldnames:
        fieldnames.append(METHOD_COLUMN)

    targets = [r for r in rows if not r.get("住所", "").strip()]
    if args.limit > 0:
        targets = targets[: args.limit]

    if args.dry_run:
        print(f"対象: {len(targets)}件（住所なし）")
        for row in targets[:8]:
            print(f"- {row['サービス名']} / {row['施設名']}")
            for query in build_place_queries(row)[:3]:
                print(f"    ? {query}")
        return 0

    if not api_key:
        print("GOOGLE_MAPS_API_KEY が未設定です", file=sys.stderr)
        return 1

    cache = load_cache(args.cache)
    updated = 0
    unchanged = 0
    failed = 0
    api_calls = 0
    cache_before = len(cache)

    for index, row in enumerate(targets, start=1):
        before_cache = len(cache)
        result = find_best_place(row, api_key, cache, args.cache, args.delay)
        api_calls += max(0, len(cache) - before_cache)

        if not result or result.get("status") != "OK":
            row[METHOD_COLUMN] = row.get(METHOD_COLUMN) or "geocoding"
            failed += 1
            continue

        old_lat = row.get("緯度", "")
        old_lng = row.get("経度", "")
        new_lat = float(result["lat"])
        new_lng = float(result["lng"])
        moved = 0.0
        if old_lat and old_lng:
            moved = haversine_m(float(old_lat), float(old_lng), new_lat, new_lng)

        if moved >= args.min_move_m or not old_lat:
            row["緯度"] = result["lat"]
            row["経度"] = result["lng"]
            row["ジオコード住所"] = result.get("formatted_address", "")
            row["ジオコードステータス"] = "OK"
            row["ジオコードクエリ"] = result["query"]
            row[METHOD_COLUMN] = "places"
            updated += 1
        else:
            row[METHOD_COLUMN] = row.get(METHOD_COLUMN) or "geocoding"
            unchanged += 1

        if index % 25 == 0 or index == len(targets):
            print(f"[{index}/{len(targets)}] updated={updated} unchanged={unchanged} failed={failed}")
            write_csv(args.input, fieldnames, rows)

    write_csv(args.input, fieldnames, rows)
    print(f"完了: updated={updated}, unchanged={unchanged}, failed={failed}, new_cache={len(cache)-cache_before}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
