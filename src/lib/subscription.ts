import { useState, useCallback, useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { supabase, isSupabaseConfigured } from './supabase';
import { getAppUserId } from './device';
import {
  IAP_SUPPORTED,
  iapConnect,
  iapDisconnect,
  iapPurchaseSubscription,
  iapFinish,
  iapGetActive,
  iapExtractIosJws,
  iapExtractAndroidToken,
} from './iap';

/**
 * サブスクリプション(課金)状態の抽象レイヤ。
 *
 * 現状はUI確認用の「モック実装」。購入ボタンを押すと擬似的に課金状態になる。
 * 本番では purchase() / restore() の中身を以下に差し替える:
 *   - ストア課金: expo-in-app-purchases もしくは react-native-iap / RevenueCat で productId を購入
 *   - レシート検証: 取得したレシートを Supabase Edge Function へ送ってサーバー検証
 *   - 状態確定: 検証OKなら Entitlement を確定し、Supabase の購読テーブルと同期
 *
 * productId はストア(App Store / Google Play)に登録済みの商品IDに合わせること。
 * price は表示用の暫定値。本番ではストアから取得したローカライズ価格を使う。
 */

export type PlanId = 'monthly' | 'yearly';

export interface Plan {
  id: PlanId;
  productId: string; // ストアに登録した商品ID(要差し替え)
  title: string;
  price: string; // 表示用の暫定価格(要差し替え)
  period: string;
  note?: string;
  badge?: string;
}

export const PLANS: Plan[] = [
  {
    id: 'monthly',
    productId: 'jp.oneofthem.phonebooth.1month',
    title: '1ヶ月プラン',
    price: '¥200',
    period: '月額',
    note: 'いつでも解約できます',
  },
  {
    id: 'yearly',
    productId: 'jp.oneofthem.phonebooth.12month',
    title: '12ヶ月プラン',
    price: '¥1,200',
    period: '年額',
    note: '1ヶ月あたり 約¥100',
    badge: '50%お得',
  },
];

export interface Entitlement {
  active: boolean;
  plan: PlanId | null;
  expiresAt: number | null; // epoch ms
}

const EMPTY: Entitlement = { active: false, plan: null, expiresAt: null };
const STORAGE_KEY = 'pb_entitlement';

// デモ用の簡易永続化(Webのみ localStorage。ネイティブはメモリ保持)。
// 本番では Supabase / SecureStore に置き換える。
function loadEntitlement(): Entitlement {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as Entitlement;
    }
  } catch {
    /* ignore */
  }
  return EMPTY;
}

function saveEntitlement(e: Entitlement) {
  try {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(e));
    }
  } catch {
    /* ignore */
  }
}

export function planLabel(plan: PlanId | null): string {
  if (plan === 'monthly') return '1ヶ月プラン';
  if (plan === 'yearly') return '12ヶ月プラン';
  return '無料プラン';
}

function planFromProductId(productId: string): PlanId {
  return productId.endsWith('.12month') ? 'yearly' : 'monthly';
}

const productIdForPlan = (planId: PlanId): string | undefined =>
  PLANS.find((p) => p.id === planId)?.productId;

const ALL_PRODUCT_IDS = PLANS.map((p) => p.productId);

// サーバー(get_subscription)の行 → Entitlement
function rowToEntitlement(row: any): Entitlement {
  const active =
    !!row &&
    row.status === 'active' &&
    (!row.current_period_end || new Date(row.current_period_end).getTime() > Date.now());
  if (!active) return EMPTY;
  return {
    active: true,
    plan: row.plan === 'yearly' ? 'yearly' : 'monthly',
    expiresAt: row.current_period_end ? new Date(row.current_period_end).getTime() : null,
  };
}

