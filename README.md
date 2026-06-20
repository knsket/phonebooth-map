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

## 開発済みのUI機能概要
まずはフロントエンドの触りの部分（UI/UX体験）として以下の機能を作り込みました。

1. **インタラクティブマップ表示 (ポストマップオマージュ)**
   - ポストマップのように、ヘッダーにブランド（テレキューブ、CocoDesk、STATION BOOTH等）のタグを配置。
   - サービスごとにピン（マーカー）を色分けして視覚的に見やすく表示（テレキューブ＝緑、CocoDesk＝青、STATION BOOTH＝オレンジ等）。
   - タグをタップすることで、特定のブランドのブースのみを絞り込むフィルタリング機能。
2. **住所・キーワード・最寄駅での検索機能**
   - 画面上部の検索バーから、住所（例：「渋谷」「大阪」）や施設名、駅名を入力すると、合致する最初のブースの場所へと自動でマップが移動（Web表示では周辺のブースリストにフォーカス）。
3. **現在地への移動機能**
   - 「現在地」ボタンを押すことで、GPSによる現在地測位を行い、そこへ地図をアニメーション移動。
4. **ブース詳細スライドカード**
   - マップ上のピンをタップすると、画面下部から詳細情報（営業時間、最寄駅、ブース数、料金、設置詳細、予約URL）がスライドアップ。
5. **ログイン判定＆エラー画面（セキュリティ保護デモ）**
   - 右上の「ログイン状態」スイッチでログインの有無を切り替え可能。
   - **未ログイン時**: 「予約する」をタップすると、洗練された警告モーダル（ログインが必要です）が立ち上がり、直接の外部遷移を防止します。モーダル内の「デモログイン」をタップすると自動でログイン状態がONになり、そのまま進めます。
   - **ログイン時**: 外部ブラウザを起動し、該当するブランドの予約URLへ直接ジャンプします（`Linking.openURL`連動）。

---

## データ

- `docs/phone_booth_telework_box_list.csv` — 施設マスタ（1,278件）
- `src/data/booths.json` — CSVから自動生成した、アプリ読み込み用の最適化JSONデータ（1,278件）

### CSV → JSON 変換スクリプト
CSVに変更を加えた場合、以下のコマンドでアプリ用JSONを再生成できます。
```bash
python3 scripts/convert_csv_to_json.py
```

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