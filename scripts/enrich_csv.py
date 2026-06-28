#!/usr/bin/env python3
"""
CSVリストを住所・座標・最寄駅まで一括で enrich する。

処理順:
  1. いいオフィス: e-office.space JSON-LD から公式データ取得
  2. Geocoding: 残りの住所/施設名から座標取得
  3. fill_address: 座標のみの行に逆ジオコーディングで住所補完
  4. fill_station: 最寄駅を推定

使い方:
  python3 scripts/enrich_csv.py --input docs/phone_booth_telework_box_list_0628.csv
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = Path(__file__).resolve().parent


def run_step(label: str, cmd: list[str]) -> None:
    print(f"\n=== {label} ===")
    print(" ", " ".join(cmd))
    result = subprocess.run(cmd, cwd=ROOT)
    if result.returncode != 0:
        raise SystemExit(f"{label} が失敗しました (exit {result.returncode})")


def main() -> int:
    parser = argparse.ArgumentParser(description="Enrich phone booth CSV end-to-end")
    parser.add_argument(
        "--input",
        type=Path,
        default=ROOT / "docs" / "phone_booth_telework_box_list_0628.csv",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=ROOT / "docs" / "phone_booth_telework_box_list_0628_enriched.csv",
    )
    parser.add_argument("--skip-eoffice", action="store_true")
    parser.add_argument("--skip-station", action="store_true")
    args = parser.parse_args()

    if not args.input.exists():
        print(f"入力ファイルが見つかりません: {args.input}", file=sys.stderr)
        return 1

    args.output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(args.input, args.output)
    print(f"出力先: {args.output}")

    suffix = args.output.stem
    geocode_cache = SCRIPTS / f".geocode_cache_{suffix}.json"
    reverse_cache = SCRIPTS / f".reverse_geocode_cache_{suffix}.json"
    station_cache = SCRIPTS / f".station_infer_cache_{suffix}.json"
    eoffice_cache = SCRIPTS / f".eoffice_cache_{suffix}.json"

    py = sys.executable

    if not args.skip_eoffice:
        run_step(
            "1. いいオフィス公式データ",
            [
                py,
                str(SCRIPTS / "enrich_eoffice.py"),
                "--input",
                str(args.output),
                "--output",
                str(args.output),
                "--cache",
                str(eoffice_cache),
            ],
        )

    run_step(
        "2. Geocoding（座標取得）",
        [
            py,
            str(SCRIPTS / "geocode.py"),
            "--input",
            str(args.output),
            "--output",
            str(args.output),
            "--cache",
            str(geocode_cache),
            "--skip-existing",
        ],
    )

    run_step(
        "3. 住所補完（Reverse Geocoding）",
        [
            py,
            str(SCRIPTS / "fill_address.py"),
            "--input",
            str(args.output),
            "--cache",
            str(reverse_cache),
        ],
    )

    if not args.skip_station:
        run_step(
            "4. 最寄駅推定",
            [
                py,
                str(SCRIPTS / "fill_station.py"),
                "--input",
                str(args.output),
                "--output",
                str(args.output),
                "--cache",
                str(station_cache),
                "--missing-label",
                "最寄り駅なし",
                "--far-distance-km",
                "30",
            ],
        )

    print(f"\n完了: {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
