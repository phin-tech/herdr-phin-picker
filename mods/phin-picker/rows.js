// The picker's rows and the rules behind them. Pure, so Node can test it.
// A checkout with a Space never appears twice: you get the Space.

import { labelFor, branchFor, parse, parseRepoShorthand } from "./target.js";

const basename = (p) => p.replace(/\/+$/, "").split("/").pop();

export function shortenHome(path, home) {
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

export function subsequence(query, text) {
  let at = 0;
  const q = [...query];
  for (const ch of text) if (ch === q[at] && ++at === q.length) return true;
  return q.length === 0;
}

// Name matches first, then path matches, each in list order.
export function rank(query, rows) {
  const q = query.toLowerCase();
  const name = rows.filter((r) => subsequence(q, r.label.toLowerCase()));
  const detail = rows.filter((r) => !name.includes(r) && subsequence(q, (r.detail ?? "").toLowerCase()));
  return [...name, ...detail];
}

// Where each local Space is: its first terminal pane's live folder, else its own.
export function spaceFolders(spaces, panes) {
  const out = new Map();
  for (const s of spaces) {
    if (s.machine) continue;
    const tabs = new Set(s.tabs.map((t) => t.id));
    const first = panes.find((p) => tabs.has(p.tab) && p.cwd);
    const folder = first?.cwd ?? s.folder;
    if (folder) out.set(s.id, folder.replace(/\/+$/, "") || "/");
  }
  return out;
}

export function projectRows({ spaces, panes, paths, home }) {
  const folders = spaceFolders(spaces, panes);
  const occupied = new Set(folders.values());
  const rows = spaces.map((s) => {
    const path = folders.get(s.id) ?? "";
    const where = s.machine ? `on ${s.machine}` : path ? shortenHome(path, home) : `${s.tabs.length} tabs`;
    return { kind: "space", label: s.name, path, spaceId: s.id, focused: s.active, detail: s.active ? `current · ${where}` : where };
  });
  // The Space you're in is the least useful one to switch to.
  rows.sort((a, b) => a.focused - b.focused);
  for (const path of paths) {
    if (!occupied.has(path)) rows.push({ kind: "project", label: basename(path), path, detail: shortenHome(path, home) });
  }
  return rows;
}

export function parseWorktrees(text) {
  const out = [];
  for (const block of text.split("\n\n")) {
    const w = {};
    for (const line of block.split("\n")) {
      const at = line.indexOf(" ");
      const key = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? "" : line.slice(at + 1);
      if (key === "worktree") w.path = value;
      else if (key === "branch") w.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "bare") w.bare = true;
      else if (key === "detached") w.detached = true;
      else if (key === "prunable") w.prunable = true;
    }
    if (w.path) out.push(w);
  }
  return out;
}

// Local before remote, alphabetical within each. A remote branch that exists
// locally is the same branch, so only the local one is offered.
export function parseBranches(text) {
  const local = new Set();
  const remote = new Set();
  for (const ref of text.split("\n").map((l) => l.trim())) {
    if (ref.startsWith("refs/heads/")) local.add(ref.slice("refs/heads/".length));
    else if (ref.startsWith("refs/remotes/")) {
      const name = ref.slice("refs/remotes/".length).split("/").slice(1).join("/");
      if (name && name !== "HEAD") remote.add(name);
    }
  }
  return [
    ...[...local].sort().map((name) => ({ name, remote: false })),
    ...[...remote].filter((n) => !local.has(n)).sort().map((name) => ({ name, remote: true })),
  ];
}

export function worktreeLabel(w) {
  if (w.branch) return w.branch;
  return w.detached ? `(detached) ${basename(w.path)}` : basename(w.path);
}

export function spaceLabel(repoName, branch) {
  if (!branch) return repoName;
  return repoName.toLowerCase() === branch.toLowerCase() ? repoName : `${repoName}/${branch}`;
}

