import type { Booth } from './boothsRepo';

/** 検索用に正規化(全角半角・大小・空白を揃える) */
export function normalizeForSearch(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\u3000_\-/]+/g, '');
}

const SEARCH_FIELDS: { key: keyof Booth; weight: number }[] = [
  { key: 'name', weight: 100 },
  { key: 'station', weight: 95 },
  { key: 'address', weight: 80 },
  { key: 'prefecture', weight: 70 },
  { key: 'details', weight: 60 },
  { key: 'brand', weight: 50 },
  { key: 'company', weight: 40 },
];

// 英語・略称 → 検索トークンに展開(phone / booth / ブランド名など)
const QUERY_EXPANSIONS: Record<string, string[]> = {
  phone: ['phone', 'booth', 'フォン'],
  booth: ['booth', 'booths', 'ブース'],
  phonebooth: ['phone', 'booth', 'phonebooth', 'フォンブース', 'フォン', 'ブース'],
  telecube: ['telecube', 'テレキューブ', 'tele', 'cube'],
  cocodesk: ['cocodesk', 'coco', 'desk'],
  chatbox: ['chatbox', 'chat', 'box'],
  station: ['station', 'booth'],
  express: ['express', 'work', 'booth', 'lounge'],
  telework: ['telework', 'テレワーク', 'booth'],
};

// ブランド名の英語別名(URLスラッグ・英語入力向け)
const BRAND_ALIASES: Record<string, string[]> = {
  'STATION BOOTH': ['stationbooth', 'station', 'booth'],
  テレキューブ: ['telecube', 'tele', 'cube'],
  CHATBOX: ['chatbox'],
  CocoDesk: ['cocodesk', 'coco', 'desk'],
  'EXPRESS WORK-Booth': ['express', 'work', 'booth', 'expresswork'],
  'EXPRESS WORK-Lounge': ['express', 'work', 'lounge', 'expresswork'],
};

/** 予約URLのスラッグを検索用テキストに(例: kushiro_airport → kushiroairport) */
function urlSlugText(url: string): string {
  const m = url.match(/\/location\/([^/?#]+)/i) ?? url.match(/\/([^/?#]+)\/?$/);
  if (!m) return '';
  return normalizeForSearch(m[1]);
}

/** 英字混じりの名称からラテン文字部分を抽出(BiVi仙台 → bivi) */
function latinParts(text: string): string {
  const parts = text.match(/[a-z0-9]+/gi);
  return parts ? normalizeForSearch(parts.join('')) : '';
}

function brandAliasText(brand: string): string {
  const aliases = BRAND_ALIASES[brand] ?? [];
  return normalizeForSearch(aliases.join(''));
}

function buildExtraSearchText(booth: Booth): string {
  return [urlSlugText(booth.url), latinParts(booth.name), latinParts(booth.station), brandAliasText(booth.brand)]
    .filter(Boolean)
    .join('');
}

function expandQueryTokens(normalizedQuery: string): string[] {
  const tokens = new Set<string>([normalizedQuery]);

  // 完全一致・前方一致するエイリアス群を追加
  for (const [key, values] of Object.entries(QUERY_EXPANSIONS)) {
    const nk = normalizeForSearch(key);
    if (normalizedQuery === nk || normalizedQuery.startsWith(nk) || nk.startsWith(normalizedQuery)) {
      values.forEach((v) => tokens.add(normalizeForSearch(v)));
    }
  }

  // スペース区切りの各トークンも展開
  for (const part of normalizedQuery.split(/[\s\u3000]+/).filter(Boolean)) {
    tokens.add(part);
    const expanded = QUERY_EXPANSIONS[part];
    if (expanded) expanded.forEach((v) => tokens.add(normalizeForSearch(v)));
  }

  return [...tokens];
}

function scoreField(normalizedQuery: string, fieldValue: string, weight: number): number {
  const normalizedField = normalizeForSearch(fieldValue);
  if (!normalizedField) return 0;
  if (normalizedField === normalizedQuery) return weight * 10;
  if (normalizedField.startsWith(normalizedQuery)) return weight * 5;
  if (normalizedField.includes(normalizedQuery)) return weight;
  return 0;
}

function scoreBooth(booth: Booth, queryTokens: string[]): number {
  let score = 0;
  const extra = buildExtraSearchText(booth);

  for (const token of queryTokens) {
    if (!token) continue;

    for (const { key, weight } of SEARCH_FIELDS) {
      score = Math.max(score, scoreField(token, String(booth[key] ?? ''), weight));
    }

    // URLスラッグ・英字部分・ブランド別名(英語入力向け)
    if (extra) {
      if (extra === token) score = Math.max(score, 90);
      else if (extra.startsWith(token)) score = Math.max(score, 75);
      else if (extra.includes(token)) score = Math.max(score, 55);
    }
  }

  // スペース区切りの複合語(例: 「釧路 空港」「kushiro airport」)
  const multi = queryTokens.filter((t) => t.length > 1);
  if (multi.length > 1) {
    const haystack = normalizeForSearch(
      SEARCH_FIELDS.map(({ key }) => String(booth[key] ?? '')).join('') + extra
    );
    if (multi.every((token) => haystack.includes(token))) {
      score = Math.max(score, 85 + multi.length * 5);
    }
  }

  return score;
}

/** ブース一覧を検索語の関連度順に返す */
export function searchBooths(booths: Booth[], query: string): Booth[] {
  const normalizedQuery = normalizeForSearch(query.trim());
  if (!normalizedQuery) return [];

  const queryTokens = expandQueryTokens(normalizedQuery);

  return booths
    .map((booth) => ({ booth, score: scoreBooth(booth, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.booth.name.localeCompare(b.booth.name, 'ja'))
    .map(({ booth }) => booth);
}
