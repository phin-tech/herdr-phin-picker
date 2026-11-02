import test from "node:test";
import assert from "node:assert/strict";
import { actionRows, openingKey, openingRows, hasActions, sameList, mergeAgents, orgCompletions, orgPrefix, orgRow, orgRows, parseOrgQuery, promptRows, stackRows, hasExactBranch, linearBaseRows, newBranchRow, parseBranches, parseQuery, parseWorktrees, projectRows, rank, resolveLink, spaceLabel, subsequence, worktreeRows } from "../mods/phin-picker/rows.js";
import { parse } from "../mods/phin-picker/target.js";

const home = "/home/s";
const space = (id, name, extra = {}) => ({ id, name, machine: null, active: false, folder: "", tabs: [{ id: `${id}-t` }], ...extra });
const pane = (spaceId, cwd) => ({ tab: `${spaceId}-t`, cwd });

test("subsequence filter", () => {
  assert.ok(subsequence("hpu", "herdr-phin-util"));
  assert.ok(!subsequence("uph", "herdr-phin-util"));
  assert.ok(subsequence("", "x"));
});

test("name matches rank above path matches", () => {
  const rows = [{ label: "zzz", detail: "~/roux" }, { label: "roux", detail: "~/a" }];
  assert.deepEqual(rank("roux", rows).map((r) => r.label), ["roux", "zzz"]);
});

test("a checkout with a Space never appears twice, and the current Space sorts last", () => {
  const spaces = [space("a", "here", { active: true }), space("b", "there")];
  const panes = [pane("a", "/home/s/src/one/"), pane("b", "/home/s/src/two")];
  const rows = projectRows({ spaces, panes, paths: ["/home/s/src/one", "/home/s/src/three", "/home/s/src/two"], home });
  assert.deepEqual(rows.map((r) => [r.kind, r.label]), [["space", "there"], ["space", "here"], ["project", "three"]]);
  assert.equal(rows[2].detail, "~/src/three");
});

test("a remote Space doesn't claim a local path", () => {
  const rows = projectRows({ spaces: [space("a", "vps", { machine: "vps", folder: "/home/s/x" })], panes: [pane("a", "/home/s/x")], paths: ["/home/s/x"], home });
  assert.deepEqual(rows.map((r) => r.kind), ["space", "project"]);
  assert.equal(rows[0].detail, "on vps");
});

test("opening rows take Spaces from now and everything else from last time", () => {
  const now = [{ kind: "space", label: "new" }];
  const saved = [{ kind: "space", label: "closed" }, { kind: "project", label: "p" }, { kind: "org", label: "o" }];
  assert.deepEqual(openingRows(now, saved).map((r) => r.label), ["new", "p", "o"]);
});

test("the opening key changes with the paths, the Spaces' folders or the recent list", () => {
  const key = openingKey(["/a"], [{ path: "/s" }], { "/a": 1 });
  assert.equal(key, openingKey(["/a"], [{ path: "/s" }], { "/a": 1 }));
  assert.notEqual(key, openingKey(["/b"], [{ path: "/s" }], { "/a": 1 }));
  assert.notEqual(key, openingKey(["/a"], [{ path: "/t" }], { "/a": 1 }));
  assert.notEqual(key, openingKey(["/a"], [{ path: "/s" }], { "/a": 2 }));
});

test("recent first: Spaces and projects each by score, with the current Space still last", () => {
  const spaces = [space("a", "here", { active: true }), space("b", "low"), space("c", "high")];
  const panes = [pane("a", "/h/a"), pane("b", "/h/b"), pane("c", "/h/c")];
  const scores = { "/h/a": 9, "/h/c": 5, "/h/b": 1, "/h/z": 3 };
  const rows = projectRows({ spaces, panes, paths: ["/h/m", "/h/y", "/h/z"], home, score: (p) => scores[p] ?? 0 });
  assert.deepEqual(rows.map((r) => r.label), ["high", "low", "here", "z", "m", "y"]);
});

test("worktree porcelain", () => {
  const w = parseWorktrees("worktree /r\nHEAD a\nbranch refs/heads/main\n\nworktree /w\nHEAD b\ndetached\n\nworktree /g\nHEAD c\nbranch refs/heads/feat/x\nprunable gitdir gone\n");
  assert.deepEqual(w, [{ path: "/r", branch: "main" }, { path: "/w", detached: true }, { path: "/g", branch: "feat/x", prunable: true }]);
});

