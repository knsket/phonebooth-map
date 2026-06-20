"""
Supabase Management API 経由で 任意のSQL(.sqlファイル)を実行する。

これは PostgREST(anon/service_role) では不可能な DDL(テーブル作成など)を
実行するためのもので、Personal Access Token (sbp_...) が必要。

前提(.env):
  EXPO_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
  SUPABASE_ACCESS_TOKEN=sbp_xxxxxxxx   # https://supabase.com/dashboard/account/tokens で発行

実行:
  python3 scripts/run_sql_supabase.py supabase/schema.sql
"""

import json
import os
import sys
import urllib.request
import urllib.error


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
    url = env.get("EXPO_PUBLIC_SUPABASE_URL", "").rstrip("/")
    token = env.get("SUPABASE_ACCESS_TOKEN", "")

    if not url or not token:
        print("ERROR: .env に EXPO_PUBLIC_SUPABASE_URL と SUPABASE_ACCESS_TOKEN を設定してください。")
        print("  トークン発行: https://supabase.com/dashboard/account/tokens")
        sys.exit(1)

    # https://<ref>.supabase.co から ref を取り出す
    ref = url.replace("https://", "").split(".")[0]

    sql_path = sys.argv[1] if len(sys.argv) > 1 else "supabase/schema.sql"
    if not os.path.exists(sql_path):
        print(f"ERROR: {sql_path} が見つかりません。")
        sys.exit(1)

    with open(sql_path, encoding="utf-8") as f:
        sql = f.read()

    endpoint = f"https://api.supabase.com/v1/projects/{ref}/database/query"
    data = json.dumps({"query": sql}).encode("utf-8")
    req = urllib.request.Request(
        endpoint,
        data=data,
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            # Cloudflare(error 1010)対策: 既定のPython-urllib UAは遮断されるため通常のUAを付与
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req) as res:
            body = res.read().decode("utf-8", "ignore")
        print(f"OK: {sql_path} を実行しました。")
        if body.strip():
            print(body)
    except urllib.error.HTTPError as e:
        print(f"ERROR {e.code}: {e.read().decode('utf-8', 'ignore')}")
        sys.exit(1)


if __name__ == "__main__":
    main()
