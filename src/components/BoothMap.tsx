import React from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';

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
  // 現在地。ネイティブは showsUserLocation の青点で標準表示されるため座標は補助用途。
  userLocation?: { latitude: number; longitude: number } | null;
  // 徒歩ルート。ネイティブは外部Googleマップ徒歩ナビで案内するため、描画には使用しない。
  route?: { from: { latitude: number; longitude: number }; to: { latitude: number; longitude: number } } | null;
  onRouteInfo?: (info: { mode: string; meters: number | null; seconds: number | null }) => void;
}

export default function BoothMap({
  mapRef,
  booths,
  selectedBooth,
  onSelectBooth,
  currentRegion,
  onRegionChange,
  getBrandColor,
}: BoothMapProps) {
  return (
    <View style={styles.nativeMapContainer}>
      <MapView
        ref={mapRef}
        style={styles.map}
        provider={PROVIDER_GOOGLE}
        initialRegion={currentRegion}
        onRegionChangeComplete={onRegionChange}
        showsUserLocation={true}
      >
        {booths
          // 座標が NaN / 範囲外のピンをネイティブへ渡すと iOS が起動時クラッシュするため除外する。
          .filter(
            (booth) =>
              Number.isFinite(booth.latitude) &&
              Number.isFinite(booth.longitude) &&
              Math.abs(booth.latitude) <= 90 &&
              Math.abs(booth.longitude) <= 180
          )
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
