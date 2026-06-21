# phonebooth-map

日本全国のフォンブース・テレワークブースを地図で探せる iOS / Android アプリ（Expo）。

## アプリケーションの起動方法（Expo Go）

本プロジェクトは Expo SDK 52 を利用した React Native アプリケーションです。以下の手順でローカルで起動してUI/UX体験を確認できます。

### 1. 依存パッケージのインストール
プロジェクトのルートディレクトリで以下を実行します。
```bash
npm install
```

### 2. アプリの起動
開発サーバーを起動します。
```bash
npm run start
```
起動すると、ターミナルに QR コードが表示されます。

- **実機 (iOS / Android) で確認する場合**:
  スマートフォンに「Expo Go」アプリをインストールし、表示された QR コードをカメラ（または Expo Go アプリ内）でスキャンしてください。
- **Web ブラウザで確認する場合**:
  キーボードの `w` キーを押すと、PCのブラウザ上でフロントエンドの挙動を完全にテストできます（Web表示用の洗練されたインタラクティブ・モックマップが動作します）。
- **iOSシミュレータ / Androidエミュレータ**:
  それぞれ `i` キー、`a` キーを押して起動します。

---

## 主な機能

1. **マップ / リスト 切替表示**
   - 地図モード: 現在地周辺のブースをブランド別の色分けピンで表示（実際に画面に映っている範囲の件数も表示）。Web は Leaflet + OpenStreetMap、ネイティブは Google Maps。
   - リストモード: 現在地（または検索地点）から近い順にカード表示。
2. **検索・現在地**
   - 住所・駅名・施設名で検索。「現在地」ボタンで GPS 測位し地図/リストを追従。起動時にも現在地へ自動で寄せる（不許可時は東京駅）。
   - 地図には現在地（青い点＋「現在地」ラベル）を表示。
3. **ブランドフィルター**: STATION BOOTH / テレキューブ / CHATBOX / CocoDesk を色分け・件数つきで絞り込み。
4. **ブース詳細シート**: ピン/カードのタップで、見える範囲の中央へ寄せつつ詳細（営業時間・料金・最寄駅・設置詳細）を表示。
5. **プレミアム機能（サブスクリプション）** — 以下の2機能を課金でアンロック:
   - 🧭 **徒歩ルート案内**（現在地→ブースの歩行者ルートを地図に描画 / 外部Googleマップ徒歩ナビ）
   - 🔗 **予約ページへのリンク**（公式予約サイトを外部ブラウザで開く）
   - 未課金時はペイウォール（1ヶ月 ¥200 / 12ヶ月 ¥1,200）を表示。

---

## アーキテクチャ

| 層 | 採用技術 |
|---|---|
| アプリ | Expo SDK 52 / React Native / TypeScript |
| 地図(Web) | Leaflet + OpenStreetMap（iframe） |
| 地図(Native) | react-native-maps（Google Maps） |
| 徒歩ルーティング | Valhalla 歩行者ルーティング（失敗時は直線フォールバック） |
| バックエンド | Supabase（PostgreSQL + PostGIS / Edge Functions） |
| 課金 | サブスクリプション（端末の匿名ID。レシート検証は Edge Function） |

### ディレクトリ
- `App.tsx` — 画面本体
- `src/components/` — `BoothMap`（`.tsx`=Native / `.web.tsx`=Web）, `Paywall`
- `src/lib/` — `supabase`（クライアント）, `boothsRepo`（データ取得）, `subscription`（課金）, `device`（匿名ID）, `brands`（ブランド配色/除外）
- `supabase/` — `schema.sql`, `subscriptions_rpc.sql`, `functions/verify-receipt/`
- `scripts/` — CSV→JSON変換、Supabaseへのデータ投入・SQL実行

---

## データ

- `docs/phone_booth_telework_box_list.csv` — 施設マスタ
- `src/data/booths.json` — CSVから生成したアプリ用JSON（オフライン/フォールバック用にバンドル）
- Supabase の `booths` テーブル — 本番のデータソース（PostGIS）

```bash
python3 scripts/convert_csv_to_json.py   # CSV → JSON 再生成
```

> データ取得はハイブリッド方式: 起動時に Supabase（`booths_nearby` RPC）から取得し、失敗/未設定時はバンドル済み JSON にフォールバック。

---

## 環境変数（`.env`）

`.env.example` をコピーして設定します（`.env` は Git 管理外）。

| 変数 | 用途 |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_ANON_KEY` | アプリからの Supabase 接続（クライアント公開可） |
| `SUPABASE_SERVICE_ROLE_KEY` | データ投入スクリプト用（**公開厳禁**） |
| `SUPABASE_ACCESS_TOKEN` | Management API で SQL を実行する場合（`sbp_...`） |
| `GOOGLE_MAPS_API_KEY` | Geocoding スクリプト用 |
| `GOOGLE_MAPS_IOS_API_KEY` / `GOOGLE_MAPS_ANDROID_API_KEY` | スタンドアロンビルドの地図表示用 |

> ⚠️ EAS のクラウドビルドでは `.env`（Git管理外）は読まれません。地図キーは EAS の環境変数に登録してください:
> ```bash
> eas env:create --name GOOGLE_MAPS_IOS_API_KEY --value <key> --environment production
> eas env:create --name GOOGLE_MAPS_ANDROID_API_KEY --value <key> --environment production
> ```

### ストア検証用クレデンシャル（`credentials/`・Git管理外）
- `credentials/ios/AuthKey.p8` — App Store Connect APIキー（`eas submit` / 将来の App Store Server API 用）
- `credentials/android/google-service-account.json` — Google Play サービスアカウント（Android購読検証 / `eas submit` 用）
  - Supabase の Edge Function には base64 で `GOOGLE_SERVICE_ACCOUNT_B64` として登録済み。

---

## Supabase セットアップ

```bash
# 1) スキーマ作成（PostGIS / booths / booths_nearby RPC / 購読テーブル）
python3 scripts/run_sql_supabase.py supabase/schema.sql
python3 scripts/run_sql_supabase.py supabase/subscriptions_rpc.sql

