// What picking a row does: focus what exists, create what doesn't.
// `ctx` is { io, cfg, run, command, spaces, argv, prompt, step, warn, onJob, used }.
// `step(label, fn)` reports progress; `argv` is the agent to start, or null for
// none; `prompt`, when typed, replaces the configured one. `command` is `run`
// that answers, for when the next step needs the ids it made. `used` counts a
// repo towards recent-first.

import { promptData, renderPrompt, worktreePath } from "./config.js";
import { branchFor, labelFor } from "./target.js";
import { findRepo, listBranches, lookupIssueTitle, lookupPR, repoOf, runLong, syncWorktree } from "./lookup.js";
import { spaceLabel } from "./rows.js";
import { stackName } from "./stack.js";

function spaceArgs(ctx, { name, folder, kind, data, note }) {
  const args = { folder };
  if (name) args.name = name;
  if (ctx.argv) {
    args.argv = ctx.argv;
    const prompt = renderPrompt(ctx.prompt || ctx.cfg.agent.prompts[kind], data);
    // task arrives as a plain argument, where a leading "-" would read as a flag.
    if (prompt.trim()) args.task = `${prompt.replace(/^-/, " -")}${note ? `\n\nNote: this worktree is ${note}.` : ""}`;
  }
  return args;
}

const openSpace = (ctx, spec) => ctx.run("space.new", spaceArgs(ctx, spec));

async function clone(ctx, t) {
  const { path, dest } = await findRepo(ctx.io, ctx.cfg, t);
  if (path) return path;
  ctx.used?.(dest);
  await ctx.step(`Cloning ${t.owner}/${t.repo}`, async () => {
    await ctx.io.exec("mkdir", ["-p", dest.slice(0, dest.lastIndexOf("/"))]);
    await runLong(ctx.io, ["gh", "repo", "clone", `${t.owner}/${t.repo}`, dest], { onStart: ctx.onJob });
  });
  return dest;
}

// Spelled out as a refspec so origin/<branch> updates even in a single-branch clone.
function fetchRef(ctx, root, label, from, to) {
  return ctx.step(`Fetching ${label}`, () => runLong(ctx.io, ["git", "fetch", "origin", `+${from}:${to}`], { cwd: root, onStart: ctx.onJob }));
}

const fetchBranch = (ctx, root, branch) => fetchRef(ctx, root, branch, `refs/heads/${branch}`, `refs/remotes/origin/${branch}`);

// GitHub keeps every PR at refs/pull/<n>/head, on the base repo. A fork's branch
// isn't on origin at all and a merged PR's may be deleted, but this always is.
async function fetchPR(ctx, root, t, pr, branch) {
  const pull = `refs/pull/${t.number}/head`;
  const to = `refs/remotes/origin/${branch}`;
  if (pr.fork) return fetchRef(ctx, root, `PR #${t.number}`, pull, to);
  try {
    await fetchBranch(ctx, root, branch);
  } catch {
    await fetchRef(ctx, root, `PR #${t.number}`, pull, to);
  }
}

// A branch already checked out somewhere keeps that worktree. git can't put it
// in a second one, and the Space you wanted is the one on that checkout.
async function ensureWorktree(ctx, repo, { branch, base, fallback, target }) {
  const { worktrees, branches } = await listBranches(ctx.io, repo);
  const existing = worktrees.find((w) => w.branch === branch);
  if (existing?.prunable) throw new Error(`the worktree for ${branch} is missing on disk; run git worktree prune in ${repo.root}`);
  if (existing) return existing.path;

  const path = worktreePath(ctx.cfg, { repo: repo.name, repoRoot: repo.root, branch, owner: target?.owner, host: target?.host }, ctx.io.home);
  const add = (args) => runLong(ctx.io, ["git", "worktree", "add", ...args], { cwd: repo.root, onStart: ctx.onJob });
  await ctx.step(`Creating worktree ${branch}`, async () => {
    if (branches.some((b) => b.name === branch && !b.remote)) return add([path, branch]);
    try {
      await add(["-b", branch, path, ...(base ? [base] : [])]);
    } catch (e) {
      // No remote, or never fetched: a local main is still a fine base.
      if (!fallback) throw e;
      await add(["-b", branch, path, fallback]);
    }
  });
  return path;
}

async function checkoutRepo(ctx, t) {
  const repo = await repoOf(ctx.io, await clone(ctx, t));
  ctx.used?.(repo.root);
  return repo;
}

// Gets a PR onto disk at its latest commit, without opening anything.
async function preparePR(ctx, repo, t, pr) {
  // A fork's branch name means nothing here, and can be main.
  const branch = pr.fork ? `pr-${t.number}` : pr.branch;
  await fetchPR(ctx, repo.root, t, pr, branch);
  const remote = `origin/${branch}`;
  const folder = await ensureWorktree(ctx, repo, { branch, base: remote, target: t });
  const note = await syncWorktree(ctx.io, folder, remote, { onStart: ctx.onJob });
  if (note) ctx.warn?.(`${labelFor(t)} is out of date`, `This worktree is ${note}.`);
  return { branch, folder, note };
}