test("branches: local first, a remote that exists locally dropped, origin/HEAD ignored", () => {
  const b = parseBranches("refs/heads/z\nrefs/heads/a\nrefs/remotes/origin/HEAD\nrefs/remotes/origin/a\nrefs/remotes/origin/feat/x\n");
  assert.deepEqual(b, [{ name: "a", remote: false }, { name: "z", remote: false }, { name: "feat/x", remote: true }]);
});

test("worktree level: a branch with a worktree isn't offered as a branch; a worktree with a Space is an open row", () => {
  const repo = { name: "roux", root: "/r" };
  const rows = worktreeRows({
    repo, home,
    worktrees: [{ path: "/r", branch: "main" }, { path: "/w", branch: "feat" }, { path: "/g", branch: "gone", prunable: true }],
    branches: [{ name: "main" }, { name: "feat" }, { name: "local" }, { name: "rem", remote: true }],
    spaces: [space("a", "x")], panes: [pane("a", "/w")],
  });
  assert.deepEqual(rows.map((r) => [r.kind, r.label]), [["worktree", "main"], ["space", "feat"], ["prunable", "gone"], ["branch", "local"], ["remote_branch", "rem"]]);
});

test("new branch row names its base", () => {
  assert.equal(newBranchRow({ root: "/r", defaultBranch: "main" }, "x").detail, "new branch from main");
  assert.equal(newBranchRow({ root: "/r", defaultBranch: "" }, "x").detail, "new branch");
  assert.ok(hasExactBranch([{ branch: "x" }], "x"));
});

test("a ticket's bases lead with origin's default and don't repeat", () => {
  const t = parse("https://linear.app/p/issue/ENG-3/fix-it");
  const rows = linearBaseRows({ root: "/r", defaultBranch: "main" }, t, [{ kind: "worktree", branch: "main" }, { kind: "branch", branch: "dev" }, { kind: "remote_branch", branch: "main" }]);
  assert.deepEqual(rows.map((r) => r.base), ["origin/main", "main", "dev"]);
  assert.equal(rows[0].branch, "eng-3-fix-it");
});

test("links resolve to one row, an open Space first, case-insensitively", () => {
  const pr = parse("https://github.com/phin-tech/roux/pull/42");
  assert.equal(resolveLink([space("a", "ROUX#42")], pr, null, home).spaceId, "a");
  const row = resolveLink([], pr, null, home);
  assert.equal(row.kind, "link");
  assert.equal(row.label, "roux#42");
  assert.equal(resolveLink([], parse("just text"), null, home), null);
});

test("owner/repo is a clone, a project, or the open Space", () => {
  const t = parseQuery("phin-tech/roux", true);
  assert.equal(resolveLink([], t, { path: null, dest: "/home/s/src/roux" }, home).detail, "clone to ~/src/roux");
  assert.equal(resolveLink([], t, { path: "/home/s/src/roux" }, home).kind, "project");
  const on = [space("a", "roux")];
  assert.equal(resolveLink(on, t, { path: "/x" }, home, [pane("a", "/x")]).kind, "space");
  assert.equal(resolveLink(on, t, { path: "/y" }, home, [pane("a", "/x")]).kind, "project", "same name, other owner");
  assert.equal(resolveLink(on, t, { path: null, dest: "/d" }, home, [pane("a", "/x")]).kind, "clone");
  assert.equal(parseQuery("phin-tech/roux", false).kind, "plain");
});

test("actions: open first, then each agent, and only for rows that can be opened", () => {
  const row = { kind: "branch", label: "x" };
  const rows = actionRows(row, [{ name: "Claude Code", run: ["claude"] }]);
  assert.deepEqual(rows.map((r) => [r.label, r.argv]), [["Open", null], ["Start Claude Code", ["claude"]]]);
  assert.equal(rows[1].row, row);
  assert.ok(!hasActions({ kind: "space" }));
  assert.ok(!hasActions({ kind: "prunable" }));
  assert.ok(hasActions({ kind: "link" }));
});

test("prompt rows carry the agent and the row, and show the first line", () => {
  const row = { kind: "branch", label: "x" };
  const [p] = promptRows({ row, argv: ["claude"] }, [{ name: "review", text: "First\nSecond" }]);
  assert.equal(p.detail, "First");
  assert.equal(p.row, row);
  assert.deepEqual(p.argv, ["claude"]);
});

