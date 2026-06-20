import boothsData from '../data/booths.json';
import { supabase, isSupabaseConfigured } from './supabase';
import { isExcludedBrand } from './brands';

export interface Booth {
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

// バンドル済みのローカルデータ(オフライン/フォールバック用)
export const LOCAL_BOOTHS: Booth[] = (boothsData as Booth[]).filter((b) => !isExcludedBrand(b.brand));

// booths_nearby RPC の行をアプリの Booth 型へ変換
function mapRow(r: any): Booth {
  return {
    id: String(r.booth_id ?? ''),
    brand: r.brand ?? '',
    company: r.company ?? '',
    name: r.name ?? '',
    prefecture: r.prefecture ?? '',
    address: r.address ?? '',
    station: r.station ?? '',
    details: r.details ?? '',
    hours: r.hours ?? '',
    count: r.count ?? '',
    price: r.price ?? '',
    url: r.url ?? '',
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
  };
}

export type BoothSource = 'supabase' | 'local';

/**
 * 全ブースを取得する(ハイブリッド)。
 * Supabaseが設定済みなら booths_nearby RPC を日本全域(半径3000km)で1回呼んで全件取得し、
 * 失敗時・未設定時はバンドル済みのローカルJSONにフォールバックする。
 * データ件数は約1,300件と小さいため、起動時に一括取得して以降はクライアント側で
 * 絞り込み/並び替えする方式(高速・オフライン耐性あり)。
 */
export async function fetchAllBooths(): Promise<{ booths: Booth[]; source: BoothSource }> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.rpc('booths_nearby', {
        p_lat: 36.2,
        p_lng: 138.2,
        p_radius_m: 3_000_000,
        p_limit: 5000,
      });
      if (!error && Array.isArray(data) && data.length > 0) {
        const booths = data.map(mapRow).filter((b: Booth) => !isExcludedBrand(b.brand));
        return { booths, source: 'supabase' };
      }
    } catch {
      /* フォールバックへ */
    }
  }
  return { booths: LOCAL_BOOTHS, source: 'local' };
}

/**
 * 現在地周辺のブースをサーバー側(PostGIS)で取得する。
 * データ件数が将来大きく増えた場合に、こちらへ切り替えてサーバー絞り込みにできる。
 */
export async function fetchNearbyBooths(
  lat: number,
  lng: number,
  radiusM = 30000,
  limit = 500,
  brand?: string
): Promise<{ booths: Booth[]; source: BoothSource }> {
  if (isSupabaseConfigured && supabase) {
    try {
      const { data, error } = await supabase.rpc('booths_nearby', {
        p_lat: lat,
        p_lng: lng,
        p_radius_m: radiusM,
        p_limit: limit,
        p_brand: brand ?? null,
      });
      if (!error && Array.isArray(data)) {
        const booths = data.map(mapRow).filter((b: Booth) => !isExcludedBrand(b.brand));
        return { booths, source: 'supabase' };
      }
    } catch {
      /* フォールバックへ */
    }
  }
  return { booths: LOCAL_BOOTHS, source: 'local' };
}