// 端末の購入(レシート)をEdge Functionでサーバー検証し、Entitlementを返す。
async function verifyOnServer(params: {
  productId: string;
  jws?: string | null;
  purchaseToken?: string | null;
}): Promise<Entitlement | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const appUserId = await getAppUserId();
    const { data, error } = await supabase.functions.invoke('verify-receipt', {
      body: {
        app_user_id: appUserId,
        platform: Platform.OS,
        product_id: params.productId,
        plan: planFromProductId(params.productId),
        jws: params.jws ?? undefined,
        purchase_token: params.purchaseToken ?? undefined,
      },
    });
    if (!error && data?.active) {
      return {
        active: true,
        plan: data.plan === 'yearly' ? 'yearly' : 'monthly',
        expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
      };
    }
  } catch {
    /* 検証/通信失敗 */
  }
  return null;
}

export function useSubscription() {
  const [entitlement, setEntitlement] = useState<Entitlement>(() => loadEntitlement());
  const [purchasing, setPurchasing] = useState(false);
  // 購入要求中のPromiseを、IAPのイベント(成功/失敗)で解決するためのブリッジ
  const pendingResolveRef = useRef<((ok: boolean) => void) | null>(null);

  const applyEntitlement = useCallback((e: Entitlement) => {
    setEntitlement(e);
    saveEntitlement(e);
  }, []);

  const finishPending = useCallback((ok: boolean) => {
    setPurchasing(false);
    const resolve = pendingResolveRef.current;
    pendingResolveRef.current = null;
    if (resolve) resolve(ok);
  }, []);

  // 起動時: ネイティブは IAP に接続し、実際の購読状態を反映。Webは Supabase の状態を反映。
  useEffect(() => {
    let cancelled = false;

    const handlePurchase = async (purchase: any) => {
      try {
        const productId: string = purchase?.productId ?? purchase?.id ?? '';
        const jws = iapExtractIosJws(purchase);
        const purchaseToken = iapExtractAndroidToken(purchase);
        const verified = await verifyOnServer({ productId, jws, purchaseToken });
        const next: Entitlement =
          verified ?? { active: true, plan: planFromProductId(productId), expiresAt: null };
        applyEntitlement(next);
        await iapFinish(purchase); // 検証後に必ずトランザクションを完了
        finishPending(true);
      } catch {
        finishPending(false);
      }
    };

    const handleError = (_error: any) => {
      // ユーザーキャンセル含む。購入要求は未成立として閉じる。
      finishPending(false);
    };

    (async () => {
      if (Platform.OS !== 'web' && IAP_SUPPORTED) {
        try {
          await iapConnect(ALL_PRODUCT_IDS, { onPurchase: handlePurchase, onError: handleError });
          const active = await iapGetActive(ALL_PRODUCT_IDS);
          if (cancelled) return;
          if (active.length > 0) {
            const a = active[0];
            applyEntitlement({
              active: true,
              plan: planFromProductId(a.productId),
              expiresAt: a.expiresMs,
            });
          }
        } catch {
          /* 接続失敗時はローカルキャッシュのまま */
        }
        return;
      }

      // Web: Supabaseの購読状態と突き合わせ
      if (!isSupabaseConfigured || !supabase) return;
      try {
        const appUserId = await getAppUserId();
        const { data } = await supabase.rpc('get_subscription', { p_app_user_id: appUserId });
        if (cancelled) return;
        const row = Array.isArray(data) ? data[0] : null;
        if (row) applyEntitlement(rowToEntitlement(row));
      } catch {
        /* オフライン等 */
      }
    })();

    return () => {
      cancelled = true;
      if (Platform.OS !== 'web' && IAP_SUPPORTED) {
        iapDisconnect();
      }
    };
  }, [applyEntitlement, finishPending]);

  const purchase = useCallback(
    async (planId: PlanId): Promise<boolean> => {
      // ネイティブ: 実際のストア課金(イベント方式)。結果は購入リスナーで確定。
      if (Platform.OS !== 'web' && IAP_SUPPORTED) {
        const productId = productIdForPlan(planId);
        if (!productId) return false;
        setPurchasing(true);
        return new Promise<boolean>((resolve) => {
          pendingResolveRef.current = resolve;
          iapPurchaseSubscription(productId).catch(() => finishPending(false));
        });
      }

      // Web: 実課金が無いため、Edge Function の demo検証で擬似的に有効化(動作確認用)。
      setPurchasing(true);
      try {
        const days = planId === 'yearly' ? 365 : 30;
        const fallbackEnd = Date.now() + days * 24 * 60 * 60 * 1000;
        const productId = productIdForPlan(planId);
        let next: Entitlement = { active: true, plan: planId, expiresAt: fallbackEnd };
        if (isSupabaseConfigured && supabase && productId) {
          try {
            const appUserId = await getAppUserId();
            const { data, error } = await supabase.functions.invoke('verify-receipt', {
              body: {
                app_user_id: appUserId,
                platform: 'web',
                plan: planId,
                product_id: productId,
                demo: true,
              },
            });
            if (!error && data?.active) {
              next = {
                active: true,
                plan: data.plan === 'yearly' ? 'yearly' : 'monthly',
                expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : fallbackEnd,
              };
            }
          } catch {
            /* ローカルのみ有効 */
          }
        }
        applyEntitlement(next);
        return true;
      } finally {
        setPurchasing(false);
      }
    },
    [applyEntitlement, finishPending]
  );

  // 購入の復元。ネイティブはストアの購読状態、WebはSupabaseの状態を反映。
  const restore = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'web' && IAP_SUPPORTED) {
      try {
        const active = await iapGetActive(ALL_PRODUCT_IDS);
        if (active.length > 0) {
          const a = active[0];
          const e: Entitlement = {
            active: true,
            plan: planFromProductId(a.productId),
            expiresAt: a.expiresMs,
          };
          applyEntitlement(e);
          return true;
        }
        applyEntitlement(EMPTY);
        return false;
      } catch {
        return entitlement.active;
      }
    }

    if (isSupabaseConfigured && supabase) {
      try {
        const appUserId = await getAppUserId();
        const { data } = await supabase.rpc('get_subscription', { p_app_user_id: appUserId });
        const row = Array.isArray(data) ? data[0] : null;
        const e = rowToEntitlement(row);
        applyEntitlement(e);
        return e.active;
      } catch {
        /* フォールバック */
      }
    }
    const local = loadEntitlement();
    setEntitlement(local);
    return local.active;
  }, [applyEntitlement, entitlement.active]);

  // クーポンコードの適用(12ヶ月無料など)。サーバー(redeem_coupon)で検証し、成功時に反映。
  const redeemCoupon = useCallback(
    async (code: string): Promise<{ success: boolean; message: string }> => {
      const trimmed = (code ?? '').trim();
      if (!trimmed) return { success: false, message: 'クーポンコードを入力してください。' };
      if (!isSupabaseConfigured || !supabase) {
        return { success: false, message: 'オンライン環境でのみクーポンを利用できます。' };
      }
      try {
        const appUserId = await getAppUserId();
        const { data, error } = await supabase.rpc('redeem_coupon', {
          p_app_user_id: appUserId,
          p_code: trimmed,
          p_platform: Platform.OS,
        });
        if (error) return { success: false, message: 'クーポンの適用に失敗しました。時間をおいて再度お試しください。' };

        const row = Array.isArray(data) ? data[0] : data;
        if (!row || !row.success) {
          return { success: false, message: row?.message ?? 'クーポンを適用できませんでした。' };
        }

        const next: Entitlement = {
          active: true,
          plan: row.plan === 'monthly' ? 'monthly' : 'yearly',
          expiresAt: row.current_period_end ? new Date(row.current_period_end).getTime() : null,
        };
        applyEntitlement(next);
        return { success: true, message: row.message ?? 'プレミアムが有効になりました。' };
      } catch {
        return { success: false, message: '通信エラーが発生しました。接続を確認してください。' };
      }
    },
    [applyEntitlement]
  );

  // 解約(デモ/将来のキャンセル処理)。Supabaseにも反映。
  const clear = useCallback(async () => {
    applyEntitlement(EMPTY);
    if (isSupabaseConfigured && supabase) {
      try {
        const appUserId = await getAppUserId();
        await supabase.rpc('cancel_subscription', { p_app_user_id: appUserId });
      } catch {
        /* ignore */
      }
    }
  }, [applyEntitlement]);

  return { entitlement, purchasing, purchase, restore, clear, redeemCoupon };
}
