// What picking a row does: focus what exists, create what doesn't.
// `ctx` is { io, cfg, run, argv, prompt, step, onJob }. `step(label, fn)` reports
// progress; `argv` is the agent to start, or null for none; `prompt`, when
// typed, replaces the configured one.

import { promptData, renderPrompt, worktreePath } from "./config.js";
import { branchFor, labelFor } from "./target.js";
import { findRepo, listBranches, lookupIssueTitle, lookupPR, repoOf, runLong } from "./lookup.js";
import { spaceLabel } from "./rows.js";

function openSpace(ctx, { name, folder, kind, data }) {
  const args = { folder };
  if (name) args.name = name;
  if (ctx.argv) {
    args.argv = ctx.argv;
    const prompt = renderPrompt(ctx.prompt || ctx.cfg.agent.prompts[kind], data);
    if (prompt.trim()) args.task = prompt;
  }
  ctx.run("space.new", args);
}

async function clone(ctx, t) {
  const { path, dest } = await findRepo(ctx.io, ctx.cfg, t);
  if (path) return path;
  await ctx.step(`Cloning ${t.owner}/${t.repo}`, async () => {
    await ctx.io.exec("mkdir", ["-p", dest.slice(0, dest.lastIndexOf("/"))]);
    await runLong(ctx.io, ["gh", "repo", "clone", `${t.owner}/${t.repo}`, dest], { onStart: ctx.onJob });
  });
  return dest;
}

async function fetchBranch(ctx, root, branch) {
  await ctx.step(`Fetching ${branch}`, () => runLong(ctx.io, ["git", "fetch", "origin", branch], { cwd: root, onStart: ctx.onJob }));
}

// A branch already checked out somewhere keeps that worktree. git can't put it
// in a second one, and the Space you wanted is the one on that checkout.
async function ensureWorktree(ctx, repo, { branch, base, fallback, target }) {
  const { worktrees, branches } = await listBranches(ctx.io, repo);
  const existing = worktrees.find((w) => w.branch === branch);
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

async function openPR(ctx, t) {
  const { path: root } = await findRepo(ctx.io, ctx.cfg, t);
  if (!root) throw new Error(`no checkout of ${t.owner}/${t.repo}; type ${t.owner}/${t.repo} to clone it first`);
  const repo = await repoOf(ctx.io, root);
  const pr = await ctx.step(`Looking up ${labelFor(t)}`, () => lookupPR(ctx.io, t));
  await fetchBranch(ctx, repo.root, pr.branch);
  const folder = await ensureWorktree(ctx, repo, { branch: pr.branch, base: `origin/${pr.branch}`, target: t });
  openSpace(ctx, { name: labelFor(t), folder, kind: t.kind, data: promptData(t, pr) });
}

async function openIssue(ctx, t) {
  const { path: root } = await findRepo(ctx.io, ctx.cfg, t);
  if (!root) throw new Error(`no checkout of ${t.owner}/${t.repo}; type ${t.owner}/${t.repo} to clone it first`);
  const repo = await repoOf(ctx.io, root);
  const title = await ctx.step(`Looking up ${labelFor(t)}`, () => lookupIssueTitle(ctx.io, t));
  const named = { ...t, slug: title };
  const branch = branchFor(named);
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
