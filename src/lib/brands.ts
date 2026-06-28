// ブランド(サービス)に関するメタデータの単一情報源。
// 配色・除外設定はここに集約する。

// データに実在する6ブランドに対応した配色
export const BRAND_COLORS: { [key: string]: string } = {
  'STATION BOOTH': '#F59E0B',
  'テレキューブ': '#10B981',
  'CHATBOX': '#8B5CF6',
  'CocoDesk': '#3B82F6',
  'EXPRESS WORK-Booth': '#EF4444',
  'EXPRESS WORK-Lounge': '#EC4899',
};

export const DEFAULT_BRAND_COLOR = '#6B7280';

export const getBrandColor = (brand: string): string => BRAND_COLORS[brand] || DEFAULT_BRAND_COLOR;

// 規約上の都合で常時非表示にするブランド(前方一致・アプリ側で固定)。
// 一時的な表示/非表示の出し分けは Supabase の `brands` テーブルの `hidden` で行う
// (こちらは再ビルド不要)。例: CocoDesk / テレキューブ はサーバー側で hidden=true。
export const EXCLUDED_BRAND_PREFIXES = ['EXPRESS WORK'];

export const isExcludedBrand = (brand: string): boolean =>
  EXCLUDED_BRAND_PREFIXES.some((p) => brand.startsWith(p));
