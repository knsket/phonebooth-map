// ネイティブ(iOS/Android)向け In-App Purchase ラッパー(expo-iap)。
// ※ Web では iap.web.ts が使われる(Metroのプラットフォーム解決)。
//   Expo Go では動作しない。EAS dev build / 本番ビルドで動作する。
import {
  initConnection,
  endConnection,
  fetchProducts,
  requestPurchase,
  finishTransaction,
  purchaseUpdatedListener,
  purchaseErrorListener,
  getActiveSubscriptions,
} from 'expo-iap';

export interface IapHandlers {
  onPurchase: (purchase: any) => Promise<void> | void;
  onError: (error: any) => void;
}

export interface ActiveSub {
  productId: string;
  expiresMs: number | null;
}

export const IAP_SUPPORTED = true;

let connected = false;
let updateSub: { remove?: () => void } | null = null;
let errorSub: { remove?: () => void } | null = null;

export async function iapConnect(skus: string[], handlers: IapHandlers): Promise<boolean> {
  if (connected) return true;
  await initConnection();
  updateSub = purchaseUpdatedListener((purchase: any) => {
    handlers.onPurchase(purchase);
  });
  errorSub = purchaseErrorListener((error: any) => {
    handlers.onError(error);
  });
  try {
    await fetchProducts({ skus, type: 'subs' });
  } catch {
    /* 商品取得失敗でも購入要求は試せる */
  }
  connected = true;
  return true;
}

export async function iapDisconnect(): Promise<void> {
  try {
    updateSub?.remove?.();
    errorSub?.remove?.();
  } catch {
    /* ignore */
  }
  updateSub = null;
  errorSub = null;
  if (connected) {
    try {
      await endConnection();
    } catch {
      /* ignore */
    }
    connected = false;
  }
}

// 購入は「イベント方式」。結果は iapConnect で渡した onPurchase / onError に届く。
export async function iapPurchaseSubscription(productId: string): Promise<void> {
  await requestPurchase({
    request: { apple: { sku: productId }, google: { skus: [productId] } },
    type: 'subs',
  });
}

export async function iapFinish(purchase: any): Promise<void> {
  try {
    await finishTransaction({ purchase, isConsumable: false });
  } catch {
    /* ignore */
  }
}

export async function iapGetActive(skus: string[]): Promise<ActiveSub[]> {
  try {
    const res: any = await getActiveSubscriptions(skus);
    const arr = Array.isArray(res) ? res : [];
    return arr.map((s: any) => ({
      productId: s.productId ?? s.id ?? '',
      expiresMs: s.expirationDateIOS
        ? Number(s.expirationDateIOS)
        : s.expiryTimeMillis
        ? Number(s.expiryTimeMillis)
        : null,
    }));
  } catch {
    return [];
  }
}

// iOS は StoreKit2 の JWS(署名付きトランザクション)。purchaseToken に格納される。
export function iapExtractIosJws(purchase: any): string | null {
  return purchase?.purchaseToken ?? purchase?.jwsRepresentationIOS ?? null;
}

// Android の購入トークン
export function iapExtractAndroidToken(purchase: any): string | null {
  return purchase?.purchaseToken ?? purchase?.purchaseTokenAndroid ?? null;
}
