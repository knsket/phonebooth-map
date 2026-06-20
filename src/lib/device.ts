import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * 端末ごとの匿名ユーザーID(app_user_id)。
 * ログイン不要で購読をひも付けるための識別子。初回生成して永続化する。
 *  - Web:     localStorage
 *  - Native:  AsyncStorage
 * ※ネイティブはアプリ再インストールで失われる(購読の引き継ぎが必要になったら
 *   SecureStore/Keychain や軽量サインインの導入を検討)。
 */

const KEY = 'pb_app_user_id';

// RFC4122 v4 相当のUUIDを生成(crypto優先、無ければ簡易生成)
function uuidv4(): string {
  const g: any = globalThis as any;
  if (g.crypto && typeof g.crypto.randomUUID === 'function') {
    return g.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cached: string | null = null;

export async function getAppUserId(): Promise<string> {
  if (cached) return cached;

  try {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.localStorage) {
        const existing = window.localStorage.getItem(KEY);
        if (existing) {
          cached = existing;
          return existing;
        }
        const id = uuidv4();
        window.localStorage.setItem(KEY, id);
        cached = id;
        return id;
      }
    } else {
      const existing = await AsyncStorage.getItem(KEY);
      if (existing) {
        cached = existing;
        return existing;
      }
      const id = uuidv4();
      await AsyncStorage.setItem(KEY, id);
      cached = id;
      return id;
    }
  } catch {
    /* 失敗時はメモリ上の一時IDを返す */
  }

  const fallback = uuidv4();
  cached = fallback;
  return fallback;
}
