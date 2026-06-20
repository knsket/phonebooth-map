"""
booths.json を Supabase の public.booths テーブルへ一括投入する。

前提:
  1. Supabase の SQL Editor で supabase/schema.sql を実行済み(booths テーブルが存在)
  2. .env に以下を設定
       EXPO_PUBLIC_SUPABASE_URL=...           (https://xxxx.supabase.co)
       SUPABASE_SERVICE_ROLE_KEY=...          (service_role キー / 公開厳禁)

実行:
  python3 scripts/upload_booths_to_supabase.py

PostgREST へ upsert(booth_id で重複マージ)する。標準ライブラリのみ使用。
"""

import json
import os
import sys
import urllib.request
import urllib.error

BATCH_SIZE = 500


def load_env(path=".env"):
    env = dict(os.environ)
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def main():
    env = load_env()
    base_url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    service_key = env.get("SUPABASE_SERVICE_ROLE_KEY", "")

    if not base_url or not service_key:
        print("ERROR: .env に EXPO_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください。")
        sys.exit(1)

    json_path = "src/data/booths.json"
    if not os.path.exists(json_path):
        print(f"ERROR: {json_path} が見つかりません。先に convert_csv_to_json.py を実行してください。")
        sys.exit(1)

    with open(json_path, encoding="utf-8") as f:
        booths = json.load(f)

    rows = []
    for b in booths:
        rows.append({
            "booth_id": str(b.get("id", "")),
            "brand": b.get("brand", ""),
            "company": b.get("company", ""),
            "name": b.get("name", ""),
            "prefecture": b.get("prefecture", ""),
            "address": b.get("address", ""),
            "station": b.get("station", ""),
            "details": b.get("details", ""),
            "hours": b.get("hours", ""),
            "count": b.get("count", ""),
            "price": b.get("price", ""),
            "url": b.get("url", ""),
            "latitude": b.get("latitude"),
            "longitude": b.get("longitude"),
        })

    endpoint = f"{base_url}/rest/v1/booths"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    total = 0
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        data = json.dumps(batch, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(endpoint, data=data, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(req) as res:
                res.read()
            total += len(batch)
            print(f"  upserted {total}/{len(rows)}")
        except urllib.error.HTTPError as e:
            print(f"ERROR {e.code}: {e.read().decode('utf-8', 'ignore')}")
            sys.exit(1)

    print(f"完了: {total} 件を Supabase の booths テーブルへ投入しました。")


if __name__ == "__main__":
    main()
