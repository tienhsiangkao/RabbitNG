// A title supplied and confirmed by this app's user. Do not infer other GG
// table names from this: explicit blind amounts always take precedence.
const CONFIRMED_TITLE_LEVELS = new Map([['nlh gold 08', 500]]);
const LEVEL_COLORS = [
  [2, '#8EC5FF'], [5, '#6EE7D8'], [10, '#A3E0A1'], [25, '#C4B5FD'],
  [50, '#E6B88A'], [100, '#D6DEE8'], [200, '#F4A7B9'], [500, '#F3D27A'],
  [1000, '#A7E5E5'], [2000, '#C3D6FF'], [Infinity, '#F19D88']
];
const AMOUNT = '(?:\\d{1,3}(?:,\\d{3})+|\\d+)(?:\\.\\d{1,2})?';
const BLINDS = new RegExp(`(?<![\\d.,-])\\$?\\s*(${AMOUNT})\\s*/\\s*\\$?\\s*(${AMOUNT})(?![\\d.,])(?:\\s*\\(\\$?\\s*(${AMOUNT})\\))?`, 'i');

export function parseStakes(title) {
  const match = String(title || '').match(BLINDS);
  if (!match) return null;
  const amount = value => value === undefined ? null : Number(value.replaceAll(',', ''));
  const small = amount(match[1]), big = amount(match[2]), ante = amount(match[3]);
  if (!Number.isFinite(small) || !Number.isFinite(big) || small <= 0 || big < small) return null;
  return { small, big, ante };
}

export function stakeBadgeForTitle(title) {
  const name = String(title || '');
  const stakes = parseStakes(name);
  const canonical = name.replace(/\[#\]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  const level = stakes ? Math.round(stakes.big * 10000) / 100 : CONFIRMED_TITLE_LEVELS.get(canonical);
  if (!Number.isFinite(level) || level <= 0) return null;
  const rush = /Rush\s*&\s*Cash/i.test(name);
  const game = /\bPLO(?:A|[456])?\b/i.test(name) ? 'PLO' : 'NL';
  return { level, rush, text: `${rush ? 'Z' : game}${level}`,
    color: LEVEL_COLORS.find(([ceiling]) => level <= ceiling)[1],
    source: stakes ? 'blinds' : 'confirmed-title' };
}
