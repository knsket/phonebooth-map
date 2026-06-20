#!/usr/bin/env python3
"""
住所が空の行に、緯度・経度から逆ジオコーディングで住所を補完する。

優先順位:
  1. Reverse Geocoding API（座標から住所）
  2. 既存のジオコード住所（正規化）
  より詳細な方を採用する。

使い方:
  python3 scripts/fill_address.py --dry-run
  python3 scripts/fill_address.py --limit 10
  python3 scripts/fill_address.py
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
DEFAULT_CACHE = Path(__file__).resolve().parent / ".reverse_geocode_cache.json"
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"

RESULT_TYPE_PRIORITY = {
    "street_address": 6,
    "premise": 5,
    "subpremise": 4,
    "point_of_interest": 3,
    "establishment": 2,
    "route": 1,
}


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def normalize_address(text: str) -> str:
    text = text.strip()
    text = re.sub(r"^日本、\s*", "", text)
    text = re.sub(r"^〒[0-9]{3}-[0-9]{4}\s*", "", text)
    text = text.replace("−", "-").replace("–", "-").replace("—", "-")
    text = re.sub(r"\s+", "", text)
    text = re.sub(r"(?<=[0-9０-９\-])[A-Za-z].*$", "", text)
    text = re.sub(r"[A-Za-z].*$", "", text)
    text = re.sub(r"-+$", "", text)
    return text


def address_specificity(address: str) -> int:
    score = 0
    if "丁目" in address:
        score += 4
    if re.search(r"[0-9０-９]", address):
        score += 2
    if re.search(r"駅$", address):
        score -= 3
    if len(address) >= 12:
        score += 1
    return score


def pick_best_result(results: list[dict]) -> dict | None:
    if not results:
        return None

    def rank(result: dict) -> tuple[int, int]:
        types = result.get("types", [])
        type_score = max((RESULT_TYPE_PRIORITY.get(t, 0) for t in types), default=0)
        formatted = normalize_address(result.get("formatted_address", ""))
        return (type_score, address_specificity(formatted))

    return max(results, key=rank)


def reverse_geocode(lat: str, lng: str, api_key: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "latlng": f"{lat},{lng}",
            "key": api_key,
            "language": "ja",
            "result_type": "street_address|premise|subpremise|point_of_interest|establishment|route",
        }
    )
    url = f"{GEOCODE_URL}?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "phonebooth-map-geocoder/1.0"})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.loads(response.read().decode("utf-8"))


def load_cache(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_cache(path: Path, cache: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def choose_address(row: dict[str, str], reverse_result: dict | None) -> tuple[str, str]:
    geocode_address = normalize_address(row.get("ジオコード住所", ""))
    prefecture = row.get("都道府県", "").strip()

    candidates: list[tuple[str, str, int]] = []

    if geocode_address:
        candidates.append(("geocode", geocode_address, address_specificity(geocode_address)))

    if reverse_result:
        formatted = normalize_address(reverse_result.get("formatted_address", ""))
        if formatted:
            candidates.append(("reverse_geocode", formatted, address_specificity(formatted)))

    if not candidates:
        return "", "empty"

    candidates.sort(key=lambda item: item[2], reverse=True)
    source, address, _ = candidates[0]

    if prefecture and not address.startswith(prefecture):
        for src, addr, score in candidates:
            if addr.startswith(prefecture):
                return addr, src
        if geocode_address.startswith(prefecture):
            return geocode_address, "geocode"

    return address, source


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
    parser = argparse.ArgumentParser(description="Fill missing addresses via reverse geocoding")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--delay", type=float, default=0.05)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()

    fieldnames, rows = read_csv(args.input)
    targets = [r for r in rows if not r.get("住所", "").strip()]
    if args.limit > 0:
        targets = targets[: args.limit]

    if args.dry_run:
        print(f"対象: {len(targets)}件")
        for row in targets[:8]:
            geocode_address = normalize_address(row.get("ジオコード住所", ""))
            print(f"- {row['施設名'][:40]}")
            print(f"    現在のジオコード住所: {geocode_address[:60]}")
        return 0

    if not api_key:
        print("GOOGLE_MAPS_API_KEY が未設定です", file=sys.stderr)
        return 1

    cache = load_cache(args.cache)
    filled = 0
    api_calls = 0

    for index, row in enumerate(targets, start=1):
        lat = row.get("緯度", "").strip()
        lng = row.get("経度", "").strip()
        if not lat or not lng:
            continue

        cache_key = f"{lat},{lng}"
        if cache_key in cache:
            payload = cache[cache_key]
        else:
            try:
                payload = reverse_geocode(lat, lng, api_key)
                cache[cache_key] = payload
                save_cache(args.cache, cache)
                api_calls += 1
                time.sleep(args.delay)
            except urllib.error.URLError as exc:
                print(f"Network error: {exc}", file=sys.stderr)
                write_csv(args.input, fieldnames, rows)
                return 1

        reverse_result = pick_best_result(payload.get("results", []))
        address, source = choose_address(row, reverse_result)
        if address:
            row["住所"] = address
            filled += 1

        if index % 50 == 0 or index == len(targets):
            print(f"[{index}/{len(targets)}] filled={filled} api_calls={api_calls}")
            write_csv(args.input, fieldnames, rows)

    write_csv(args.input, fieldnames, rows)
    print(f"完了: 住所補完 {filled}/{len(targets)}件, API呼び出し {api_calls}回")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
