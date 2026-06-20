import React, { useEffect, useRef, useMemo } from 'react';
import { View, StyleSheet, Platform } from 'react-native';

interface Booth {
  id: string;
  brand: string;
  company: string;
  name: string;
  prefecture: string;
  address: string;
  station: string;
  details: string;
  hours: string;
  count: string;
  price: string;
  url: string;
  latitude: number;
  longitude: number;
}

interface BoothMapProps {
  mapRef: React.RefObject<any>;
  booths: Booth[];
  selectedBooth: Booth | null;
  onSelectBooth: (booth: Booth) => void;
  currentRegion: any;
  onRegionChange: (region: any) => void;
  getBrandColor: (brand: string) => string;
  userLocation?: { latitude: number; longitude: number } | null;
  route?: { from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number } } | null;
  onRouteInfo?: (info: { mode: string; meters: number | null; seconds: number | null }) => void;
}

export default function BoothMap({
  booths,
  selectedBooth,
  onSelectBooth,
  currentRegion,
  onRegionChange,
  getBrandColor,
  userLocation,
  route,
  onRouteInfo,
}: BoothMapProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // 静的なHTML部分を生成（一度だけ作成し、二度とリロードさせない）
  const staticLeafletHtml = useMemo(() => {
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
        <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
        <style>
          body, html, #map { margin: 0; padding: 0; height: 100%; width: 100%; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
          .custom-div-icon {
            width: 14px !important;
            height: 14px !important;
            border-radius: 50%;
            border: 2px solid white;
            box-shadow: 0 1px 4px rgba(0,0,0,0.4);
            transition: transform 0.2s ease, width 0.2s ease, height 0.2s ease;
          }
          .custom-div-icon.selected {
            width: 22px !important;
            height: 22px !important;
            border: 3px solid #1F2937;
            box-shadow: 0 2px 10px rgba(0,0,0,0.5);
            transform: translate(-4px, -4px);
          }
          .leaflet-popup-content-header {
            font-weight: bold;
            font-size: 13px;
            margin-bottom: 4px;
            color: #1F2937;
          }
          .leaflet-popup-content-brand {
            font-size: 11px;
            color: #6B7280;
            margin-bottom: 2px;
          }
          /* 現在地マーカー(青い点＋パルス) */
          .user-loc {
            width: 24px !important;
            height: 24px !important;
          }
          .user-loc .dot {
            position: absolute;
            left: 50%;
            top: 50%;
            width: 22px;
            height: 22px;
            margin: -11px 0 0 -11px;
            background: #2563EB;
            border: 3px solid #fff;
            border-radius: 50%;
            box-shadow: 0 0 0 3px rgba(37,99,235,0.45), 0 2px 6px rgba(0,0,0,0.4);
          }
          .user-loc .pulse {
            position: absolute;
            left: 50%;
            top: 50%;
            width: 22px;
            height: 22px;
            margin: -11px 0 0 -11px;
            background: rgba(37,99,235,0.40);
            border-radius: 50%;
            animation: userpulse 1.6s ease-out infinite;
          }
          @keyframes userpulse {
            0% { transform: scale(1); opacity: 0.75; }
            100% { transform: scale(4); opacity: 0; }
          }
          /* 「現在地」ラベル */
          .user-loc-label {
            background: #2563EB;
            color: #fff;
            font-size: 11px;
            font-weight: 700;
            padding: 3px 8px;
            border-radius: 10px;
            border: 2px solid #fff;
            box-shadow: 0 2px 6px rgba(0,0,0,0.3);
            white-space: nowrap;
          }
          .user-loc-label::before { display: none; }
          .leaflet-tooltip-top.user-loc-label::before { border-top-color: #2563EB; }
        </style>
      </head>
      <body>
        <div id="map"></div>
        <script>
          let map;
          let markers = {};
          let selectedMarkerId = null;
          let userMarker = null;
          let routeLayer = null;

          // Valhallaのエンコード形状(精度6)をデコードする
          function decodePolyline(str, precision) {
            let index = 0, lat = 0, lng = 0, coordinates = [], shift, result, byte;
            const factor = Math.pow(10, precision || 6);
            while (index < str.length) {
              shift = 0; result = 0;
              do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
              lat += ((result & 1) ? ~(result >> 1) : (result >> 1));
              shift = 0; result = 0;
              do { byte = str.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
              lng += ((result & 1) ? ~(result >> 1) : (result >> 1));
              coordinates.push([lat / factor, lng / factor]);
            }
            return coordinates;
          }

          // 現在地→ブースの「徒歩ルート」を描画。Valhallaの歩行者ルーティングを使い、失敗時は直線にフォールバック。
          async function showRoute(fromLat, fromLng, toLat, toLng) {
            if (!map) return;
            clearRoute();
            let latlngs = null, meters = null, seconds = null, mode = 'straight';
            try {
              const body = {
                locations: [{ lat: fromLat, lon: fromLng }, { lat: toLat, lon: toLng }],
                costing: 'pedestrian',
                directions_options: { units: 'kilometers' }
              };
              const res = await fetch('https://valhalla1.openstreetmap.de/route', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
              });
              const json = await res.json();
              if (json && json.trip && json.trip.legs && json.trip.legs[0] && json.trip.legs[0].shape) {
                latlngs = decodePolyline(json.trip.legs[0].shape, 6);
                if (json.trip.summary) {
                  meters = Math.round(json.trip.summary.length * 1000);
                  seconds = Math.round(json.trip.summary.time);
                }
                mode = 'pedestrian';
              }
            } catch (e) { /* フォールバックへ */ }

            if (!latlngs || latlngs.length < 2) {
              latlngs = [[fromLat, fromLng], [toLat, toLng]];
              mode = 'straight';
            }

            routeLayer = L.polyline(latlngs, {
              color: '#2563EB',
              weight: 5,
              opacity: 0.9,
              dashArray: mode === 'straight' ? '8,8' : null,
              lineJoin: 'round'
            }).addTo(map);

            // 現在地とブースの両方が収まるように表示(下のコンパクトバー分の余白だけ確保)
            map.fitBounds(L.latLngBounds(latlngs), {
              paddingTopLeft: [50, 60],
              paddingBottomRight: [50, 190]
            });

            // 実ルートの距離・時間を親へ通知
            window.parent.postMessage({ type: 'ROUTE_INFO', mode: mode, meters: meters, seconds: seconds }, '*');
          }
          function clearRoute() {
            if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
          }

          // 現在地マーカーの設置・更新(青い点＋「現在地」ラベル)。boothのmarkersとは別管理なので再同期で消えない。
          function setUserLocation(lat, lng) {
            if (!map) return;
            const icon = L.divIcon({
              className: 'user-loc',
              html: '<div class="pulse"></div><div class="dot"></div>'
            });
            if (userMarker) {
              userMarker.setLatLng([lat, lng]);
            } else {
              userMarker = L.marker([lat, lng], { icon: icon, interactive: false, zIndexOffset: 10000 }).addTo(map);
              userMarker.bindTooltip('現在地', {
                permanent: true,
                direction: 'top',
                offset: [0, -14],
                className: 'user-loc-label'
              }).openTooltip();
            }
            // 現在地が見つけやすいよう、その場所へ寄せて拡大する
            map.setView([lat, lng], Math.max(map.getZoom(), 16));
          }

          // 現在の中心と「実際の表示範囲(bounds)」を親に通知する
          function postRegion() {
            if (!map) return;
            const center = map.getCenter();
            const b = map.getBounds();
            window.parent.postMessage({
              type: 'REGION_CHANGE',
              lat: center.lat,
              lng: center.lng,
              latDelta: Math.abs(b.getNorth() - b.getSouth()),
              lngDelta: Math.abs(b.getEast() - b.getWest())
            }, '*');
          }

          // 地図の初期化
          function initMap(lat, lng) {
            if (map) return;
            map = L.map('map', { zoomControl: false }).setView([lat, lng], 14);
            // ズーム(+/-)は左下へ。右下の「現在地」ボタンと重ならないようにする。
            L.control.zoom({ position: 'bottomleft' }).addTo(map);

            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
              maxZoom: 19,
              attribution: '&copy; OpenStreetMap'
            }).addTo(map);

            // 移動・ズームのたびに実表示範囲を親へ伝える
            map.on('moveend', postRegion);
            map.on('zoomend', postRegion);
            // 初期表示の範囲も一度通知（件数表示を正しい初期値にする）
            setTimeout(postRegion, 0);
          }

          // マーカーを同期する（差分またはフィルタされたデータを再マッピング）
          function syncMarkers(boothsList, currentSelectedId) {
            // 既存のマーカーをすべて削除
            Object.values(markers).forEach(m => map.removeLayer(m));
            markers = {};
            selectedMarkerId = currentSelectedId;

            boothsList.forEach(booth => {
              const isSelected = booth.id === selectedMarkerId;
              const iconClass = isSelected ? 'custom-div-icon selected' : 'custom-div-icon';
              
              const customIcon = L.divIcon({
                className: iconClass,
                html: '<div style="background-color: ' + booth.color + '; width: 100%; height: 100%; border-radius: 50%;"></div>'
              });

              const marker = L.marker([booth.lat, booth.lng], { icon: customIcon }).addTo(map);
              
              const popupContent = document.createElement('div');
              popupContent.innerHTML = '<div>' +
                '<div class="leaflet-popup-content-brand">' + booth.brand + '</div>' +
                '<div class="leaflet-popup-content-header">' + booth.name + '</div>' +
                '<div style="font-size:11px; color:#4B5563;">🚉 ' + (booth.station || '情報なし') + '</div>' +
                '</div>';

              marker.bindPopup(popupContent);

              marker.on('click', () => {
                // 中央寄せは親からの FOCUS_BOOTH で行う(下の詳細シートに隠れない位置へ)
                window.parent.postMessage({ type: 'SELECT_BOOTH', id: booth.id }, '*');
              });

              markers[booth.id] = marker;
              
              if (isSelected) {
                marker.openPopup();
              }
            });
          }

          // 中心位置変更
          function setCenter(lat, lng) {
            if (map) {
              const currentCenter = map.getCenter();
              const distance = Math.sqrt(Math.pow(currentCenter.lat - lat, 2) + Math.pow(currentCenter.lng - lng, 2));
              if (distance < 0.1) {
                map.panTo([lat, lng]);
              } else {
                map.setView([lat, lng], map.getZoom());
              }
            }
          }

          // マーカー選択
          function selectMarker(id) {
            selectedMarkerId = id;
            const marker = markers[id];
            if (marker) {
              map.panTo(marker.getLatLng());
              marker.openPopup();
            }
          }

          // スポットを「見える範囲(下の詳細シートを除いた領域)の中央」へ寄せる。
          // 詳細シートが画面下部を覆うため、対象が上寄り(約32%位置)に来るよう中心をずらす。
          function focusBooth(id, lat, lng) {
            if (!map) return;
            selectedMarkerId = id;
            const z = map.getZoom();
            const size = map.getSize();
            const pt = map.project([lat, lng], z);
            // 中心を対象より下へずらす → 対象は画面の上寄りに表示される
            const target = map.unproject(L.point(pt.x, pt.y + size.y * 0.20), z);
            map.panTo(target, { animate: true });
            const marker = markers[id];
            if (marker) marker.openPopup();
          }

          // メッセージ受信ハンドラ
          window.addEventListener('message', (event) => {
            const data = event.data;
            if (data.type === 'INIT') {
              initMap(data.lat, data.lng);
            }
            if (data.type === 'SYNC_MARKERS') {
              syncMarkers(data.booths, data.selectedId);
            }
            if (data.type === 'SET_CENTER') {
              setCenter(data.lat, data.lng);
            }
            if (data.type === 'SELECT_MARKER') {
              selectMarker(data.id);
            }
            if (data.type === 'FOCUS_BOOTH') {
              focusBooth(data.id, data.lat, data.lng);
            }
            if (data.type === 'SET_USER_LOCATION') {
              setUserLocation(data.lat, data.lng);
            }
            if (data.type === 'SHOW_ROUTE') {
              showRoute(data.fromLat, data.fromLng, data.toLat, data.toLng);
            }
            if (data.type === 'CLEAR_ROUTE') {
              clearRoute();
            }
          });
        </script>
      </body>
      </html>
    `;
  }, []);

  // シリアライズされたブースリスト (boothsはすでに親でブランドフィルタがかかっている)
  const serializedBooths = useMemo(() => {
    return booths.map(b => ({
      id: b.id,
      name: b.name,
      brand: b.brand,
      lat: b.latitude,
      lng: b.longitude,
      color: getBrandColor(b.brand),
      address: b.address,
      station: b.station
    }));
  }, [booths, getBrandColor]);

  // iframe初期ロード完了後に初期メッセージを送信
  const handleIframeLoad = () => {
    if (!iframeRef.current?.contentWindow) return;
    
    // 1. 地図の初期化
    iframeRef.current.contentWindow.postMessage({
      type: 'INIT',
      lat: currentRegion.latitude,
      lng: currentRegion.longitude
    }, '*');

    // 2. マーカーの同期
    iframeRef.current.contentWindow.postMessage({
      type: 'SYNC_MARKERS',
      booths: serializedBooths,
      selectedId: selectedBooth ? selectedBooth.id : null
    }, '*');

    // 3. すでに現在地があれば青い点を設置
    if (userLocation) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_USER_LOCATION',
        lat: userLocation.latitude,
        lng: userLocation.longitude,
      }, '*');
    }

    // 4. ルート表示中なら(タブ切替などで再マウントされた場合)再描画
    if (route) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SHOW_ROUTE',
        fromLat: route.from.latitude,
        fromLng: route.from.longitude,
        toLat: route.to.latitude,
        toLng: route.to.longitude,
      }, '*');
    }
  };

  // 現在地が更新されたら地図に青い点を反映
  useEffect(() => {
    if (!userLocation || !iframeRef.current?.contentWindow) return;
    iframeRef.current.contentWindow.postMessage({
      type: 'SET_USER_LOCATION',
      lat: userLocation.latitude,
      lng: userLocation.longitude,
    }, '*');
  }, [userLocation?.latitude, userLocation?.longitude]);

  // スポット選択時、詳細シートに隠れない「見える範囲の中央」へ寄せる
  useEffect(() => {
    if (!selectedBooth || !iframeRef.current?.contentWindow) return;
    // ルート表示中はそちらでフィット表示するので中央寄せはスキップ
    if (route) return;
    iframeRef.current.contentWindow.postMessage({
      type: 'FOCUS_BOOTH',
      id: selectedBooth.id,
      lat: selectedBooth.latitude,
      lng: selectedBooth.longitude,
    }, '*');
  }, [selectedBooth?.id]);

  // 徒歩ルートの表示/消去
  useEffect(() => {
    if (!iframeRef.current?.contentWindow) return;
    if (route) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SHOW_ROUTE',
        fromLat: route.from.latitude,
        fromLng: route.from.longitude,
        toLat: route.to.latitude,
        toLng: route.to.longitude,
      }, '*');
    } else {
      iframeRef.current.contentWindow.postMessage({ type: 'CLEAR_ROUTE' }, '*');
    }
  }, [route?.from.latitude, route?.from.longitude, route?.to.latitude, route?.to.longitude]);

  // フィルタなどで booths (serializedBooths) が変わったら、即座に確実に iframe 側に同期メッセージを送る
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SYNC_MARKERS',
        booths: serializedBooths,
        selectedId: selectedBooth ? selectedBooth.id : null
      }, '*');
    }
  }, [serializedBooths, selectedBooth?.id]);

  // 親からの検索などで座標が変化した際の追従
  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      iframeRef.current.contentWindow.postMessage({
        type: 'SET_CENTER',
        lat: currentRegion.latitude,
        lng: currentRegion.longitude
      }, '*');
    }
  }, [currentRegion.latitude, currentRegion.longitude]);

  // イベントリスナー
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;

      if (event.data.type === 'SELECT_BOOTH') {
        const id = event.data.id;
        const found = booths.find(b => b.id === id);
        if (found) {
          onSelectBooth(found);
        }
      }

      if (event.data.type === 'ROUTE_INFO' && onRouteInfo) {
        onRouteInfo({ mode: event.data.mode, meters: event.data.meters, seconds: event.data.seconds });
      }

      if (event.data.type === 'REGION_CHANGE') {
        const latDiff = Math.abs(event.data.lat - currentRegion.latitude);
        const lngDiff = Math.abs(event.data.lng - currentRegion.longitude);
        // 実際のズーム範囲(delta)も反映する。これがないと拡大縮小しても件数が変わらない。
        const nextLatDelta = event.data.latDelta ?? currentRegion.latitudeDelta;
        const nextLngDelta = event.data.lngDelta ?? currentRegion.longitudeDelta;
        const deltaChanged =
          Math.abs(nextLatDelta - currentRegion.latitudeDelta) > 0.0001 ||
          Math.abs(nextLngDelta - currentRegion.longitudeDelta) > 0.0001;
        if (latDiff > 0.0001 || lngDiff > 0.0001 || deltaChanged) {
          onRegionChange({
            latitude: event.data.lat,
            longitude: event.data.lng,
            latitudeDelta: nextLatDelta,
            longitudeDelta: nextLngDelta,
          });
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [booths, onSelectBooth, currentRegion, onRegionChange, onRouteInfo]);

  return (
    <View style={styles.webMapContainer}>
      <iframe
        ref={iframeRef}
        srcDoc={staticLeafletHtml}
        style={{ width: '100%', height: '100%', border: 'none' }}
        title="Web Interactive Map"
        onLoad={handleIframeLoad}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  webMapContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
});
