// Against real git repositories in a temp folder, and the real hc.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, existsSync, rmSync, symlinkSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configuredAgents, defaultBranch, discover, findRepo, isPullRequest, listBranches, loadPrompts, lookupStacks, myOrgs, orgRepos, repoOf, runLong } from "../mods/phin-picker/lookup.js";
import { openRow } from "../mods/phin-picker/actions.js";
import { parseConfig } from "../mods/phin-picker/config.js";
import { DEFAULT_PROMPTS } from "../mods/phin-picker/prompts.js";
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
  readText: async (p) => readFileSync(p, "utf8"),
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
  io, cfg, argv: ["claude"],
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

test("a pasted PR opens on its branch with its prompt, or a typed one", async () => {
  const origin = repo(join(home, "origin"));
  git(origin, "branch", "pr-branch");
  const checkout = join(home, "src/github.com/acme/withpr");
  git(home, "clone", "-q", origin, checkout);
  const withGh = { ...io, exec: async (cmd, args, opts) => (cmd === "gh"
    ? { code: 0, stdout: '{"headRefName":"pr-branch","title":"Fix it"}', stderr: "" }
    : run(cmd, args, opts)) };
  const t = parse("https://github.com/acme/withpr/pull/7");

  const spaces = [];
  await openRow({ ...ctx(spaces), io: withGh }, { kind: "link", target: t });
  const args = spaces[0][1];
  assert.equal(args.name, "withpr#7");
  assert.deepEqual(args.argv, ["claude"]);
  assert.equal(args.task, "Review PR #7 — Fix it\nhttps://github.com/acme/withpr/pull/7");
  assert.equal(git(args.folder, "branch", "--show-current").trim(), "pr-branch");

  const typed = [];
  await openRow({ ...ctx(typed), io: withGh, prompt: "look at the tests" }, { kind: "link", target: t });
  assert.equal(typed[0][1].task, "look at the tests");
});

// A real origin and clone, with gh faked and PR refs made by hand.
function prWorld(name) {
  const origin = repo(join(home, `${name}-origin`));
  writeFileSync(join(origin, "f"), "1");
  git(origin, "add", "f");
  git(origin, "commit", "-q", "-m", "base");
  git(origin, "branch", "feat");
  const checkout = join(home, "src/github.com/acme", name);
  git(home, "clone", "-q", origin, checkout);
  const push = (branch) => {
    git(origin, "checkout", "-q", branch);
    writeFileSync(join(origin, "f"), String(Math.random()));
    git(origin, "commit", "-q", "-am", "more");
    git(origin, "checkout", "-q", "main");
    return git(origin, "rev-parse", branch).trim();
  };
  const pr = { headRefName: "feat", title: "T", isCrossRepository: false };
  const world = { origin, checkout, push, pr, spaces: [] };
  world.ctx = { ...ctx(world.spaces), warnings: [], warn(title, body) { this.warnings.push(body); }, io: { ...io, exec: async (cmd, args, opts) => (cmd === "gh" ? { code: 0, stdout: JSON.stringify(pr), stderr: "" } : run(cmd, args, opts)) } };
  world.open = () => openRow(world.ctx, { kind: "link", target: parse(`https://github.com/acme/${name}/pull/7`) });
  world.folder = () => world.spaces.at(-1)[1].folder;
  return world;
}
const head = (dir) => git(dir, "rev-parse", "HEAD").trim();

test("reopening a PR moves a clean worktree up to the new commits", async () => {
  const w = prWorld("stale");
  await w.open();
  const after = w.push("feat");
  await w.open();
  assert.equal(head(w.folder()), after);
  assert.deepEqual(w.ctx.warnings, []);
});

test("a local branch behind the PR catches up when its worktree is made", async () => {
  const w = prWorld("behind");
  git(w.checkout, "branch", "feat", "origin/feat");
  const after = w.push("feat");
  await w.open();
  assert.equal(head(w.folder()), after);
});