test("a stack row per chain, and none for a lone PR", () => {
  const t = parse("https://github.com/a/b/pull/1");
  const rows = stackRows(t, [[{ number: 1 }], [{ number: 1 }, { number: 2 }]]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].label, "Whole stack of 2");
  assert.equal(rows[0].detail, "#1 → #2");
  assert.ok(hasActions(rows[0]));
});

test("owner/repo#42 is a ref at the project level only", () => {
  assert.equal(parseQuery("a/b#4", true).kind, "github_ref");
  assert.equal(parseQuery("a/b#4", false).kind, "plain");
});

test("asking for an org", () => {
  for (const q of ["org:acme", "org acme", "ORG: acme", "acme/"]) assert.equal(parseOrgQuery(q), "acme", q);
  for (const q of ["acme", "acme/roux", "org", "org:", "orgs/x y", ""]) assert.equal(parseOrgQuery(q), null, q);
});

test("org: is what's typed after it", () => {
  for (const [q, want] of [["org:", ""], ["ORG:", ""], ["org:  ", ""], ["org:ph", "ph"], ["org: ph", "ph"]]) assert.equal(orgPrefix(q), want, q);
  for (const q of ["org", "orgs:", "org:a b", "phin"]) assert.equal(orgPrefix(q), null, q);
});

test("org: completes your orgs, best match first, and offers any other name", () => {
  const names = ["sam-phinizy", "Acme", "phin-tech"];
  const labels = (p) => orgCompletions(p, names, () => undefined, 0).map((r) => r.org);
  assert.deepEqual(labels(""), names, "all of them, for the arrows");
  assert.deepEqual(labels("ph"), ["phin-tech", "sam-phinizy", "ph"]);
  assert.deepEqual(labels("acme"), ["Acme"], "no extra row for an exact match");
  assert.deepEqual(labels("zzz"), ["zzz"]);
  assert.deepEqual(orgCompletions("", [], () => undefined, 0), [], "nothing yet while it loads");
  const [row] = orgCompletions("acme", names, () => ({ at: 0, repos: [1] }), 0);
  assert.equal(row.kind, "org");
  assert.equal(row.detail, "1 repos, listed just now");
});

test("an org row says whether it's been listed, and when", () => {
  assert.equal(orgRow("acme", undefined, 0).detail, "lists its repos from GitHub");
  assert.equal(orgRow("acme", { at: 0, repos: [1, 2] }, 3 * 3600000).detail, "2 repos, listed 3h ago");
  assert.equal(orgRow("acme", { at: 0, repos: [] }, 60000).detail, "0 repos, listed just now");
});

test("an org's repos reuse the rows you have, newest push first, and can be cloned", () => {
  const cfg = { repos: { templates: ["~/src/{host}/{owner}/{repo}"] } };
  const mine = { kind: "project", label: "have", path: "/home/s/src/github.com/acme/have" };
  const open = { kind: "space", label: "on", path: "/home/s/src/github.com/acme/on", spaceId: "s" };
  const rows = orgRows({ org: "acme", cfg, home, projects: [mine, open], repos: [
    { name: "old", pushedAt: "2020-01-01", description: "" },
    { name: "have", pushedAt: "2024-01-01" },
    { name: "on", pushedAt: "2023-01-01" },
    { name: "new", pushedAt: "2025-01-01", description: "Fresh" },
  ] });
  assert.deepEqual(rows.map((r) => [r.kind, r.label]), [["clone", "new"], ["project", "have"], ["space", "on"], ["clone", "old"]]);
  assert.equal(rows[0].detail, "Fresh");
  assert.equal(rows[3].detail, "clone to ~/src/github.com/acme/old");
  assert.equal(rows[0].target.owner, "acme");
});

test("a configured agent joins the list, and replaces the same program", () => {
  const known = [{ name: "Claude Code", run: ["claude"] }, { name: "Pi", run: ["pi"] }];
  const merged = mergeAgents(known, [{ name: "omp", run: ["/x/omp"] }, { name: "my claude", run: ["/y/claude", "--flag"] }]);
  assert.deepEqual(merged.map((a) => a.name), ["Pi", "omp", "my claude"]);
});

test("sameList compares in order", () => {
  assert.ok(sameList(["a", "b"], ["a", "b"]));
  assert.ok(!sameList(["a", "b"], ["b", "a"]));
  assert.ok(!sameList(["a"], ["a", "b"]));
});

test("Space label for a worktree", () => {
  assert.equal(spaceLabel("roux", "feat"), "roux/feat");
  assert.equal(spaceLabel("roux", "ROUX"), "roux");
});
