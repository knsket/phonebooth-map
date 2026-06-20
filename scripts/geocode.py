#!/usr/bin/env python3
"""
CSVの住所を Google Maps Geocoding API で緯度・経度に変換し、列を追記する。

使い方:
  cp .env.example .env   # APIキーを設定
  python3 scripts/geocode.py --dry-run          # クエリ確認のみ
  python3 scripts/geocode.py                    # 本実行（上書き保存）
  python3 scripts/geocode.py --limit 10         # 先頭10件のみテスト
  python3 scripts/geocode.py --output out.csv   # 別ファイルに出力
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_INPUT = ROOT / "docs" / "phone_booth_telework_box_list.csv"
DEFAULT_CACHE = Path(__file__).resolve().parent / ".geocode_cache.json"

NEW_COLUMNS = ["緯度", "経度", "ジオコード住所", "ジオコードステータス", "ジオコードクエリ"]
GEOCODE_URL = "https://maps.googleapis.com/maps/api/geocode/json"


def load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip())


def build_geocode_query(row: dict[str, str]) -> str:
    address = row.get("住所", "").strip()
    if address:
        return address

    prefecture = row.get("都道府県", "").strip()
    facility = row.get("施設名", "").strip()
    station = row.get("最寄駅", "").strip()

    if facility:
        return f"{prefecture}{facility}" if prefecture else facility
    if station:
        station_label = station if station.endswith("駅") else f"{station}駅"
        return f"{prefecture}{station_label}" if prefecture else station_label
    return ""


def load_cache(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def save_cache(path: Path, cache: dict[str, dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cache, ensure_ascii=False, indent=2), encoding="utf-8")


def geocode(query: str, api_key: str) -> dict:
    params = urllib.parse.urlencode(
        {
            "address": query,
            "key": api_key,
            "language": "ja",
            "region": "jp",
        }
    )
    url = f"{GEOCODE_URL}?{params}"
    request = urllib.request.Request(url, headers={"User-Agent": "phonebooth-map-geocoder/1.0"})

    with urllib.request.urlopen(request, timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    status = payload.get("status", "UNKNOWN")
    if status == "OK" and payload.get("results"):
        result = payload["results"][0]
        location = result["geometry"]["location"]
        return {
            "lat": str(location["lat"]),
            "lng": str(location["lng"]),
            "formatted_address": result.get("formatted_address", ""),
            "status": status,
        }

    return {
        "lat": "",
        "lng": "",
        "formatted_address": "",
        "status": status,
        "error_message": payload.get("error_message", ""),
    }


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        fieldnames = list(reader.fieldnames or [])
        rows = list(reader)
    return fieldnames, rows


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Geocode phone booth CSV addresses")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=None, help="省略時は入力ファイルを上書き")
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--limit", type=int, default=0, help="処理件数上限（0=全件）")
    parser.add_argument("--delay", type=float, default=0.1, help="API呼び出し間隔（秒）")
    parser.add_argument("--dry-run", action="store_true", help="APIを呼ばずクエリだけ表示")
    args = parser.parse_args()

    load_dotenv(ROOT / ".env")
    api_key = os.environ.get("GOOGLE_MAPS_API_KEY", "").strip()

    if not args.input.exists():
        print(f"入力ファイルが見つかりません: {args.input}", file=sys.stderr)
        return 1

    fieldnames, rows = read_csv(args.input)
    output_path = args.output or args.input

    for col in NEW_COLUMNS:
        if col not in fieldnames:
            fieldnames.append(col)

    target_rows = rows[: args.limit] if args.limit > 0 else rows
    cache = load_cache(args.cache)

    if args.dry_run:
        queries = [build_geocode_query(row) for row in target_rows]
        unique = sorted(set(queries))
        print(f"対象行数: {len(target_rows)}")
        print(f"ユニーククエリ数: {len(unique)}")
        print("--- サンプル（先頭5件） ---")
        for row in target_rows[:5]:
            print(f"- {build_geocode_query(row)}")
        return 0

    if not api_key:
        print("GOOGLE_MAPS_API_KEY が未設定です。", file=sys.stderr)
        print("1. cp .env.example .env", file=sys.stderr)
        print("2. .env に APIキーを記入", file=sys.stderr)
        print("3. python3 scripts/geocode.py --limit 5 でテスト", file=sys.stderr)
        return 1

    ok_count = 0
    fail_count = 0
    api_calls = 0

    for index, row in enumerate(target_rows, start=1):
        query = build_geocode_query(row)
        row["ジオコードクエリ"] = query

        if not query:
            row["ジオコードステータス"] = "EMPTY_QUERY"
            fail_count += 1
            continue

        if query in cache:
            result = cache[query]
        else:
            try:
                result = geocode(query, api_key)
                cache[query] = result
                save_cache(args.cache, cache)
                api_calls += 1
                time.sleep(args.delay)
            except urllib.error.HTTPError as exc:
                result = {"lat": "", "lng": "", "formatted_address": "", "status": f"HTTP_{exc.code}"}
                cache[query] = result
                save_cache(args.cache, cache)
                fail_count += 1
                print(f"[{index}/{len(target_rows)}] HTTP error: {query}", file=sys.stderr)
                continue
            except urllib.error.URLError as exc:
                print(f"Network error: {exc}", file=sys.stderr)
                save_cache(args.cache, cache)
                write_csv(output_path, fieldnames, rows)
                return 1

        row["緯度"] = result.get("lat", "")
        row["経度"] = result.get("lng", "")
        row["ジオコード住所"] = result.get("formatted_address", "")
        row["ジオコードステータス"] = result.get("status", "")

        if result.get("status") == "OK":
            ok_count += 1
        else:
            fail_count += 1

        if index % 25 == 0 or index == len(target_rows):
            print(f"[{index}/{len(target_rows)}] OK={ok_count} FAIL={fail_count} API calls={api_calls}")
            write_csv(output_path, fieldnames, rows)

    write_csv(output_path, fieldnames, rows)
    print(f"完了: {output_path}")
    print(f"成功 {ok_count} / 失敗 {fail_count} / 新規API呼び出し {api_calls}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
