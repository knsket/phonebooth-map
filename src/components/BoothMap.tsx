import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';

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

interface LatLng {
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
  // 現在地。ネイティブは showsUserLocation の青点で標準表示されるため座標は補助用途。
  userLocation?: { latitude: number; longitude: number } | null;
  // 徒歩ルート。現在地→ブースの経路を地図上に線で描画する。
  route?: { from: LatLng; to: LatLng } | null;
  onRouteInfo?: (info: { mode: string; meters: number | null; seconds: number | null }) => void;
}

// Valhalla のエンコード形状(精度6)をデコードして座標配列にする
function decodePolyline(str: string, precision = 6): LatLng[] {
  let index = 0;
  let lat = 0;
  let lng = 0;
  const coordinates: LatLng[] = [];
  const factor = Math.pow(10, precision);

  while (index < str.length) {
    let shift = 0;
    let result = 0;
    let byte: number;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;
    do {
      byte = str.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    lng += result & 1 ? ~(result >> 1) : result >> 1;

    coordinates.push({ latitude: lat / factor, longitude: lng / factor });
  }
  return coordinates;
}

const isValidCoord = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;

export default function BoothMap({
  mapRef,
  booths,
  selectedBooth,
  onSelectBooth,
  currentRegion,
  onRegionChange,
  getBrandColor,
  route,
  onRouteInfo,
}: BoothMapProps) {
  // 描画する徒歩ルートの座標列と、実ルート取得失敗時の直線フォールバックかどうか
  const [routeCoords, setRouteCoords] = useState<LatLng[]>([]);
  const [routeStraight, setRouteStraight] = useState(false);
  // iOS / Android とも Google Maps を使用する。
  const mapProvider = PROVIDER_GOOGLE;

  // route(現在地→ブース)が指定されたら歩行者ルートを取得して線を引く。
  // Web 版と同じ Valhalla(OSM 歩行者ルーティング・APIキー不要)を使い、失敗時は直線にフォールバック。
  useEffect(() => {
    if (!route) {
      setRouteCoords([]);
      return;
    }

    let cancelled = false;
    const { from, to } = route;

    const fitToRoute = (coords: LatLng[]) => {
      if (mapRef.current && coords.length >= 2) {
        mapRef.current.fitToCoordinates(coords, {
          edgePadding: { top: 80, right: 60, bottom: 200, left: 60 },
          animated: true,
        });
      }
    };

    (async () => {
      let coords: LatLng[] | null = null;
      let meters: number | null = null;
      let seconds: number | null = null;
      let mode = 'straight';

      try {
        const res = await fetch('https://valhalla1.openstreetmap.de/route', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            locations: [
              { lat: from.latitude, lon: from.longitude },
              { lat: to.latitude, lon: to.longitude },
            ],
            costing: 'pedestrian',
            directions_options: { units: 'kilometers' },
          }),
        });
        const json = await res.json();
        const leg = json?.trip?.legs?.[0];
        if (leg?.shape) {
          coords = decodePolyline(leg.shape, 6);
          if (json.trip.summary) {
            meters = Math.round(json.trip.summary.length * 1000);
            seconds = Math.round(json.trip.summary.time);
          }
          mode = 'pedestrian';
        }
      } catch {
        /* フォールバック(直線)へ */
      }

      if (cancelled) return;

      if (!coords || coords.length < 2) {
        coords = [from, to];
        mode = 'straight';
      }

      setRouteStraight(mode === 'straight');
      setRouteCoords(coords);
      fitToRoute(coords);
      onRouteInfo?.({ mode, meters, seconds });
    })();

    return () => {
      cancelled = true;
    };
    // route の端点が変わったときだけ再取得する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.from.latitude, route?.from.longitude, route?.to.latitude, route?.to.longitude]);

  return (
    <View style={styles.nativeMapContainer}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={mapProvider}
        initialRegion={currentRegion}
        onRegionChangeComplete={onRegionChange}
        showsUserLocation={true}
      >
        {booths
          // 座標が NaN / 範囲外のピンをネイティブへ渡すと iOS が起動時クラッシュするため除外する。
          .filter((booth) => isValidCoord(booth.latitude, booth.longitude))
          .map((booth) => (
            <Marker
              key={booth.id}
              coordinate={{ latitude: booth.latitude, longitude: booth.longitude }}
              title={booth.name}
              description={booth.brand}
              pinColor={getBrandColor(booth.brand)}
              onPress={() => onSelectBooth(booth)}
            />
          ))}

        {routeCoords.length >= 2 && (
          <Polyline
            coordinates={routeCoords}
            strokeColor="#2563EB"
            strokeWidth={5}
            lineJoin="round"
            lineDashPattern={routeStraight ? [8, 8] : undefined}
          />
        )}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  nativeMapContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  map: {
    ...StyleSheet.absoluteFillObject,
  },
});