export function worktreeRows({ worktrees, branches, repo, spaces, panes, home }) {
  const bySpace = new Map([...spaceFolders(spaces, panes)].map(([id, folder]) => [folder, id]));
  const rows = [];
  const checkedOut = new Set();
  for (const w of worktrees) {
    if (w.bare) continue;
    if (w.branch) checkedOut.add(w.branch);
    const label = worktreeLabel(w);
    const row = { kind: "worktree", label, path: w.path, branch: w.branch ?? "", detail: shortenHome(w.path, home) };
    if (bySpace.has(w.path)) rows.push({ ...row, kind: "space", spaceId: bySpace.get(w.path) });
    else if (w.prunable) rows.push({ ...row, kind: "prunable", detail: "missing on disk — git worktree prune" });
    else rows.push(row);
  }
  for (const b of branches) {
    if (checkedOut.has(b.name)) continue;
    rows.push({
      kind: b.remote ? "remote_branch" : "branch", label: b.name, branch: b.name,
      path: repo.root, detail: b.remote ? "origin — fetched on open" : "no worktree yet",
    });
  }
  return rows;
}

export function newBranchRow(repo, name) {
  return {
    kind: "new_branch", label: name, branch: name, path: repo.root,
    detail: repo.defaultBranch ? `new branch from ${repo.defaultBranch}` : "new branch",
  };
}

export const hasExactBranch = (rows, name) => rows.some((r) => r.branch === name);

// A ticket's branch is already named, so all that's left to choose is its base.
export function linearBaseRows(repo, ticket, rows) {
  const branch = branchFor(ticket);
  const out = [];
  const add = (base, detail) => {
    if (base && !out.some((r) => r.base === base)) out.push({ kind: "linear_base", label: `from ${base}`, base, branch, path: repo.root, target: ticket, detail });
  };
  if (repo.defaultBranch) add(`origin/${repo.defaultBranch}`, "default branch");
  for (const r of rows) {
    if (r.kind === "worktree" || r.kind === "branch") add(r.branch, "local branch");
    else if (r.kind === "remote_branch") add(`origin/${r.branch}`, "remote branch");
  }
  return out;
}

// Rows that can be opened more than one way. Spaces already are whatever they are.
export const hasActions = (row) => !["space", "prunable"].includes(row.kind);

export function actionRows(row, agents) {
  return [
    { kind: "action", label: "Open", row, argv: null, detail: "no agent" },
    ...agents.map((a) => ({ kind: "action", label: `Start ${a.name}`, row, argv: a.run, detail: a.run.join(" ") })),
  ];
}

export function promptRows(action, prompts) {
  return prompts.map((p) => ({ kind: "prompt", label: p.name, row: action.row, argv: action.argv, text: p.text, detail: p.text.split("\n")[0] }));
}

export function parseQuery(query, atProjects) {
  const t = parse(query);
  return t.kind === "plain" && atProjects ? (parseRepoShorthand(query) ?? t) : t;
}

function linkDetail(t) {
  if (t.kind === "github_pr") return `pull request in ${t.owner}/${t.repo} — worktree on its branch`;
  if (t.kind === "github_issue") return `issue in ${t.owner}/${t.repo} — new branch`;
  return `Linear issue — choose a repository for ${branchFor(t)}`;
}

const findSpace = (spaces, label) => spaces.find((s) => s.name.toLowerCase() === label.toLowerCase());

// The one row a pasted reference means, or null for text that's just a filter.
// Matches an open Space by its name alone, so it costs no network. Renaming the
// Space defeats that, and opening finds the existing worktree instead.
// `repo` is what the caller found on disk for a github_repo target.
export function resolveLink(spaces, t, repo, home) {
  if (t.kind === "plain") return null;
  const label = labelFor(t);
  const open = findSpace(spaces, label);
  if (open) return { kind: "space", label, spaceId: open.id, focused: open.active, detail: "already open — switch to it" };
  if (t.kind !== "github_repo") return { kind: "link", label, branch: branchFor(t), detail: linkDetail(t), target: t };
  if (repo?.path) return { kind: "project", label, path: repo.path, detail: `already cloned — ${shortenHome(repo.path, home)}` };
  return { kind: "clone", label, target: t, detail: repo?.dest ? `clone to ${shortenHome(repo.dest, home)}` : `clone from github.com/${t.owner}/${t.repo}` };
}
