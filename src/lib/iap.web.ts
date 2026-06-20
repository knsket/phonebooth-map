// Web 向け In-App Purchase スタブ(Webにストア課金は無い)。
// Metro が Web ビルド時にこちらを解決する。expo-iap(ネイティブ専用)は読み込まれない。

export interface IapHandlers {
  onPurchase: (purchase: any) => Promise<void> | void;
  onError: (error: any) => void;
}

export interface ActiveSub {
  productId: string;
  expiresMs: number | null;
}

export const IAP_SUPPORTED = false;

export async function iapConnect(_skus: string[], _handlers: IapHandlers): Promise<boolean> {
  return false;
}

export async function iapDisconnect(): Promise<void> {}

export async function iapPurchaseSubscription(_productId: string): Promise<void> {}

export async function iapFinish(_purchase: any): Promise<void> {}

export async function iapGetActive(_skus: string[]): Promise<ActiveSub[]> {
  return [];
}

export function iapExtractIosJws(_purchase: any): string | null {
  return null;
}

export function iapExtractAndroidToken(_purchase: any): string | null {
  return null;
}
