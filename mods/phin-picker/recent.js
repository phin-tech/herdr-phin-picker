// How much you use each repo. One decaying number per path: a use adds 1, and it
// halves every two weeks, so often and recently both count and a repo you've left
// fades on its own.

const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const KEEP = 300;

export const scoreAt = (entry, now) => (entry ? entry.score * 0.5 ** ((now - entry.at) / HALF_LIFE_MS) : 0);

export function recordUse(recent, path, now) {
  const next = { ...recent, [path]: { score: scoreAt(recent[path], now) + 1, at: now } };
  const paths = Object.keys(next);
  if (paths.length <= KEEP) return next;
  const kept = paths.sort((a, b) => scoreAt(next[b], now) - scoreAt(next[a], now)).slice(0, KEEP);
  return Object.fromEntries(kept.map((p) => [p, next[p]]));
}
