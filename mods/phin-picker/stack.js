// Which pull requests stack on each other. Pure; ported from herdr-phin-util's
// internal/gh. A layer is { number, title, url, branch, base, fork }.

const layerOf = (pr, fork) => ({ number: pr.number, title: pr.title, url: pr.url, branch: pr.headRefName, base: pr.baseRefName, fork });

export function parseNativeStack(text) {
  const nodes = JSON.parse(text)?.data?.repository?.pullRequest?.stack?.entries?.nodes;
  if (!nodes?.length) return null;
  return [...nodes].sort((a, b) => a.position - b.position).map((n) => layerOf(n.pullRequest, false));
}

// The walk, for stacks gh stack didn't make: open PRs whose base is another's
// head. Down has one answer; up can fork, so it yields a chain per tip.
// `prs` is gh pr list's JSON. Every chain contains `number`, bottom-first.
export function walkStacks(prs, number) {
  const byNumber = new Map(prs.map((p) => [p.number, p]));
  const target = byNumber.get(number);
  if (!target) return [];

  // A fork's head lives in another repo, so a same-named branch here isn't it:
  // a fork's "main" must not read as the parent of everything based on main.
  const byHead = new Map();
  const byBase = new Map();
  for (const p of [...prs].sort((a, b) => a.number - b.number)) {
    if (!p.isCrossRepository && !byHead.has(p.headRefName)) byHead.set(p.headRefName, p);
    byBase.set(p.baseRefName, [...(byBase.get(p.baseRefName) ?? []), p]);
  }

  const seen = new Set([number]);
  const down = [target];
  for (let at = target; ; ) {
    const parent = byHead.get(at.baseRefName);
    if (!parent || seen.has(parent.number)) break;
    seen.add(parent.number);
    down.unshift(parent);
    at = parent;
  }

  const up = (pr, visited) => {
    const above = pr.isCrossRepository ? [] : (byBase.get(pr.headRefName) ?? []).filter((p) => !visited.has(p.number));
    if (!above.length) return [[]];
    return above.flatMap((p) => up(p, new Set([...visited, p.number])).map((rest) => [p, ...rest]));
  };

  return up(target, seen).map((rest) => [...down, ...rest].map((p) => layerOf(p, p.isCrossRepository === true)));
}

export function stackName(t, layers) {
  return `${t.repo}#${layers[0].number}-${layers[layers.length - 1].number}`;
}