test("local changes are left alone, and the warning reaches you and the agent", async () => {
  const w = prWorld("dirty");
  await w.open();
  const before = head(w.folder());
  writeFileSync(join(w.folder(), "f"), "mine");
  w.push("feat");
  await w.open();
  assert.equal(head(w.folder()), before);
  assert.equal(readFileSync(join(w.folder(), "f"), "utf8"), "mine");
  assert.match(w.ctx.warnings[0], /1 commit behind.*uncommitted/);
  assert.match(w.spaces.at(-1)[1].task, /Note: this worktree is 1 commit behind/);
});

test("local commits and a force-push are left alone too", async () => {
  const w = prWorld("ahead");
  await w.open();
  git(w.folder(), "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "mine");
  const before = head(w.folder());
  w.push("feat");
  await w.open();
  assert.equal(head(w.folder()), before);
  assert.match(w.ctx.warnings[0], /1 local/);
});

test("untracked files don't block catching up", async () => {
  const w = prWorld("untracked");
  await w.open();
  writeFileSync(join(w.folder(), "scratch"), "x");
  const after = w.push("feat");
  await w.open();
  assert.equal(head(w.folder()), after);
});

test("a fork's PR comes from refs/pull onto pr-N, even when its branch is main", async () => {
  const w = prWorld("forked");
  git(w.origin, "update-ref", "refs/pull/7/head", "feat");
  w.pr.headRefName = "main";
  w.pr.isCrossRepository = true;
  await w.open();
  assert.equal(git(w.folder(), "branch", "--show-current").trim(), "pr-7");
  assert.equal(head(w.folder()), git(w.origin, "rev-parse", "feat").trim());
  const after = w.push("feat");
  git(w.origin, "update-ref", "refs/pull/7/head", "feat");
  await w.open();
  assert.equal(head(w.folder()), after, "a force or new commit on the fork catches up");
});

test("a merged PR whose branch was deleted still opens", async () => {
  const w = prWorld("merged");
  const sha = git(w.origin, "rev-parse", "feat").trim();
  git(w.origin, "update-ref", "refs/pull/7/head", sha);
  git(w.origin, "branch", "-D", "feat");
  await w.open();
  assert.equal(head(w.folder()), sha);
});

test("a PR that can't be fetched says so", async () => {
  const w = prWorld("gone");
  git(w.origin, "branch", "-D", "feat");
  await assert.rejects(w.open(), /git fetch origin.*failed/);
  assert.equal(w.spaces.length, 0);
});

test("a worktree missing on disk is reported, not opened", async () => {
  const w = prWorld("pruned");
  await w.open();
  rmSync(w.folder(), { recursive: true });
  await assert.rejects(w.open(), /git worktree prune/);
});

test("a reopened issue keeps its branch when the title changes or gh fails", async () => {
  const w = prWorld("issues");
  git(w.checkout, "branch", "9-old-title");
  const spaces = [];
  const t = parse("https://github.com/acme/issues/issues/9");
  await openRow({ ...ctx(spaces), io: { ...io, exec: async (c, a, o) => (c === "gh" ? { code: 1, stdout: "", stderr: "down" } : run(c, a, o)) } }, { kind: "link", target: t });
  assert.equal(git(spaces[0][1].folder, "branch", "--show-current").trim(), "9-old-title");
});

test("a prompt starting with a dash can't read as a flag", async () => {
  const spaces = [];
  await openRow({ ...ctx(spaces), prompt: "--fix it" }, { kind: "project", path: root });
  assert.equal(spaces[0][1].task, " --fix it");
});

test("runLong removes its terminal and says so when hc stops answering", async () => {
  const calls = [];
  const fake = { ...io, hc: async (args) => {
    calls.push(args[0]);
    if (args[0] === "run") return { code: 0, stdout: '{"address":"t9"}', stderr: "" };
    return { code: args[0] === "rm" ? 0 : 1, stdout: "", stderr: "no such terminal" };
  } };
  await assert.rejects(runLong(fake, ["git", "fetch"]), /lost track of git: no such terminal/);
  assert.deepEqual(calls, ["run", "wait", "rm"]);
});

test("a ** walk ends on a symlink loop", async () => {
  mkdirSync(join(home, "loop/a"), { recursive: true });
  symlinkSync(join(home, "loop"), join(home, "loop/a/up"));
  const found = await discover(io, { roots: ["~/loop/**"], git_only: true, depth: 1 });
  assert.deepEqual(found, []);
});

test("an unreadable prompt file is skipped", async () => {
  const dir = join(home, ".config/phin-tech/picker/prompts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "bad.md"), "x");
  const loaded = await loadPrompts({ ...io, readText: async () => { throw new Error("too big"); } });
  assert.ok(!loaded.some((p) => p.name === "bad"));
  rmSync(join(dir, "bad.md"));
});

test("a project sends no prompt unless one is typed", async () => {
  const spaces = [];
  await openRow(ctx(spaces), { kind: "project", path: root });
  await openRow({ ...ctx(spaces), prompt: "hi" }, { kind: "project", path: root });
  assert.equal(spaces[0][1].task, undefined);
  assert.equal(spaces[1][1].task, "hi");
});

test("saved prompts: sorted, named by file, replacing a built-in, blank and other files skipped", async () => {
  assert.deepEqual(await loadPrompts(io), DEFAULT_PROMPTS);
  const dir = join(home, ".config/phin-tech/picker/prompts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "review.md"), "Review {{.Branch}}\nCarefully.\n");
  writeFileSync(join(dir, "audit.txt"), "Audit it");
  writeFileSync(join(dir, "empty.md"), "  \n");
  writeFileSync(join(dir, "notes.json"), "{}");
  const loaded = await loadPrompts(io);
  assert.deepEqual(loaded.slice(-2), [{ name: "audit", text: "Audit it" }, { name: "review", text: "Review {{.Branch}}\nCarefully." }]);
  assert.equal(loaded.filter((p) => p.name === "review").length, 1);
  assert.equal(loaded.length, DEFAULT_PROMPTS.length + 1);
});

test("a saved prompt renders against the row", async () => {
  const spaces = [];
  await openRow({ ...ctx(spaces), prompt: "Review {{.Branch}} in {{.Repo}}" }, { kind: "branch", branch: "side" }, await repoOf(io, root));
  assert.equal(spaces[0][1].task, "Review side in roux");
});

// Three layers on a real origin: feat1 on main, feat2 on feat1, feat3 on feat2.
function stackWorld(name) {
  const w = prWorld(name);
  const layers = [];
  let base = "main";
  for (const [i, branch] of ["feat1", "feat2", "feat3"].entries()) {
    git(w.origin, "branch", branch, base);
    w.push(branch);
    layers.push({ number: 10 + i, title: `T${i}`, url: `https://github.com/acme/${name}/pull/${10 + i}`, branch, base, fork: false });
    base = branch;
  }
  git(w.checkout, "fetch", "-q", "origin");
  const commands = [];
  let ids = 0;
  Object.assign(w.ctx, {
    spaces: () => w.open_spaces ?? [],
    command: async (cmd, args) => {
      commands.push([cmd, args]);
      ids += 1;
      return cmd === "space.new" ? { space: "s1", tab: `tab${ids}` } : { tab: `tab${ids}` };
    },
  });
  w.commands = commands;
  w.row = (number) => ({ kind: "stack", target: parse(`https://github.com/acme/${name}/pull/${number}`), layers });
  w.layers = layers;
  return w;
}

test("a stack opens as one Space with a tab per layer, focused on the PR you pasted", async () => {
  const w = stackWorld("stack1");
  await openRow(w.ctx, w.row(11));
  const [space, tab2, tab3, select] = w.commands;
  assert.equal(space[0], "space.new");
  assert.equal(space[1].name, "stack1#10-12");
  assert.equal(space[1].tab, "L1 #10");
  assert.deepEqual([tab2[0], tab2[1].name, tab2[1].space], ["tab.new", "L2 #11", "s1"]);
  assert.equal(tab3[1].name, "L3 #12");
  assert.deepEqual(select, ["tab.select", { id: "tab2" }]);
  for (const [i, [, args]] of [space, tab2, tab3].entries()) {
    assert.equal(git(args.folder, "branch", "--show-current").trim(), `feat${i + 1}`);
    assert.equal(head(args.folder), git(w.origin, "rev-parse", `feat${i + 1}`).trim());
  }
});

test("each layer gets its own prompt", async () => {
  const w = stackWorld("stack2");
  w.ctx.prompt = "#{{.Number}} {{.Title}} is {{.Layer}} on {{.Base}} in {{.Branch}}";
  await openRow(w.ctx, w.row(10));
  assert.equal(w.commands[1][1].task, "#11 T1 is 2 of 3 on feat1 in feat2");
  assert.deepEqual(w.commands[1][1].argv, ["claude"]);
});

test("a layer that fails opens nothing", async () => {
  const w = stackWorld("stack3");
  git(w.origin, "branch", "-D", "feat3");
  await assert.rejects(openRow(w.ctx, w.row(10)), /failed/);
  assert.deepEqual(w.commands, []);
});

test("an open stack is updated and shown, not built again", async () => {
  const w = stackWorld("stack4");
  w.open_spaces = [{ id: "s9", name: "STACK4#10-12" }];
  await openRow(w.ctx, w.row(10));
  assert.deepEqual(w.commands, []);
  assert.deepEqual(w.spaces, [["space.select", { id: "s9" }]]);
});

test("stacks come from GitHub's stack first, then the base walk, and never throw", async () => {
  const native = JSON.stringify({ data: { repository: { pullRequest: { stack: { entries: { nodes: [
    { position: 2, pullRequest: { number: 2, title: "b", url: "u2", headRefName: "b", baseRefName: "a" } },
    { position: 1, pullRequest: { number: 1, title: "a", url: "u1", headRefName: "a", baseRefName: "main" } },
  ] } } } } } });
  const t = parse("https://github.com/a/b/pull/1");
  const answer = (graphql, list) => ({ exec: async (_c, args) => (args[0] === "api" ? graphql : list) });
  const ok = (stdout) => ({ code: 0, stdout, stderr: "" });

  const viaNative = await lookupStacks(answer(ok(native), ok("[]")), t);
  assert.deepEqual(viaNative[0].map((l) => l.number), [1, 2]);

  const list = JSON.stringify([{ number: 1, headRefName: "x", baseRefName: "main" }, { number: 2, headRefName: "y", baseRefName: "x" }]);
  const nullStack = ok('{"data":{"repository":{"pullRequest":{"stack":null}}}}');
  assert.deepEqual((await lookupStacks(answer(nullStack, ok(list)), t))[0].map((l) => l.number), [1, 2]);
  assert.deepEqual((await lookupStacks(answer({ code: 1, stdout: "", stderr: "old gh" }, ok(list)), t))[0].map((l) => l.number), [1, 2]);

  assert.deepEqual(await lookupStacks(answer(nullStack, { code: 1, stdout: "", stderr: "" }), t), []);
  assert.deepEqual(await lookupStacks({ exec: async () => { throw new Error("no gh"); } }, t), []);
});

test("a PR for a repo you don't have clones first", async () => {
  const origin = repo(join(home, "fresh-origin"));
  git(origin, "branch", "feat");
  const dest = join(home, "src/github.com/acme/fresh");
  const steps = [];
  const spaces = [];
  const used = [];
  const hcFake = async (args) => {
    if (args[0] !== "run") return io.hc(args);
    const at = args.indexOf("gh");
    return at < 0 ? io.hc(args) : io.hc([...args.slice(0, at), "git", "clone", "-q", origin, args.at(-1)]);
  };
  const fake = { ...io, hc: hcFake, exec: async (c, a, o) => (c === "gh"
    ? { code: 0, stdout: '{"headRefName":"feat","title":"T"}', stderr: "" } : run(c, a, o)) };
  await openRow({ ...ctx(spaces), io: fake, used: (p) => used.push(p), step: (l, f) => { steps.push(l); return f(); } }, { kind: "link", target: parse("https://github.com/acme/fresh/pull/3") });
  assert.equal(steps[0], "Cloning acme/fresh");
  assert.ok(existsSync(join(dest, ".git")));
  assert.equal(git(spaces[0][1].folder, "branch", "--show-current").trim(), "feat");
  assert.ok(used.includes(dest));
});

test("a clone that fails stops there", async () => {
  const spaces = [];
  const fake = { ...io, hc: async (args) => (args[0] === "run" ? { code: 1, stdout: "", stderr: "no access" } : io.hc(args)) };
  await assert.rejects(openRow({ ...ctx(spaces), io: fake }, { kind: "link", target: parse("https://github.com/acme/secret/pull/3") }), /no access/);
  assert.equal(spaces.length, 0);
});

test("GitHub says whether a number is a PR or an issue", async () => {
  const t = { owner: "a", repo: "b", number: 1, text: "a/b#1" };
  const answer = (stdout, code = 0) => ({ exec: async () => ({ code, stdout, stderr: "Not Found" }) });
  assert.equal(await isPullRequest(answer('{"pull_request":{}}'), t), true);
  assert.equal(await isPullRequest(answer("{}"), t), false);
  await assert.rejects(isPullRequest(answer("", 1), t), /a\/b#1: Not Found/);
});

test("an org is cached for a day, and only a refresh or age asks GitHub", async () => {
  let asked = 0;
  const gh = (result) => ({ exec: async () => { asked += 1; return result; } });
  const ok = gh({ code: 0, stdout: '[{"name":"x"}]', stderr: "" });
  const hour = 3600000;

  const first = await orgRepos(ok, "acme", { now: 0 });
  assert.equal(asked, 1);
  assert.ok(first.fetched);

  const cached = first.entry;
  assert.equal((await orgRepos(ok, "acme", { cached, now: 23 * hour })).fetched, false);
  assert.equal(asked, 1, "a fresh cache makes no call");

  await orgRepos(ok, "acme", { cached, now: 25 * hour });
  assert.equal(asked, 2, "a stale one asks");
  await orgRepos(ok, "acme", { cached, now: hour, force: true });
  assert.equal(asked, 3, "ctrl+r asks");
});

test("a failed refresh keeps the saved list and says why; with none it fails", async () => {
  const down = { exec: async () => ({ code: 1, stdout: "", stderr: "no network" }) };
  const cached = { at: 0, repos: [{ name: "x" }] };
  const r = await orgRepos(down, "acme", { cached, now: 0, force: true });
  assert.equal(r.entry, cached);
  assert.equal(r.fetched, false);
  assert.equal(r.stale, "no network");
  await assert.rejects(orgRepos(down, "acme", { now: 0 }), /no network/);
});

test("a configured agent only counts if it's on this machine", async () => {
  const tool = join(home, "bin-tool");
  writeFileSync(tool, "#!/bin/sh\n");
  execFileSync("chmod", ["+x", tool]);
  const plain = join(home, "not-executable");
  writeFileSync(plain, "");
  const cfgWith = parseConfig(JSON.stringify({ agents: { home: "~/bin-tool", absolute: [tool, "--x"], onPath: "sh", plain, gone: "~/nope", missing: "no-such-program-here" } }));
  const found = await configuredAgents(io, cfgWith);
  assert.deepEqual(found, [{ name: "home", run: [tool] }, { name: "absolute", run: [tool, "--x"] }, { name: "onPath", run: ["sh"] }]);
});

test("your orgs: you first, then the rest sorted, cached the same way", async () => {
  let asked = 0;
  const fake = { exec: async (_c, args) => {
    asked += 1;
    return { code: 0, stderr: "", stdout: args[1] === "user" ? "me\n" : "zeta\nAcme\nbeta\n" };
  } };
  const first = await myOrgs(fake, { now: 0 });
  assert.deepEqual(first.entry.repos, ["me", "Acme", "beta", "zeta"]);
  assert.equal((await myOrgs(fake, { cached: first.entry, now: 1000 })).fetched, false);
  assert.equal(asked, 2);
});

test("no agent starts nothing", async () => {
  const spaces = [];
  await openRow({ ...ctx(spaces), argv: null }, { kind: "project", path: root });
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