# 2) ブースデータ投入
python3 scripts/upload_booths_to_supabase.py

# 3) レシート検証 Edge Function のデプロイ
npx supabase functions deploy verify-receipt --project-ref <ref> --use-api
npx supabase secrets set ALLOW_DEMO=true --project-ref <ref>   # 本番は false / 未設定
# npx supabase secrets set APPLE_SHARED_SECRET=xxxx --project-ref <ref>
```

---

## 本番ビルド（EAS）

```bash
npm install -g eas-cli   # 未導入なら
eas login

# 課金(IAP)動作確認には開発ビルドが必要（Expo Go ではIAP不可）
eas build --profile development --platform ios

# 配布/ストア提出用
eas build --profile production --platform ios
eas build --profile production --platform android
```

### 実装済み
- [x] 実 IAP（`expo-iap` / StoreKit2、productId: `jp.oneofthem.phonebooth.1month/12month`）
- [x] レシート検証 Edge Function（iOSのJWS対応）。StoreKit2 JWS の**署名検証**を `@studium-ignotum/app-store-server-library` で実装（`STRICT_VERIFY` フラグでON）
- [x] クーポン適用（`redeem_coupon` RPC）

### go-live チェックリスト
- [ ] iOS サンドボックスで実購入テスト（dev build）→ `subscriptions`/`purchase_events` に記録されることを確認
- [ ] `supabase/production_lockdown.sql` を実行（`record_subscription` の anon 権限剥奪）
- [ ] Edge Function のシークレットを本番設定:
  ```bash
  npx supabase secrets unset ALLOW_DEMO --project-ref <ref>     # デモ検証OFF
  npx supabase secrets set STRICT_VERIFY=true --project-ref <ref> # JWS署名検証ON
  # 本番審査通過後: APPLE_ENV=Production / APPLE_APP_APPLE_ID=<数値AppID>
  ```
- [ ] Google Maps API キーを EAS 環境変数に登録（クラウドビルド用。上記コマンド参照）
- [x] Android: Play Developer API（`subscriptionsv2.get`）での `purchase_token` 検証を実装（Edge Function）。OAuth/署名は動作確認済み
- [ ] Android: Play Console にアプリ `jp.oneofthem.phonebooth` を登録し、サービスアカウント `eas-551@…` に「財務データ閲覧／注文管理」権限を付与＋サブスク商品を作成
  - 現状は Play API が `404 No application was found`（アプリ未登録）を返す。登録後に実トークンで有効化される。

---

## 住所 → 座標変換（Geocoding）

Google Maps Geocoding API で CSV に緯度・経度を追記します。

```bash
cp .env.example .env
# .env に GOOGLE_MAPS_API_KEY を設定

python3 scripts/geocode.py --dry-run   # クエリ確認
python3 scripts/geocode.py --limit 5   # 5件テスト
python3 scripts/geocode.py             # 全件実行
```

追記される列: `緯度`, `経度`, `ジオコード住所`, `ジオコードステータス`, `ジオコードクエリ`

### 住所なし行（767件）の精度改善

Places Text Search API で POI 名から再検索（Geocoding より STATION BOOTH / CocoDesk で精度が上がりやすい）:

```bash
python3 scripts/geocode_improve.py --limit 20   # テスト
python3 scripts/geocode_improve.py              # 767件のみ再処理
```

※ Places API の有効化が必要。誤マッチ防止のため都道府県・駅名の一致チェックあり。

### 住所なし行への住所補完（Reverse Geocoding）

```bash
python3 scripts/fill_address.py --limit 10
python3 scripts/fill_address.py
```

### 最寄駅の空欄補完（Text抽出 + Google API）

`最寄駅` が空の行だけを対象に、まず `施設名` / `設置場所詳細` から駅名を抽出し、
不足分のみ Google API（Reverse Geocoding + Nearby Search）で補完します。

```bash
python3 scripts/fill_station.py --dry-run
python3 scripts/fill_station.py --limit 50 --dry-run
python3 scripts/fill_station.py --missing-label 最寄り駅なし --far-distance-km 30
python3 scripts/fill_station.py
```

- APIを使わない確認: `python3 scripts/fill_station.py --dry-run --no-google`
- 採用しきい値を上げる: `python3 scripts/fill_station.py --min-score 80`
- 鉄道駅が見つからない/遠距離時の文言付与: `--missing-label 最寄り駅なし --far-distance-km 30`
