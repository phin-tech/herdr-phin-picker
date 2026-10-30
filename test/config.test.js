import test from "node:test";
import assert from "node:assert/strict";
import { deriveRoots, parseConfig, renderPrompt, worktreePath } from "../mods/phin-picker/config.js";

test("roots come from the templates", () => {
  assert.deepEqual(deriveRoots(["~/src/{host}/{owner}/{repo}", "~/work/{repo}", "{repo}"]), ["~/src/*/*", "~/work"]);
  assert.deepEqual(parseConfig(null).projects.roots, ["~/src/*/*"]);
});

test("a broken file falls back and says so", () => {
  const c = parseConfig("{nope");
  assert.match(c.problem, /using defaults/);
  assert.equal(c.agent.enabled, false);
});

test("wrong shapes fall back and say so, and never throw", () => {
  for (const text of ["null", "[]", "3", '"x"']) assert.match(parseConfig(text).problem, /using defaults/, text);
  const c = parseConfig('{"repos":{"templates":"~/x"},"agent":{"argv":[],"enabled":"yes","prompts":4},"projects":{"depth":0,"roots":[1]},"worktrees":{"path":""}}');
  assert.deepEqual(c.repos.templates, ["~/src/{host}/{owner}/{repo}"]);
  assert.deepEqual(c.agent.argv, ["claude"]);
  assert.equal(c.projects.depth, 1);
  assert.match(c.worktrees.path, /herdr/);
  assert.match(c.problem, /repos\.templates.*agent\.argv/);
  assert.equal(parseConfig('{"projects":{"depth":99}}').projects.depth, 8);
  assert.equal(parseConfig('{"agent":3}').problem, null);
});

test("overrides merge, prompts by key", () => {
  const c = parseConfig('{"agent":{"enabled":true,"prompts":{"project":"hi"}},"projects":{"roots":["~/x"]}}');
  assert.equal(c.agent.enabled, true);
  assert.equal(c.agent.prompts.project, "hi");
  assert.match(c.agent.prompts.github_pr, /Review PR/);
  assert.deepEqual(c.projects.roots, ["~/x"]);
});

test("prompts render fields and blank unknown ones", () => {
  assert.equal(renderPrompt("PR #{{.Number}} {{.Nope}}{{ .Title }}", { Number: 4, Title: "t" }), "PR #4 t");
});

test("worktree paths sanitize the branch", () => {
  const cfg = parseConfig(null);
  assert.equal(worktreePath(cfg, { repo: "roux", repoRoot: "/r", branch: "Feat/X y" }, "/home/s"), "/home/s/.herdr/worktrees/roux/feat/x-y");
  const custom = parseConfig('{"worktrees":{"path":"{repo_root}/.worktrees/{branch}"}}');
  assert.equal(worktreePath(custom, { repo: "roux", repoRoot: "/r", branch: "b" }, "/home/s"), "/r/.worktrees/b");
});
