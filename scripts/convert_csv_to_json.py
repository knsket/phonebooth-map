import csv
import json
import os

def convert_csv_to_json():
    csv_path = 'docs/phone_booth_telework_box_list.csv'
    json_dir = 'src/data'
    json_path = os.path.join(json_dir, 'booths.json')
    
    # ディレクトリ作成
    os.makedirs(json_dir, exist_ok=True)
    
    booths = []
    
    if not os.path.exists(csv_path):
        print(f"Error: {csv_path} not found.")
        return
        
    # encoding='utf-8-sig' でBOM(\ufeff)を除去する。
    # これを 'utf-8' にすると先頭カラム名が '\ufeffサービス名' となり brand 等が空になるバグが発生する。
    with open(csv_path, mode='r', encoding='utf-8-sig') as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            # 緯度・経度がないものはスキップ
            lat_str = row.get('緯度')
            lng_str = row.get('経度')
            
            if not lat_str or not lng_str:
                continue
                
            try:
                lat = float(lat_str)
                lng = float(lng_str)
            except ValueError:
                # 数値変換できないものはスキップ
                continue
                
            booths.append({
                'id': str(i + 1),
                'brand': row.get('サービス名', ''),
                'company': row.get('運営会社', ''),
                'name': row.get('施設名', ''),
                'prefecture': row.get('都道府県', ''),
                'address': row.get('住所', ''),
                'station': row.get('最寄駅', ''),
                'details': row.get('設置場所詳細', ''),
                'hours': row.get('営業時間', ''),
                'count': row.get('ブース数', ''),
                'price': row.get('料金（税込）', ''),
                'url': row.get('詳細URL', ''),
                'latitude': lat,
                'longitude': lng
            })
            
    with open(json_path, mode='w', encoding='utf-8') as f:
        json.dump(booths, f, ensure_ascii=False, indent=2)
        
    print(f"Successfully converted {len(booths)} booths and saved to {json_path}")

if __name__ == '__main__':
    convert_csv_to_json()
