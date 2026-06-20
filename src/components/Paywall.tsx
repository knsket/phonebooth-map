import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  Platform,
  Linking,
} from 'react-native';
import { PLANS, PlanId } from '../lib/subscription';
import { PRIVACY_POLICY_URL, PUBLISHER_NAME } from '../constants/legal';

interface PaywallProps {
  visible: boolean;
  purchasing: boolean;
  context?: string; // どの機能をアンロックしようとしたか(例: 徒歩ルート案内)
  onPurchase: (planId: PlanId) => void;
  onRestore: () => void;
  onRedeemCoupon: (code: string) => Promise<{ success: boolean; message: string }>;
  onClose: () => void;
}

const BENEFITS = [
  { icon: '🧭', title: '徒歩ルート案内', desc: '現在地から各ブースまでの徒歩ルートを地図に表示' },
  { icon: '🔗', title: '予約ページのアンロック', desc: '各フォンブースの公式予約ページへワンタップで移動' },
];

export default function Paywall({
  visible,
  purchasing,
  context,
  onPurchase,
  onRestore,
  onRedeemCoupon,
  onClose,
}: PaywallProps) {
  const [selected, setSelected] = useState<PlanId>('yearly');
  const [showCoupon, setShowCoupon] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [redeeming, setRedeeming] = useState(false);
  const [couponResult, setCouponResult] = useState<{ success: boolean; message: string } | null>(null);

  const handleRedeem = async () => {
    if (redeeming) return;
    setRedeeming(true);
    setCouponResult(null);
    try {
      const result = await onRedeemCoupon(couponCode);
      setCouponResult(result);
      if (result.success) setCouponCode('');
    } finally {
      setRedeeming(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.handle} />

          <ScrollView showsVerticalScrollIndicator={false}>
            <View style={styles.badge}>
              <Text style={styles.badgeText}>PREMIUM</Text>
            </View>
            <Text style={styles.title}>プレミアムにアップグレード</Text>
            <Text style={styles.subtitle}>
              {context
                ? `「${context}」はプレミアム機能です。登録するとすぐにご利用いただけます。`
                : '徒歩ルート案内と予約ページへのリンクが使い放題になります。'}
            </Text>

            {/* 特典 */}
            <View style={styles.benefits}>
              {BENEFITS.map((b) => (
                <View key={b.title} style={styles.benefitRow}>
                  <Text style={styles.benefitIcon}>{b.icon}</Text>
                  <View style={styles.flex}>
                    <Text style={styles.benefitTitle}>{b.title}</Text>
                    <Text style={styles.benefitDesc}>{b.desc}</Text>
                  </View>
                  <Text style={styles.check}>✓</Text>
                </View>
              ))}
            </View>

            {/* プラン選択 */}
            <View style={styles.plans}>
              {PLANS.map((p) => {
                const active = selected === p.id;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.planCard, active && styles.planCardActive]}
                    onPress={() => setSelected(p.id)}
                    activeOpacity={0.9}
                  >
                    <View style={styles.flex}>
                      <View style={styles.planTitleRow}>
                        <Text style={[styles.planTitle, active && styles.planTitleActive]}>{p.title}</Text>
                        {p.badge && (
                          <View style={styles.planBadge}>
                            <Text style={styles.planBadgeText}>{p.badge}</Text>
                          </View>
                        )}
                      </View>
                      {p.note && <Text style={styles.planNote}>{p.note}</Text>}
                    </View>
                    <View style={styles.planPriceWrap}>
                      <Text style={[styles.planPrice, active && styles.planPriceActive]}>{p.price}</Text>
                      <Text style={styles.planPeriod}>{p.period}</Text>
                    </View>
                    <View style={[styles.radio, active && styles.radioActive]}>
                      {active && <View style={styles.radioDot} />}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>

            <TouchableOpacity
              style={[styles.cta, purchasing && styles.ctaDisabled]}
              onPress={() => onPurchase(selected)}
              disabled={purchasing}
              activeOpacity={0.9}
            >
              {purchasing ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.ctaText}>このプランで始める</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.restore} onPress={onRestore} disabled={purchasing}>
              <Text style={styles.restoreText}>購入を復元する</Text>
            </TouchableOpacity>

            {/* クーポンコード(法人配布など) */}
            <View style={styles.couponWrap}>
              {!showCoupon ? (
                <TouchableOpacity
                  style={styles.couponToggle}
                  onPress={() => setShowCoupon(true)}
                  disabled={purchasing}
                >
                  <Text style={styles.couponToggleText}>🎟 クーポンコードをお持ちの方</Text>
                </TouchableOpacity>
              ) : (
                <View style={styles.couponBox}>
                  <Text style={styles.couponLabel}>クーポンコードを入力</Text>
                  <View style={styles.couponRow}>
                    <TextInput
                      style={styles.couponInput}
                      placeholder="例: CORP-XXXX-2026"
                      placeholderTextColor="#9CA3AF"
                      value={couponCode}
                      onChangeText={(t) => {
                        setCouponCode(t);
                        if (couponResult) setCouponResult(null);
                      }}
                      autoCapitalize="characters"
                      autoCorrect={false}
                      editable={!redeeming}
                      onSubmitEditing={handleRedeem}
                      returnKeyType="done"
                    />
                    <TouchableOpacity
                      style={[styles.couponBtn, (redeeming || !couponCode.trim()) && styles.couponBtnDisabled]}
                      onPress={handleRedeem}
                      disabled={redeeming || !couponCode.trim()}
                      activeOpacity={0.9}
                    >
                      {redeeming ? (
                        <ActivityIndicator color="#fff" size="small" />
                      ) : (
                        <Text style={styles.couponBtnText}>適用</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                  {couponResult && (
                    <Text style={[styles.couponMsg, couponResult.success ? styles.couponMsgOk : styles.couponMsgErr]}>
                      {couponResult.success ? '✓ ' : '⚠ '}
                      {couponResult.message}
                    </Text>
                  )}
                  <Text style={styles.couponHint}>法人プランなどで配布されたコードをお使いいただけます。</Text>
                </View>
              )}
            </View>

            <Text style={styles.legal}>
              ・サブスクリプションは選択した期間ごとに自動更新されます。{'\n'}
              ・解約は App Store / Google Play のサブスクリプション管理からいつでも行えます。{'\n'}
              ・提供: {PUBLISHER_NAME}
            </Text>

            <TouchableOpacity
              style={styles.privacyLink}
              onPress={() => Linking.openURL(PRIVACY_POLICY_URL)}
            >
              <Text style={styles.privacyLinkText}>プライバシーポリシー</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.close} onPress={onClose} disabled={purchasing}>
              <Text style={styles.closeText}>あとで</Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  overlay: { flex: 1, backgroundColor: 'rgba(15,23,42,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: Platform.OS === 'ios' ? 34 : 20,
    maxHeight: '92%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E2E8F0', alignSelf: 'center', marginBottom: 14 },
  badge: { alignSelf: 'flex-start', backgroundColor: '#1D4ED8', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, marginBottom: 10 },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '900', letterSpacing: 1 },
  title: { fontSize: 22, fontWeight: '900', color: '#0F172A', marginBottom: 6 },
  subtitle: { fontSize: 13, color: '#64748B', lineHeight: 19, marginBottom: 18 },

  benefits: { backgroundColor: '#F8FAFC', borderRadius: 16, padding: 14, marginBottom: 18 },
  benefitRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  benefitIcon: { fontSize: 22, marginRight: 12 },
  benefitTitle: { fontSize: 14, fontWeight: '800', color: '#0F172A' },
  benefitDesc: { fontSize: 11.5, color: '#64748B', marginTop: 2 },
  check: { color: '#16A34A', fontWeight: '900', fontSize: 16, marginLeft: 8 },

  plans: { marginBottom: 16 },
  planCard: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#E5E7EB',
    borderRadius: 16,
    padding: 16,
    marginBottom: 10,
  },
  planCardActive: { borderColor: '#2563EB', backgroundColor: '#EFF6FF' },
  planTitleRow: { flexDirection: 'row', alignItems: 'center' },
  planTitle: { fontSize: 15, fontWeight: '800', color: '#334155' },
  planTitleActive: { color: '#1D4ED8' },
  planBadge: { backgroundColor: '#F59E0B', borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 8 },
  planBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  planNote: { fontSize: 11.5, color: '#94A3B8', marginTop: 3 },
  planPriceWrap: { alignItems: 'flex-end', marginRight: 12 },
  planPrice: { fontSize: 18, fontWeight: '900', color: '#334155' },
  planPriceActive: { color: '#1D4ED8' },
  planPeriod: { fontSize: 10, color: '#94A3B8' },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: '#CBD5E1', alignItems: 'center', justifyContent: 'center' },
  radioActive: { borderColor: '#2563EB' },
  radioDot: { width: 11, height: 11, borderRadius: 6, backgroundColor: '#2563EB' },

  cta: { height: 52, borderRadius: 15, backgroundColor: '#2563EB', alignItems: 'center', justifyContent: 'center' },
  ctaDisabled: { opacity: 0.7 },
  ctaText: { color: '#fff', fontSize: 16, fontWeight: '900' },
  restore: { alignItems: 'center', paddingVertical: 12 },
  restoreText: { color: '#2563EB', fontSize: 13, fontWeight: '700' },

  couponWrap: { marginTop: 2, marginBottom: 4 },
  couponToggle: { alignItems: 'center', paddingVertical: 8 },
  couponToggleText: { color: '#64748B', fontSize: 13, fontWeight: '700' },
  couponBox: { backgroundColor: '#F8FAFC', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: '#E2E8F0' },
  couponLabel: { fontSize: 12, fontWeight: '800', color: '#475569', marginBottom: 8 },
  couponRow: { flexDirection: 'row', alignItems: 'center' },
  couponInput: {
    flex: 1,
    height: 46,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 11,
    paddingHorizontal: 12,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginRight: 8,
    outlineStyle: 'none',
  } as any,
  couponBtn: {
    minWidth: 64,
    height: 46,
    borderRadius: 11,
    backgroundColor: '#2563EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },
  couponBtnDisabled: { opacity: 0.5 },
  couponBtnText: { color: '#fff', fontSize: 14, fontWeight: '800' },
  couponMsg: { fontSize: 12, fontWeight: '700', marginTop: 10, lineHeight: 17 },
  couponMsgOk: { color: '#16A34A' },
  couponMsgErr: { color: '#DC2626' },
  couponHint: { fontSize: 10.5, color: '#94A3B8', marginTop: 8, lineHeight: 15 },
  legal: { fontSize: 10.5, color: '#94A3B8', lineHeight: 16, marginTop: 4, marginBottom: 4 },
  privacyLink: { alignItems: 'center', paddingVertical: 6, marginBottom: 4 },
  privacyLinkText: { color: '#2563EB', fontSize: 11.5, fontWeight: '700', textDecorationLine: 'underline' },
  close: { alignItems: 'center', paddingVertical: 10 },
  closeText: { color: '#94A3B8', fontSize: 14, fontWeight: '700' },
});
