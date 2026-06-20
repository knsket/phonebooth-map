import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  Alert,
  Linking,
  Platform,
  SafeAreaView,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';

import BoothMap from './src/components/BoothMap';
import Paywall from './src/components/Paywall';
import { useSubscription, planLabel, PlanId } from './src/lib/subscription';
import { Booth, LOCAL_BOOTHS, fetchAllBooths, BoothSource } from './src/lib/boothsRepo';
import { getBrandColor } from './src/lib/brands';

// 東京駅周辺
const INITIAL_REGION = {
  latitude: 35.681236,
  longitude: 139.767125,
  latitudeDelta: 0.02,
  longitudeDelta: 0.02,
};

// 2点間の距離(おおまかなkm。表示用)
const distanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

export default function App() {
  // サブスクリプション(課金)状態。徒歩案内・予約リンクをアンロックする。
  const { entitlement, purchasing, purchase, restore, clear, redeemCoupon } = useSubscription();
  const isPremium = entitlement.active;
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallContext, setPaywallContext] = useState<string | undefined>(undefined);
  // 課金完了後に自動で続行するアクション(ルート表示/予約遷移)
  const pendingActionRef = useRef<null | (() => void)>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBooth, setSelectedBooth] = useState<Booth | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [filterBrand, setFilterBrand] = useState<string>('ALL');
  const [appMode, setAppMode] = useState<'MAP' | 'LIST'>('MAP');
  // 徒歩ルート表示中かどうか(Web地図に現在地→ブースの線を描く)
  const [routeActive, setRouteActive] = useState(false);
  // 実ルートの距離・時間(歩行者ルーティングの結果)
  const [routeInfo, setRouteInfo] = useState<{ mode: string; meters: number | null; seconds: number | null } | null>(null);

  // ブースデータ(Supabase優先・ローカルfallback)。初期はバンドル済みローカルで即描画し、取得後に差し替える。
  const [allBooths, setAllBooths] = useState<Booth[]>(LOCAL_BOOTHS);
  const [dataSource, setDataSource] = useState<BoothSource>('local');

  // 自分の現在地(青い点でマッピング)。取得できるまでは null。
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  // mapRegion: 地図の現在の中心(パン/選択/検索/現在地で変化)。マップ描画に使用。
  const [mapRegion, setMapRegion] = useState(INITIAL_REGION);
  // listAnchor: リストの並び替え基準点。検索・現在地でのみ更新し、タップでは動かさない(リストが跳ねないように)。
  const [listAnchor, setListAnchor] = useState({
    latitude: INITIAL_REGION.latitude,
    longitude: INITIAL_REGION.longitude,
  });

  const mapRef = useRef<any>(null);

  // 起動時にSupabaseから全ブースを取得(失敗時はローカルのまま)。
  useEffect(() => {
    let cancelled = false;
    fetchAllBooths().then(({ booths, source }) => {
      if (cancelled) return;
      setAllBooths(booths);
      setDataSource(source);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 起動時に一度だけ現在地へ寄せる。許可されていない/取得失敗時は東京駅(INITIAL_REGION)のまま。
  useEffect(() => {
    let cancelled = false;
    const applyLocation = (latitude: number, longitude: number) => {
      if (cancelled) return;
      setUserLocation({ latitude, longitude });
      setMapRegion({ latitude, longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 });
      setListAnchor({ latitude, longitude });
      if (mapRef.current && Platform.OS !== 'web') {
        mapRef.current.animateToRegion(
          { latitude, longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 },
          600
        );
      }
    };

    if (Platform.OS === 'web') {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => applyLocation(pos.coords.latitude, pos.coords.longitude),
          () => { /* 拒否・失敗 → 東京駅のまま */ },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 }
        );
      }
      return () => { cancelled = true; };
    }

    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return; // 許可なし → 東京駅のまま
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        applyLocation(loc.coords.latitude, loc.coords.longitude);
      } catch {
        /* 取得失敗 → 東京駅のまま */
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // ブランド一覧(件数つき・多い順)
  const brandChips = useMemo(() => {
    const counts = new Map<string, number>();
    allBooths.forEach((b) => {
      if (b.brand) counts.set(b.brand, (counts.get(b.brand) || 0) + 1);
    });
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return [
      { key: 'ALL', label: 'すべて', count: allBooths.length },
      ...sorted.map(([key, count]) => ({ key, label: key, count })),
    ];
  }, [allBooths]);

  // マップ表示用: 実際に画面に映っている範囲 + ブランド絞り込み。
  // latitudeDelta/longitudeDelta は「表示範囲の全幅」なので、中心から半分(+10%の余白)が画面内。
  // これによりズーム拡大→件数減、縮小→件数増、と直感どおりに連動する。
  const visibleBooths = useMemo(() => {
    let list = allBooths;
    if (filterBrand !== 'ALL') list = list.filter((b) => b.brand === filterBrand);

    const thLat = (mapRegion.latitudeDelta / 2) * 1.1;
    const thLng = (mapRegion.longitudeDelta / 2) * 1.1;
    return list
      .filter((b) => {
        if (selectedBooth && selectedBooth.id === b.id) return true;
        return (
          Math.abs(b.latitude - mapRegion.latitude) < thLat &&
          Math.abs(b.longitude - mapRegion.longitude) < thLng
        );
      })
      .slice(0, 300);
  }, [allBooths, mapRegion, filterBrand, selectedBooth]);

  // リスト表示用: ブランド絞り込み + アンカーから近い順
  const listBooths = useMemo(() => {
    let list = allBooths;
    if (filterBrand !== 'ALL') list = list.filter((b) => b.brand === filterBrand);
    return [...list]
      .map((b) => ({
        booth: b,
        dist: distanceKm(listAnchor.latitude, listAnchor.longitude, b.latitude, b.longitude),
      }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 100);
  }, [allBooths, filterBrand, listAnchor]);

  // 詳細シートを閉じる(ルート表示もリセット)
  const closeSheet = () => {
    setSelectedBooth(null);
    setRouteActive(false);
    setRouteInfo(null);
  };

  // 現在地→ブースの徒歩時間/距離の目安(直線ベース)
  const walkEstimate = (booth: Booth) => {
    if (!userLocation) return null;
    const km = distanceKm(userLocation.latitude, userLocation.longitude, booth.latitude, booth.longitude);
    const minutes = Math.max(1, Math.round((km * 1000) / 80)); // 徒歩 約80m/分
    const distLabel = km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)}km`;
    return { minutes, distLabel };
  };

  // プレミアム機能のゲート。未課金ならペイウォールを開き、課金後に続行する。
  const requirePremium = (context: string, action: () => void): boolean => {
    if (isPremium) return true;
    pendingActionRef.current = action;
    setPaywallContext(context);
    setShowPaywall(true);
    return false;
  };

  // ペイウォールからの購入完了処理
  const handlePurchase = async (planId: PlanId) => {
    const ok = await purchase(planId);
    if (ok) {
      setShowPaywall(false);
      const next = pendingActionRef.current;
      pendingActionRef.current = null;
      if (next) setTimeout(next, 250); // 課金完了後に元の操作を続行
    }
  };

  // クーポン適用。成功したらペイウォールを閉じ、保留中の操作を続行する。
  const handleRedeemCoupon = async (code: string) => {
    const result = await redeemCoupon(code);
    if (result.success) {
      const next = pendingActionRef.current;
      pendingActionRef.current = null;
      setTimeout(() => {
        setShowPaywall(false);
        if (next) setTimeout(next, 250);
      }, 900); // 成功メッセージを一瞬見せてから閉じる
    }
    return result;
  };

  const handleRestore = async () => {
    const ok = await restore();
    if (ok) {
      setShowPaywall(false);
      Alert.alert('復元しました', 'プレミアム機能が有効になりました。');
    } else {
      Alert.alert('購入履歴なし', '復元できる購入が見つかりませんでした。');
    }
  };

  // 「徒歩ルート」ボタン: プレミアム機能。Webは地図に線を描画、ネイティブは外部Googleマップ徒歩ナビ
  const handleRoutePress = (booth: Booth) => {
    // 未課金なら課金を促し、購入後にこの操作を自動継続
    if (!requirePremium('徒歩ルート案内', () => handleRoutePress(booth))) return;
    if (Platform.OS !== 'web') {
      openExternalWalkNav(booth);
      return;
    }
    if (routeActive) {
      setRouteActive(false); // トグルで消す
      setRouteInfo(null);
      return;
    }
    setRouteInfo(null); // 新しい計算前にクリア
    setAppMode('MAP'); // ルートは地図上に描くので、リスト表示中でもマップへ切り替える
    if (!userLocation) {
      // 現在地のみ取得(選択ブースは維持)。取得後 routeActive=true なのでルートが描かれる。
      setIsLoading(true);
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
            setIsLoading(false);
          },
          () => {
            setUserLocation({ latitude: 35.658034, longitude: 139.701636 }); // デモ用フォールバック(渋谷)
            setIsLoading(false);
          },
          { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
        );
      } else {
        setIsLoading(false);
      }
    }
    setRouteActive(true);
  };

  // 外部のGoogleマップ徒歩ナビを開く(ターンバイターン)
  const openExternalWalkNav = (booth: Booth) => {
    const dest = `${booth.latitude},${booth.longitude}`;
    const origin = userLocation ? `${userLocation.latitude},${userLocation.longitude}` : '';
    const url =
      `https://www.google.com/maps/dir/?api=1${origin ? `&origin=${origin}` : ''}` +
      `&destination=${dest}&travelmode=walking`;
    if (Platform.OS === 'web') window.open(url, '_blank');
    else Linking.openURL(url);
  };

  // ブース選択: 詳細を開き、マップなら「見える範囲の中央」へ移動。リストの並びは変えない(listAnchorは触らない)。
  const handleSelectBooth = (booth: Booth) => {
    setSelectedBooth(booth);
    setRouteActive(false); // 別のブースを選んだらルートは一旦消す
    setRouteInfo(null);
    if (Platform.OS === 'web') {
      // Web: 中央寄せ(詳細シート分の上寄せ)は地図側のFOCUS_BOOTHが担当。二重移動を避けここでは中心移動しない。
      return;
    }
    // ネイティブ: 詳細シートで画面下半分が隠れるぶん、中心を南へずらしてピンを上寄り＝見える範囲の中央に表示。
    const region = {
      ...mapRegion,
      latitude: booth.latitude - mapRegion.latitudeDelta * 0.2,
      longitude: booth.longitude,
    };
    setMapRegion(region);
    if (mapRef.current) {
      mapRef.current.animateToRegion(region, 450);
    }
  };

  // 検索・現在地用: 地図とリスト両方のアンカーを移動
  const moveTo = (latitude: number, longitude: number, openBooth?: Booth | null) => {
    const region = { latitude, longitude, latitudeDelta: 0.02, longitudeDelta: 0.02 };
    setMapRegion(region);
    setListAnchor({ latitude, longitude });
    if (mapRef.current && Platform.OS !== 'web') {
      mapRef.current.animateToRegion(region, 600);
    }
    setSelectedBooth(openBooth ?? null);
    // 場所が変わるのでルートは片付ける
    setRouteActive(false);
    setRouteInfo(null);
  };

  const handleGoToCurrentLocation = async () => {
    setIsLoading(true);

    if (Platform.OS === 'web') {
      if (!navigator.geolocation) {
        setIsLoading(false);
        Alert.alert('位置情報エラー', 'お使いのブラウザは位置情報に対応していません。');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
          moveTo(pos.coords.latitude, pos.coords.longitude);
          setIsLoading(false);
        },
        () => {
          // localhost以外のhttpや権限拒否時のデモ用フォールバック(渋谷)
          setUserLocation({ latitude: 35.658034, longitude: 139.701636 });
          moveTo(35.658034, 139.701636);
          setIsLoading(false);
          Alert.alert('現在地（デモ）', '位置情報を取得できなかったため、ブースが多い渋谷駅周辺を現在地として表示しました。');
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      );
      return;
    }

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setIsLoading(false);
        Alert.alert('位置情報エラー', '現在地の取得には位置情報の許可が必要です。');
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setUserLocation({ latitude: loc.coords.latitude, longitude: loc.coords.longitude });
      moveTo(loc.coords.latitude, loc.coords.longitude);
    } catch (e) {
      Alert.alert('エラー', '位置情報の取得に失敗しました。');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = () => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return;
    Keyboard.dismiss();

    const results = allBooths.filter(
      (b) =>
        b.address.toLowerCase().includes(q) ||
        b.name.toLowerCase().includes(q) ||
        b.station.toLowerCase().includes(q) ||
        b.prefecture.toLowerCase().includes(q)
    );

    if (results.length === 0) {
      Alert.alert('検索結果', '該当するブースが見つかりませんでした。\n例：渋谷、大阪、新宿、CocoDesk など');
      return;
    }
    const target = results[0];
    // マップなら対象を選択して開く / リストなら近い順に並べ替えるだけ
    moveTo(target.latitude, target.longitude, appMode === 'MAP' ? target : null);
  };

  const handleOpenBooking = (booth: Booth) => {
    // 予約ページへのリンクはプレミアム機能。未課金なら課金を促す。
    if (!requirePremium('予約ページへのリンク', () => handleOpenBooking(booth))) return;
    if (Platform.OS === 'web') {
      window.open(booth.url, '_blank');
    } else {
      Alert.alert('予約サイトへ移動', `外部ブラウザで${booth.brand}の予約ページを開きます。`, [
        { text: 'キャンセル', style: 'cancel' },
        {
          text: '開く',
          onPress: async () => {
            const ok = await Linking.canOpenURL(booth.url);
            if (ok) await Linking.openURL(booth.url);
            else Alert.alert('エラー', 'このURLを開けませんでした。');
          },
        },
      ]);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      {/* ===== ヘッダー ===== */}
      <View style={styles.header}>
        <View style={styles.headerRow}>
          <View>
            <Text style={styles.headerTitle}>フォンブースマップ</Text>
            <Text style={styles.headerSub}>
              全国 {allBooths.length.toLocaleString()} 拠点{dataSource === 'supabase' ? '' : '（ローカル）'}
            </Text>
          </View>
          <TouchableOpacity
            style={[styles.authPill, isPremium ? styles.authPillOn : styles.authPillOff]}
            onPress={() => {
              if (isPremium) {
                Alert.alert('プレミアム会員', `現在のプラン: ${planLabel(entitlement.plan)}`, [
                  { text: '解約する（デモ）', style: 'destructive', onPress: clear },
                  { text: '閉じる', style: 'cancel' },
                ]);
              } else {
                setPaywallContext(undefined);
                setShowPaywall(true);
              }
            }}
            activeOpacity={0.8}
          >
            <Text style={[styles.authPillText, { color: isPremium ? '#92400E' : '#6B7280' }]}>
              {isPremium ? `⭐ ${planLabel(entitlement.plan)}` : '🔒 無料プラン'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* 検索バー */}
        <View style={styles.searchBar}>
          <Text style={styles.searchIcon}>🔍</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="住所・駅名・施設名で検索"
            placeholderTextColor="#9CA3AF"
            value={searchQuery}
            onChangeText={setSearchQuery}
            onSubmitEditing={handleSearch}
            returnKeyType="search"
          />
          {searchQuery ? (
            <TouchableOpacity onPress={() => setSearchQuery('')} hitSlop={8}>
              <Text style={styles.searchClear}>✕</Text>
            </TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.searchGo} onPress={handleSearch}>
            <Text style={styles.searchGoText}>検索</Text>
          </TouchableOpacity>
        </View>

        {/* セグメント(マップ/リスト) */}
        <View style={styles.segment}>
          {(['MAP', 'LIST'] as const).map((m) => (
            <TouchableOpacity
              key={m}
              style={[styles.segmentItem, appMode === m && styles.segmentItemActive]}
              onPress={() => {
                setAppMode(m);
                // リストへ移るときは、地図にしか描けないルートを片付ける(ルートバーの取り残し防止)
                if (m === 'LIST' && routeActive) {
                  setRouteActive(false);
                  setRouteInfo(null);
                }
              }}
              activeOpacity={0.9}
            >
              <Text style={[styles.segmentText, appMode === m && styles.segmentTextActive]}>
                {m === 'MAP' ? '🗺  マップ' : '☰  リスト'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ブランドフィルター */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
        >
          {brandChips.map((c) => {
            const active = filterBrand === c.key;
            const color = c.key === 'ALL' ? '#111827' : getBrandColor(c.key);
            return (
              <TouchableOpacity
                key={c.key}
                onPress={() => setFilterBrand(c.key)}
                style={[styles.chip, active && { backgroundColor: color, borderColor: color }]}
                activeOpacity={0.8}
              >
                {c.key !== 'ALL' && (
                  <View style={[styles.chipDot, { backgroundColor: active ? '#fff' : color }]} />
                )}
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {c.label}
                </Text>
                <Text style={[styles.chipCount, active && styles.chipTextActive]}>{c.count}</Text>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>

      {/* ===== コンテンツ ===== */}
      <View style={styles.content}>
        {appMode === 'MAP' ? (
          <View style={styles.flex}>
            <BoothMap
              mapRef={mapRef}
              booths={visibleBooths}
              selectedBooth={selectedBooth}
              onSelectBooth={handleSelectBooth}
              currentRegion={mapRegion}
              onRegionChange={setMapRegion}
              getBrandColor={getBrandColor}
              userLocation={userLocation}
              route={
                routeActive && userLocation && selectedBooth
                  ? {
                      from: userLocation,
                      to: { latitude: selectedBooth.latitude, longitude: selectedBooth.longitude },
                    }
                  : null
              }
              onRouteInfo={setRouteInfo}
            />
            <View style={styles.mapBadge} pointerEvents="none">
              <Text style={styles.mapBadgeText}>
                {visibleBooths.length >= 300 ? 'この付近 300+ 件（拡大で絞り込み）' : `この付近 ${visibleBooths.length} 件`}
              </Text>
            </View>
            <TouchableOpacity style={styles.locBtn} onPress={handleGoToCurrentLocation} activeOpacity={0.85}>
              <Text style={styles.locBtnText}>🎯 現在地</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.flex}>
            <View style={styles.listHeader}>
              <Text style={styles.listHeaderText}>
                {filterBrand === 'ALL' ? '全ブランド' : filterBrand}・近い順 {listBooths.length} 件
              </Text>
              <TouchableOpacity onPress={handleGoToCurrentLocation}>
                <Text style={styles.listHeaderAction}>🎯 現在地から</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.listContent}>
              {listBooths.map(({ booth, dist }) => (
                <TouchableOpacity
                  key={booth.id}
                  style={[styles.card, selectedBooth?.id === booth.id && styles.cardActive]}
                  onPress={() => handleSelectBooth(booth)}
                  activeOpacity={0.85}
                >
                  <View style={styles.cardTop}>
                    <View style={[styles.brandTag, { backgroundColor: getBrandColor(booth.brand) }]}>
                      <Text style={styles.brandTagText}>{booth.brand}</Text>
                    </View>
                    <Text style={styles.cardDist}>📍 約 {dist < 1 ? `${Math.round(dist * 1000)}m` : `${dist.toFixed(1)}km`}</Text>
                  </View>
                  <Text style={styles.cardName} numberOfLines={1}>{booth.name}</Text>
                  <Text style={styles.cardStation} numberOfLines={1}>🚉 {booth.station || '最寄駅情報なし'}</Text>
                  <Text style={styles.cardAddr} numberOfLines={1}>{booth.address}</Text>
                  <View style={styles.cardFooter}>
                    <Text style={styles.cardMeta} numberOfLines={1}>🕒 {booth.hours || '時間情報なし'}</Text>
                    {!!booth.price && <Text style={styles.cardPrice}>{booth.price}</Text>}
                  </View>
                </TouchableOpacity>
              ))}
              {listBooths.length === 0 && (
                <Text style={styles.empty}>該当するブースがありません。フィルターを「すべて」に戻すか、検索してみてください。</Text>
              )}
              {/* 詳細シート表示時に最下部が隠れないようスペーサー */}
              {selectedBooth && <View style={{ height: 260 }} />}
            </ScrollView>
          </View>
        )}
      </View>

      {/* ===== ルート表示中: 地図を見せるためのコンパクトな下部バー ===== */}
      {selectedBooth && routeActive && (
        <View style={styles.routeBar}>
          <View style={styles.routeBarTop}>
            <View style={styles.flex}>
              <Text style={styles.routeBarName} numberOfLines={1}>🧭 {selectedBooth.name}</Text>
              {(() => {
                // 実ルートの結果があればそれを優先表示、無ければ直線目安
                if (routeInfo && routeInfo.mode === 'pedestrian' && routeInfo.seconds != null) {
                  const min = Math.max(1, Math.round(routeInfo.seconds / 60));
                  const m = routeInfo.meters ?? 0;
                  const d = m < 1000 ? `${m}m` : `${(m / 1000).toFixed(1)}km`;
                  return <Text style={styles.routeBarEst}>徒歩ルート 約{min}分（{d}）</Text>;
                }
                if (routeInfo && routeInfo.mode === 'straight') {
                  const est = walkEstimate(selectedBooth);
                  return (
                    <Text style={styles.routeBarEst}>
                      {est ? `直線目安 約${est.minutes}分（${est.distLabel}）※徒歩ルート取得失敗` : 'ルート計算中…'}
                    </Text>
                  );
                }
                return <Text style={styles.routeBarEst}>徒歩ルートを計算中…</Text>;
              })()}
            </View>
            <TouchableOpacity style={styles.routeBarClose} onPress={() => setRouteActive(false)} hitSlop={8}>
              <Text style={styles.routeBarCloseText}>ルートを消す</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.navBtnWide} onPress={() => openExternalWalkNav(selectedBooth)} activeOpacity={0.9}>
              <Text style={styles.navBtnText}>Googleマップで案内</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.bookBtnSm, { backgroundColor: getBrandColor(selectedBooth.brand) }]}
              onPress={() => handleOpenBooking(selectedBooth)}
              activeOpacity={0.9}
            >
              <Text style={styles.bookBtnSmText}>{isPremium ? '⚡ 予約' : '🔒 予約'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ===== 詳細ボトムシート(通常時) ===== */}
      {selectedBooth && !routeActive && (
        <>
          <Pressable style={styles.sheetBackdrop} onPress={closeSheet} />
          <View style={styles.sheet}>
            <View style={styles.sheetHandle} />
            <View style={styles.sheetHead}>
              <View style={[styles.brandTag, { backgroundColor: getBrandColor(selectedBooth.brand) }]}>
                <Text style={styles.brandTagText}>{selectedBooth.brand}</Text>
              </View>
              {!!selectedBooth.count && (
                <View style={styles.sheetCount}>
                  <Text style={styles.sheetCountText}>{selectedBooth.count}</Text>
                </View>
              )}
              <View style={styles.flex} />
              <TouchableOpacity style={styles.sheetClose} onPress={closeSheet} hitSlop={8}>
                <Text style={styles.sheetCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.sheetBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.sheetName}>{selectedBooth.name}</Text>
              <Text style={styles.sheetStation}>🚉 {selectedBooth.station || '最寄駅情報なし'}</Text>
              <Text style={styles.sheetAddr}>📍 {selectedBooth.address}</Text>
              {!!selectedBooth.details && (
                <View style={styles.sheetNote}>
                  <Text style={styles.sheetNoteText}>{selectedBooth.details}</Text>
                </View>
              )}
              <View style={styles.sheetInfoRow}>
                <Text style={styles.sheetInfoLabel}>🕒 営業時間</Text>
                <Text style={styles.sheetInfoValue}>{selectedBooth.hours || '情報なし'}</Text>
              </View>
              <View style={styles.sheetInfoRow}>
                <Text style={styles.sheetInfoLabel}>💰 料金</Text>
                <Text style={styles.sheetInfoValue}>{selectedBooth.price || '情報なし'}</Text>
              </View>

              {/* 現在地からの徒歩目安 */}
              {(() => {
                const est = walkEstimate(selectedBooth);
                return (
                  <View style={styles.walkInfo}>
                    <Text style={styles.walkInfoText}>
                      {est
                        ? `🚶 現在地から 徒歩 約${est.minutes}分（${est.distLabel}・直線目安）`
                        : '🚶 「現在地」を取得すると、ここまでの徒歩時間が表示されます'}
                    </Text>
                  </View>
                );
              })()}
            </ScrollView>

            {/* 道案内・予約アクション */}
            <View style={styles.actionRow}>
              <TouchableOpacity
                style={[styles.routeBtn, routeActive && styles.routeBtnActive]}
                onPress={() => handleRoutePress(selectedBooth)}
                activeOpacity={0.9}
              >
                <Text style={[styles.routeBtnText, routeActive && styles.routeBtnTextActive]}>
                  {!isPremium
                    ? '🔒 徒歩ルート'
                    : Platform.OS === 'web'
                    ? (routeActive ? '🧭 ルートを消す' : '🧭 徒歩ルート')
                    : '🧭 徒歩でナビ'}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.navBtn}
                onPress={() => {
                  if (!requirePremium('徒歩ルート案内', () => openExternalWalkNav(selectedBooth))) return;
                  openExternalWalkNav(selectedBooth);
                }}
                activeOpacity={0.9}
              >
                <Text style={styles.navBtnText}>Googleマップ</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={[styles.bookBtn, { backgroundColor: getBrandColor(selectedBooth.brand) }]}
              onPress={() => handleOpenBooking(selectedBooth)}
              activeOpacity={0.9}
            >
              <Text style={styles.bookBtnText}>
                {isPremium ? '⚡ 予約サイトを開く' : '🔒 予約する（プレミアム機能）'}
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* ===== ペイウォール(課金) ===== */}
      <Paywall
        visible={showPaywall}
        purchasing={purchasing}
        context={paywallContext}
        onPurchase={handlePurchase}
        onRestore={handleRestore}
        onRedeemCoupon={handleRedeemCoupon}
        onClose={() => {
          setShowPaywall(false);
          pendingActionRef.current = null;
        }}
      />

      {isLoading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#2563EB" />
          <Text style={styles.loaderText}>現在地を取得中…</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F1F5F9' },
  flex: { flex: 1 },

  // Header
  header: {
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'android' ? 36 : 6,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5E7EB',
    zIndex: 10,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  headerTitle: { fontSize: 19, fontWeight: '800', color: '#0F172A', letterSpacing: 0.2 },
  headerSub: { fontSize: 11, color: '#94A3B8', marginTop: 2 },
  authPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
    borderWidth: 1,
  },
  authPillOn: { backgroundColor: '#FEF3C7', borderColor: '#FCD34D' },
  authPillOff: { backgroundColor: '#F9FAFB', borderColor: '#E5E7EB' },
  authPillText: { fontSize: 12, fontWeight: '800' },

  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    height: 46,
  },
  searchIcon: { fontSize: 14, marginRight: 6 },
  searchInput: { flex: 1, fontSize: 14, color: '#0F172A', borderWidth: 0, outlineStyle: 'none' } as any,
  searchClear: { color: '#94A3B8', fontSize: 13, paddingHorizontal: 8, fontWeight: '700' },
  searchGo: { backgroundColor: '#2563EB', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 8 },
  searchGoText: { color: '#fff', fontSize: 13, fontWeight: '700' },

  segment: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 12,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 3,
  },
  segmentItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  segmentItemActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
    elevation: 2,
  },
  segmentText: { fontSize: 13, fontWeight: '700', color: '#94A3B8' },
  segmentTextActive: { color: '#0F172A' },

  chips: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
    marginHorizontal: 4,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  chipText: { fontSize: 12, fontWeight: '700', color: '#475569' },
  chipTextActive: { color: '#fff' },
  chipCount: { fontSize: 11, fontWeight: '700', color: '#CBD5E1', marginLeft: 6 },

  // Content
  content: { flex: 1 },

  mapBadge: {
    position: 'absolute',
    top: 12,
    alignSelf: 'center',
    backgroundColor: 'rgba(15,23,42,0.82)',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
  },
  mapBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  locBtn: {
    position: 'absolute',
    bottom: 20,
    right: 16,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 4,
  },
  locBtnText: { fontSize: 13, fontWeight: '800', color: '#0F172A' },

  // List
  listHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#EEF2F7',
  },
  listHeaderText: { fontSize: 12, fontWeight: '800', color: '#475569' },
  listHeaderAction: { fontSize: 12, fontWeight: '800', color: '#2563EB' },
  listContent: { padding: 14 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#EEF2F7',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
    elevation: 1,
  },
  cardActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  cardTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  cardDist: { fontSize: 11, fontWeight: '700', color: '#64748B' },
  cardName: { fontSize: 15, fontWeight: '800', color: '#0F172A', marginBottom: 3 },
  cardStation: { fontSize: 12, color: '#475569', marginBottom: 2 },
  cardAddr: { fontSize: 11, color: '#94A3B8', marginBottom: 8 },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  cardMeta: { fontSize: 10, color: '#94A3B8', flex: 1 },
  cardPrice: { fontSize: 12, fontWeight: '800', color: '#059669', marginLeft: 8 },
  empty: { textAlign: 'center', color: '#94A3B8', fontSize: 13, lineHeight: 20, paddingVertical: 60, paddingHorizontal: 24 },

  brandTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, alignSelf: 'flex-start' },
  brandTagText: { color: '#fff', fontSize: 10, fontWeight: '800' },

  // Bottom sheet
  sheetBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(15,23,42,0.25)', zIndex: 25 },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 32 : 18,
    paddingTop: 8,
    maxHeight: '62%',
    zIndex: 26,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 16,
  },
  sheetHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 12 },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  sheetCount: { backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: 8 },
  sheetCountText: { fontSize: 11, color: '#475569', fontWeight: '700' },
  sheetClose: { backgroundColor: '#F1F5F9', width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  sheetCloseText: { color: '#94A3B8', fontSize: 13, fontWeight: '800' },
  sheetBody: { marginBottom: 14 },
  sheetName: { fontSize: 19, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  sheetStation: { fontSize: 13, color: '#475569', marginBottom: 3 },
  sheetAddr: { fontSize: 13, color: '#64748B', marginBottom: 10 },
  sheetNote: { backgroundColor: '#F8FAFC', borderLeftWidth: 3, borderLeftColor: '#CBD5E1', padding: 11, borderRadius: 8, marginBottom: 12 },
  sheetNoteText: { fontSize: 12, color: '#475569', lineHeight: 18 },
  sheetInfoRow: { marginBottom: 10 },
  sheetInfoLabel: { fontSize: 11, fontWeight: '800', color: '#94A3B8', marginBottom: 2 },
  sheetInfoValue: { fontSize: 13, color: '#334155', lineHeight: 18 },
  walkInfo: { backgroundColor: '#EFF6FF', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginTop: 2 },
  walkInfoText: { fontSize: 12.5, color: '#1D4ED8', fontWeight: '700' },
  actionRow: { flexDirection: 'row', marginBottom: 10 },
  routeBtn: {
    flex: 1,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#2563EB',
    marginRight: 8,
  },
  routeBtnActive: { backgroundColor: '#2563EB' },
  routeBtnText: { color: '#2563EB', fontSize: 14, fontWeight: '800' },
  routeBtnTextActive: { color: '#fff' },
  navBtn: {
    width: 130,
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  navBtnText: { color: '#334155', fontSize: 13, fontWeight: '700' },
  bookBtn: { height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  bookBtnText: { color: '#fff', fontSize: 15, fontWeight: '800' },

  // ルート表示中のコンパクト下部バー(地図を覆い隠さない)
  routeBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === 'ios' ? 28 : 14,
    zIndex: 26,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -3 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 14,
  },
  routeBarTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  routeBarName: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  routeBarEst: { fontSize: 12, fontWeight: '700', color: '#1D4ED8', marginTop: 2 },
  routeBarClose: { backgroundColor: '#F1F5F9', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, marginLeft: 10 },
  routeBarCloseText: { fontSize: 12, fontWeight: '800', color: '#475569' },
  navBtnWide: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    marginRight: 8,
  },
  bookBtnSm: { width: 110, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  bookBtnSmText: { color: '#fff', fontSize: 14, fontWeight: '800' },

  loader: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.7)', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  loaderText: { marginTop: 12, fontSize: 13, fontWeight: '800', color: '#2563EB' },
});
