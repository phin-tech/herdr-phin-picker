import test from "node:test";
import assert from "node:assert/strict";
import { actionRows, hasActions, promptRows, hasExactBranch, linearBaseRows, newBranchRow, parseBranches, parseQuery, parseWorktrees, projectRows, rank, resolveLink, spaceLabel, subsequence, worktreeRows } from "../mods/phin-picker/rows.js";
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
  assert.equal(resolveLink([space("a", "roux")], t, { path: "/x" }, home).kind, "space");
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

test("Space label for a worktree", () => {
  assert.equal(spaceLabel("roux", "feat"), "roux/feat");
  assert.equal(spaceLabel("roux", "ROUX"), "roux");
});
