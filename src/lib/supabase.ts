import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';

/**
 * Supabase クライアント。
 *
 * ログイン不要の方針のため、認証セッションの永続化は無効化している。
 * 環境変数は app の起動前に .env で設定し、Expo の EXPO_PUBLIC_ プレフィックスで
 * クライアントに埋め込む(値が空ならクライアントは null になり、アプリはローカルJSONで動作)。
 */

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
  : null;
