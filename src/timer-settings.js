export function timerSeconds(value) {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? Math.max(1, Math.min(60, Math.floor(seconds)))
    : 3;
}
