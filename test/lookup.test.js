// Against real git repositories in a temp folder, and the real hc.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, existsSync, symlinkSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBranch, discover, findRepo, listBranches, repoOf, runLong } from "../mods/phin-picker/lookup.js";
import { openRow } from "../mods/phin-picker/actions.js";
import { parseConfig } from "../mods/phin-picker/config.js";
import { parse } from "../mods/phin-picker/target.js";

const home = realpathSync(mkdtempSync(join(tmpdir(), "phin-picker-")));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.error) throw r.error;
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
};
const io = {
  home,
  exec: async (cmd, args, opts) => run(cmd, args, opts),
  hc: async (args) => run("hc", args),
  exists: async (p) => existsSync(p),
  readdir: async (p) => readdirSync(p, { withFileTypes: true }),
};
const git = (cwd, ...args) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8", stdio: "pipe" });

function repo(path) {
  mkdirSync(path, { recursive: true });
  git(path, "init", "-q", "-b", "main");
  git(path, "commit", "-q", "--allow-empty", "-m", "first");
  return path;
}

const root = repo(join(home, "src/github.com/acme/roux"));
repo(join(home, "src/github.com/acme/zed"));
mkdirSync(join(home, "src/github.com/acme/not-a-repo"), { recursive: true });
mkdirSync(join(home, "src/github.com/acme/.hidden/.git"), { recursive: true });
symlinkSync(root, join(home, "src/github.com/acme/linked"));
writeFileSync(join(home, "src/github.com/acme/file"), "");
const cfg = parseConfig(null);

test("discovery finds checkouts, follows symlinks, skips the rest", async () => {
  const found = await discover(io, cfg.projects);
  assert.deepEqual(found.map((p) => p.split("/").pop()), ["linked", "roux", "zed"]);
});

test("discovery never reads above home, like the mod sandbox", async () => {
  const guard = (fn) => async (p) => {
    assert.ok(p.startsWith(home), `read outside home: ${p}`);
    return fn(p);
  };
  const found = await discover({ ...io, exists: guard(io.exists), readdir: guard(io.readdir) }, cfg.projects);
  assert.equal(found.length, 3);
});

test("** globs and depth", async () => {
  const found = await discover(io, { roots: ["~/src/**"], git_only: true, depth: 1 });
  assert.ok(found.includes(root));
});

test("findRepo tries the templates", async () => {
  const hit = await findRepo(io, cfg, parse("https://github.com/acme/roux"));
  assert.equal(hit.path, root);
  const miss = await findRepo(io, cfg, parse("https://github.com/acme/none"));
  assert.equal(miss.path, null);
  assert.equal(miss.dest, join(home, "src/github.com/acme/none"));
});

test("repoOf names the main checkout, even from a worktree", async () => {
  const wt = join(home, "wt1");
  git(root, "worktree", "add", "-q", "-b", "side", wt);
  const repoInfo = await repoOf(io, wt);
  assert.equal(repoInfo.root, root);
  assert.equal(repoInfo.name, "roux");
  assert.equal(repoInfo.defaultBranch, "main");
  const { worktrees, branches } = await listBranches(io, repoInfo);
  assert.deepEqual(worktrees.map((w) => w.branch), ["main", "side"]);
  assert.deepEqual(branches.map((b) => b.name), ["main", "side"]);
});

test("defaultBranch is empty when nothing conventional exists", async () => {
  const odd = join(home, "odd");
  mkdirSync(odd);
  git(odd, "init", "-q", "-b", "trunk");
  git(odd, "commit", "-q", "--allow-empty", "-m", "x");
  assert.equal(await defaultBranch(io, odd), "");
});

const ctx = (spaces) => ({
  io, cfg, agent: true,
  run: (name, args) => spaces.push([name, args]),
  step: (_label, fn) => fn(),
});

test("a new branch falls back to the local default with no remote, and opens with an agent", async () => {
  const spaces = [];
  const repoInfo = await repoOf(io, root);
  await openRow(ctx(spaces), { kind: "new_branch", branch: "feat/new", path: root }, repoInfo);
  const wt = join(home, ".herdr/worktrees/roux/feat/new");
  assert.ok(existsSync(join(wt, ".git")));
  assert.equal(git(wt, "branch", "--show-current").trim(), "feat/new");
  assert.deepEqual(spaces, [["space.new", { folder: wt, name: "roux/feat/new", argv: ["claude"] }]]);
});

test("a branch already checked out reuses its worktree", async () => {
  const spaces = [];
  const repoInfo = await repoOf(io, root);
  await openRow(ctx(spaces), { kind: "branch", branch: "side" }, repoInfo);
  assert.equal(spaces[0][1].folder, join(home, "wt1"));
});

test("a local branch with no worktree gets one", async () => {
  git(root, "branch", "lonely");
  const spaces = [];
  await openRow(ctx(spaces), { kind: "branch", branch: "lonely" }, await repoOf(io, root));
  assert.equal(git(spaces[0][1].folder, "branch", "--show-current").trim(), "lonely");
});

test("a ticket opens under its own name with its prompt sent", async () => {
  const t = parse("https://linear.app/p/issue/ENG-3/fix-it");
  const spaces = [];
  await openRow(ctx(spaces), { kind: "linear_base", branch: "eng-3-fix-it", base: "origin/main", target: t }, await repoOf(io, root));
  const args = spaces[0][1];
  assert.equal(args.name, "ENG-3");
  assert.match(args.task, /^Work ENG-3/);
  assert.equal(git(args.folder, "branch", "--show-current").trim(), "eng-3-fix-it");
});

test("agent off starts nothing", async () => {
  const spaces = [];
  await openRow({ ...ctx(spaces), agent: false }, { kind: "project", path: root });
  assert.deepEqual(spaces, [["space.new", { folder: root }]]);
});

test("a prunable row says what to do", async () => {
  await assert.rejects(openRow(ctx([]), { kind: "prunable", label: "x" }, { root: "/r" }), /git worktree prune/);
});

test("runLong waits, reports the exit code and output, and cleans up", async () => {
  let job;
  await runLong(io, ["sh", "-c", "sleep 1"], { cwd: home, onStart: (t) => { job ??= t; } });
  assert.ok(job);
  assert.notEqual(run("hc", ["get", job, "--json"]).code, 0);
  await assert.rejects(runLong(io, ["sh", "-c", "echo boom; exit 3"], { cwd: home }), /failed \(3\)[\s\S]*boom/);
});
