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

// ゼロ件時のフォールバック検索で使う分解キーワード
const FALLBACK_SPLIT_TOKENS = [
  'タワー',
  'ビル',
  'ホテル',
  'プラザ',
  'センター',
  'ステーション',
  'オフィス',
  'カフェ',
  'ワーク',
  'ブース',
  '駅',
  '空港',
];

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

function queryTermsFromInput(query: string): string[] {
  const raw = query.normalize('NFKC').trim();
  if (!raw) return [];
  return raw
    .split(/[\s\u3000]+/)
    .map((part) => normalizeForSearch(part))
    .filter(Boolean);
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

function scoreBoothByToken(booth: Booth, token: string): number {
  if (!token) return 0;
  const extra = buildExtraSearchText(booth);
  let score = 0;

  for (const { key, weight } of SEARCH_FIELDS) {
    score = Math.max(score, scoreField(token, String(booth[key] ?? ''), weight));
  }

  // URLスラッグ・英字部分・ブランド別名(英語入力向け)
  if (extra) {
    if (extra === token) score = Math.max(score, 90);
    else if (extra.startsWith(token)) score = Math.max(score, 75);
    else if (extra.includes(token)) score = Math.max(score, 55);
  }

  return score;
}

function scoreBooth(booth: Booth, queryTokens: string[]): number {
  let score = 0;
  const extra = buildExtraSearchText(booth);

  for (const token of queryTokens) {
    if (!token) continue;
    score = Math.max(score, scoreBoothByToken(booth, token));
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

function scoreBoothWithAndTerms(booth: Booth, termTokenGroups: string[][]): number {
  let total = 0;

  for (const tokenGroup of termTokenGroups) {
    let bestScore = 0;
    for (const token of tokenGroup) {
      bestScore = Math.max(bestScore, scoreBoothByToken(booth, token));
    }
    if (bestScore <= 0) return 0; // 1語でも未一致ならAND不成立
    total += bestScore;
  }

  // 複数語すべてを満たした候補を少し持ち上げる
  return total + termTokenGroups.length * 20;
}

function fallbackSegments(normalizedQuery: string): string[] {
  const tokens = new Set<string>([normalizedQuery]);

  for (const splitToken of FALLBACK_SPLIT_TOKENS) {
    const normalizedSplit = normalizeForSearch(splitToken);
    const idx = normalizedQuery.indexOf(normalizedSplit);
    if (idx <= 0) continue;

    const left = normalizedQuery.slice(0, idx);
    const right = normalizedQuery.slice(idx + normalizedSplit.length);

    if (left.length >= 2) tokens.add(left);
    tokens.add(normalizedSplit);
    if (right.length >= 2) tokens.add(right);
  }

  // 英数字と日本語の境界で分割（例: "tower渋谷", "渋谷tower"）
  const boundaryParts = normalizedQuery
    .split(/(?<=[a-z0-9])(?=[ぁ-んァ-ヶー一-龠])|(?<=[ぁ-んァ-ヶー一-龠])(?=[a-z0-9])/)
    .filter(Boolean);
  for (const part of boundaryParts) {
    if (part.length >= 2) tokens.add(part);
  }

  return [...tokens].sort((a, b) => b.length - a.length);
}

function fallbackScoreBooth(booth: Booth, segments: string[]): number {
  const haystack = normalizeForSearch(
    SEARCH_FIELDS.map(({ key }) => String(booth[key] ?? '')).join('') + buildExtraSearchText(booth)
  );
  if (!haystack) return 0;

  let bestLen = 0;
  let hits = 0;
  for (const segment of segments) {
    if (segment.length < 2) continue;
    if (haystack.includes(segment)) {
      bestLen = Math.max(bestLen, segment.length);
      hits += 1;
    }
  }

  if (bestLen === 0) return 0;
  return bestLen * 100 + hits * 5;
}

/** ブース一覧を検索語の関連度順に返す */
export function searchBooths(booths: Booth[], query: string): Booth[] {
  const terms = queryTermsFromInput(query);
  if (terms.length === 0) return [];

  // スペース区切りで複数語入力された場合は AND 検索
  if (terms.length > 1) {
    const termTokenGroups = terms.map((term) => expandQueryTokens(term));
    return booths
      .map((booth) => ({ booth, score: scoreBoothWithAndTerms(booth, termTokenGroups) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score || a.booth.name.localeCompare(b.booth.name, 'ja'))
      .map(({ booth }) => booth);
  }

  const normalizedQuery = terms[0];

  const queryTokens = expandQueryTokens(normalizedQuery);
  const ranked = booths
    .map((booth) => ({ booth, score: scoreBooth(booth, queryTokens) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.booth.name.localeCompare(b.booth.name, 'ja'));

  if (ranked.length > 0) {
    return ranked.map(({ booth }) => booth);
  }

  // ゼロ件時のみフォールバック検索（複合語や軽い入力ゆれを救済）
  const segments = fallbackSegments(normalizedQuery);
  return booths
    .map((booth) => ({ booth, score: fallbackScoreBooth(booth, segments) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || a.booth.name.localeCompare(b.booth.name, 'ja'))
    .map(({ booth }) => booth);
}