async function openPR(ctx, t) {
  const repo = await checkoutRepo(ctx, t);
  const pr = await ctx.step(`Looking up ${labelFor(t)}`, () => lookupPR(ctx.io, t));
  const { branch, folder, note } = await preparePR(ctx, repo, t, pr);
  openSpace(ctx, { name: labelFor(t), folder, kind: t.kind, data: promptData(t, { ...pr, branch, path: folder }), note });
}

// One Space, one tab per layer. Every worktree is ready before anything opens,
// so a layer that fails leaves no half-built Space. A stack already open is
// brought up to date and shown as it is.
async function openStack(ctx, row) {
  const t = row.target;
  const repo = await checkoutRepo(ctx, t);
  const name = stackName(t, row.layers);
  const parts = [];
  for (const [i, layer] of row.layers.entries()) {
    const target = { ...t, number: layer.number, url: layer.url };
    const made = await preparePR(ctx, repo, target, { branch: layer.branch, fork: layer.fork });
    const data = promptData(target, { branch: made.branch, title: layer.title, path: made.folder });
    data.Layer = `${i + 1} of ${row.layers.length}`;
    data.Base = layer.base;
    parts.push({ layer, spec: { folder: made.folder, kind: t.kind, data, note: made.note } });
  }

  const open = ctx.spaces?.().find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (open) return ctx.run("space.select", { id: open.id });

  const tabName = (i) => `L${i + 1} #${parts[i].layer.number}`;
  const first = await ctx.command("space.new", { ...spaceArgs(ctx, parts[0].spec), name, tab: tabName(0) });
  let focus = first.tab;
  for (let i = 1; i < parts.length; i++) {
    const made = await ctx.command("tab.new", { ...spaceArgs(ctx, parts[i].spec), name: tabName(i), space: first.space });
    if (parts[i].layer.number === t.number) focus = made.tab;
  }
  await ctx.command("tab.select", { id: focus });
}

async function openIssue(ctx, t) {
  const repo = await checkoutRepo(ctx, t);
  const title = await ctx.step(`Looking up ${labelFor(t)}`, () => lookupIssueTitle(ctx.io, t));
  const named = { ...t, slug: title };
  // Reopening shouldn't fork the work because the title changed or gh is down.
  const { branches } = await listBranches(ctx.io, repo);
  const earlier = branches.find((b) => !b.remote && (b.name === `issue-${t.number}` || b.name.startsWith(`${t.number}-`)));
  const branch = earlier?.name ?? branchFor(named);
  // No base: the work hasn't started, so it begins where the checkout is.
  const folder = await ensureWorktree(ctx, repo, { branch, target: t });
  openSpace(ctx, { name: labelFor(t), folder, kind: t.kind, data: promptData(named, { branch, title }) });
}

export async function openRow(ctx, row, repo) {
  const project = (path) => openSpace(ctx, { folder: path, kind: "project", data: { Repo: path.split("/").pop(), Path: path } });
  const worktree = (spec) => ensureWorktree(ctx, repo, spec).then((folder) => {
    const t = spec.target;
    openSpace(ctx, t
      ? { name: labelFor(t), folder, kind: t.kind, data: promptData(t, { branch: spec.branch, path: folder }) }
      : { name: spaceLabel(repo.name, spec.branch), folder, kind: "project", data: { Repo: repo.name, Path: folder, Branch: spec.branch } });
  });

  switch (row.kind) {
    case "space":
      return ctx.run("space.select", { id: row.spaceId });
    case "project":
      return project(row.path);
    case "stack":
      return openStack(ctx, row);
    case "clone":
      return project(await clone(ctx, row.target));
    case "link":
      return row.target.kind === "github_pr" ? openPR(ctx, row.target) : openIssue(ctx, row.target);
    case "worktree":
      return openSpace(ctx, { name: spaceLabel(repo.name, row.label), folder: row.path, kind: "project", data: { Repo: repo.name, Path: row.path, Branch: row.branch } });
    case "prunable":
      throw new Error(`${row.label} is missing on disk; run git worktree prune in ${repo.root}`);
    case "branch":
      return worktree({ branch: row.branch });
    case "remote_branch":
      await fetchBranch(ctx, repo.root, row.branch);
      return worktree({ branch: row.branch, base: `origin/${row.branch}` });
    case "new_branch":
      return worktree({ branch: row.branch, base: repo.defaultBranch ? `origin/${repo.defaultBranch}` : "", fallback: repo.defaultBranch });
    case "linear_base":
      return worktree({ branch: row.branch, base: row.base, fallback: row.base.replace(/^origin\//, "") === row.base ? "" : row.base.replace(/^origin\//, ""), target: row.target });
    default:
      throw new Error(`can't open a ${row.kind} row`);
  }
}

export const cloneRepo = clone;
