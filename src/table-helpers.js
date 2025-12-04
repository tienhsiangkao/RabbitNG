export function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const STAKE_REGEX = /\$?\s*(\d+(?:\.\d{2})?)\s*\/\s*\$?\s*(\d+(?:\.\d{2})?)(?:\s*\(\$?\s*(\d+(?:\.\d{2})?)\))?/i;
const STRICT_STAKE_PATTERN = /\$?\d+(?:\.\d{2})?\s+\/\s+\$?\d+(?:\.\d{2})?(?:\s*\(\$?\s*\d+(?:\.\d{2})?\))?/;

export function parseStakes(title) {
  if (!title) return null;
  const match = title.match(STAKE_REGEX);
  if (!match) return null;
  const [, smallStr, bigStr, anteStr] = match;
  const parse = (value) => (value === undefined ? null : Number.parseFloat(value.replace(/,/g, "")));
  return {
    small: parse(smallStr),
    big: parse(bigStr),
    ante: parse(anteStr)
  };
}

export function isStrictRushCashTableTitle(title) {
  if (!title) return false;
  const prefix = /^(?:\[#\]\s*)?Rush\s*&\s*Cash\b/i;
  if (!prefix.test(title)) {
    return false;
  }
  return STRICT_STAKE_PATTERN.test(title);
}

export function buildColorTierRegexFromConfig(config) {
  if (!config?.tiers) return null;
  const names = Object.keys(config.tiers).filter(Boolean);
  if (names.length === 0) return null;
  const namePattern = names.map(escapeRegExp).join("|");
  return new RegExp(
    `^\\[#\\]\\s*(?<game>NLH|NLHA|PLO|PLOA)\\s+(?<tier>${namePattern})\\s+(?<table>\\d{1,3})\\s+-\\s*\\$\\d+(?:\\.\\d{2})?\\s*/\\s*\\$\\d+(?:\\.\\d{2})?(?:\\s*\\(\\$\\d+(?:\\.\\d{2})?\\))?\\s*\\[#\\]$`,
    "i"
  );
}
