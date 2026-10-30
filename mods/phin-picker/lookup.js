// Finding things on disk and through git and gh. Everything from the outside
// world arrives in `io`, so Node can test this against real repositories:
// { exec(cmd, args, opts), hc(args), readdir(path), readText(path), exists(path), home }.

import { MAX_DEPTH, PROMPTS_PATH, expandHome, repoCandidates } from "./config.js";
import { DEFAULT_PROMPTS } from "./prompts.js";
import { parseBranches, parseWorktrees } from "./rows.js";
import { parseNativeStack, walkStacks } from "./stack.js";

const hasMeta = (s) => /[*?[]/.test(s);

function globRegex(segment) {
  const body = segment.replace(/[.+^${}()|\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".");
  return new RegExp(`^${body}$`);
}

async function childDirs(io, path) {
  let entries;
  try {
    entries = await io.readdir(path);
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (e.name.startsWith(".")) continue;
    const child = `${path.replace(/\/$/, "")}/${e.name}`;
    // A Dirent doesn't follow symlinks; a symlinked checkout still counts.
    if (e.isDirectory() || (await io.exists(`${child}/.`))) out.push(child);
  }
  return out;
}

async function expandRoot(io, root) {
  const pattern = expandHome(root.trim(), io.home);
  if (!pattern) return [];
  if (!hasMeta(pattern)) return (await io.exists(`${pattern}/.`)) ? [pattern.replace(/\/+$/, "")] : [];
  // Start at the deepest literal folder: mods may only read inside home, so
  // the walk can't come down from the root.
  const segments = pattern.split("/");
  const firstGlob = segments.findIndex(hasMeta);
  const base = segments.slice(0, firstGlob).join("/");
  if (!(await io.exists(`${base}/.`))) return [];
  let current = [base];
  for (const segment of segments.slice(firstGlob).filter(Boolean)) {
    const next = [];
    for (const dir of current) {
      if (segment === "**") {
        // Capped because childDirs follows symlinks, and one can point back up.
        for (const stack = [[dir, 0]]; stack.length; ) {
          const [at, depth] = stack.pop();
          next.push(at);
          if (depth < MAX_DEPTH) for (const c of await childDirs(io, at)) stack.push([c, depth + 1]);
        }
      } else if (hasMeta(segment)) {
        const re = globRegex(segment);
        for (const c of await childDirs(io, dir)) if (re.test(c.split("/").pop())) next.push(c);
      } else {
        const joined = `${dir.replace(/\/$/, "")}/${segment}`;
        if (await io.exists(`${joined}/.`)) next.push(joined);
      }
    }
    current = next;
    if (!current.length) break;
  }
  return current;
}

// A directory carrying .git is a project and isn't descended into.
async function walkForGit(io, path, level, depth, seen) {
  if (level > depth) return;
  if (await io.exists(`${path}/.git`)) {
    seen.add(path);
    return;
  }
  for (const child of await childDirs(io, path)) await walkForGit(io, child, level + 1, depth, seen);
}

export async function discover(io, projects) {
  const seen = new Set();
  for (const root of projects.roots) {
    for (const base of await expandRoot(io, root)) {
      for (const child of await childDirs(io, base)) {
        if (projects.git_only) await walkForGit(io, child, 1, projects.depth, seen);
        else seen.add(child);
      }
    }
  }
  return [...seen].sort();
}

// The built-in prompts plus the prompts folder: a file's name is its label, its
// text the prompt, and it replaces a built-in of the same name.
export async function loadPrompts(io) {
  const dir = `${io.home}/${PROMPTS_PATH}`;
  let entries;
  try {
    entries = await io.readdir(dir);
  } catch {
    return DEFAULT_PROMPTS;
  }
  const prompts = [];
  for (const name of entries.map((e) => e.name).filter((n) => /\.(md|txt)$/.test(n) && !n.startsWith(".")).sort()) {
    const text = (await io.readText(`${dir}/${name}`).catch(() => null))?.trim();
    if (text) prompts.push({ name: name.replace(/\.[^.]+$/, ""), text });
  }
  const yours = new Set(prompts.map((p) => p.name));
  return [...DEFAULT_PROMPTS.filter((p) => !yours.has(p.name)), ...prompts];
}

export async function findRepo(io, cfg, t) {
  const candidates = repoCandidates(cfg, t, io.home);
  for (const path of candidates) if (await io.exists(`${path}/.`)) return { path, dest: candidates[0] };
  return { path: null, dest: candidates[0] };
}

async function git(io, cwd, args) {
  const r = await io.exec("git", args, { cwd });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr.trim() || `exit ${r.code}`}`);
  return r.stdout;
}

const quiet = (io, cwd, args) => io.exec("git", args, { cwd }).catch(() => ({ code: 1, stdout: "" }));

export async function defaultBranch(io, root) {
  const head = await quiet(io, root, ["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"]);
  const name = head.stdout.trim().replace(/^refs\/remotes\/origin\//, "");
  if (head.code === 0 && name) return name;
  for (const guess of ["main", "master"]) {
    if ((await quiet(io, root, ["show-ref", "--verify", "--quiet", `refs/heads/${guess}`])).code === 0) return guess;
  }
  return "";
}

// The repository a folder belongs to, named after its main checkout: git lists
// that first, whichever worktree you ask from.
export async function repoOf(io, folder) {
  const worktrees = parseWorktrees(await git(io, folder, ["worktree", "list", "--porcelain"]));
  const root = worktrees[0]?.path ?? folder;
  return { name: root.split("/").pop(), root, defaultBranch: await defaultBranch(io, root) };
}

export async function listBranches(io, repo) {
  const worktrees = parseWorktrees(await git(io, repo.root, ["worktree", "list", "--porcelain"]));
  const branches = parseBranches(await git(io, repo.root, ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"]));
  return { worktrees, branches };
}

export async function lookupPR(io, t) {
  const r = await io.exec("gh", ["pr", "view", String(t.number), "--repo", `${t.owner}/${t.repo}`, "--json", "headRefName,title,isCrossRepository"]);
  if (r.code !== 0) throw new Error(`gh pr view ${t.owner}/${t.repo}#${t.number}: ${r.stderr.trim()}`);
  const pr = JSON.parse(r.stdout);
  return { branch: pr.headRefName, title: pr.title, fork: pr.isCrossRepository === true };
}

export async function isPullRequest(io, t) {
  const r = await io.exec("gh", ["api", `repos/${t.owner}/${t.repo}/issues/${t.number}`]);
  if (r.code !== 0) throw new Error(`${t.text}: ${r.stderr.trim() || "not found"}`);
  return JSON.parse(r.stdout).pull_request !== undefined;
}

// Only a nicety: without a title the branch is just issue-99.
export async function lookupIssueTitle(io, t) {
  try {
    const r = await io.exec("gh", ["issue", "view", String(t.number), "--repo", `${t.owner}/${t.repo}`, "--json", "title"]);
    return r.code === 0 ? JSON.parse(r.stdout).title : "";
  } catch {
    return "";
  }
}

// GitHub's own stack, as gh stack makes them. Null for a stack built any other
// way, so it's only the first answer, never the only one.
const STACK_QUERY = `query($owner: String!, $repo: String!, $number: Int!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $number) { stack { entries(first: 50) { nodes {
    position pullRequest { number title url headRefName baseRefName headRefOid }
  } } } } }
}`;

// Every chain of open PRs this one belongs to, each bottom-first. Answers with
// no chains rather than failing: a stack is an extra, and the PR still opens.
export async function lookupStacks(io, t) {
  const ask = ["api", "graphql", "-f", `query=${STACK_QUERY}`, "-F", `owner=${t.owner}`, "-F", `repo=${t.repo}`, "-F", `number=${t.number}`];
  try {
    const native = await io.exec("gh", ask);
    const layers = native.code === 0 ? parseNativeStack(native.stdout) : null;
    if (layers) return [layers];
    const r = await io.exec("gh", ["pr", "list", "--repo", `${t.owner}/${t.repo}`, "--state", "open", "--limit", "200", "--json", "number,title,url,headRefName,baseRefName,isCrossRepository"]);
    return r.code === 0 ? walkStacks(JSON.parse(r.stdout), t.number) : [];
  } catch {
    return [];
  }
}

// The config's agents that exist on this machine, so one config can travel. `sh`
// checks, because fs/promises can't see outside home and paths are often there.
export async function configuredAgents(io, cfg) {
  const found = [];
  for (const agent of cfg.agents) {
    const run = [expandHome(agent.run[0], io.home), ...agent.run.slice(1)];
    const check = run[0].includes("/") ? `test -x "$1"` : `command -v "$1" >/dev/null`;
    const r = await io.exec("sh", ["-c", check, "sh", run[0]]).catch(() => ({ code: 1 }));
    if (r.code === 0) found.push({ name: agent.name, run });
  }
  return found;
}

const ORG_FRESH_MS = 24 * 60 * 60 * 1000;

// A list from `cached` while it's under a day old. A failed refresh falls back to
// what's cached, with `stale` saying why. Answers `{ entry, stale, fetched }`.
async function cachedList(fetchList, { cached, now, force = false }) {
  if (cached && !force && now - cached.at < ORG_FRESH_MS) return { entry: cached, fetched: false };
  try {
    return { entry: { at: now, repos: await fetchList() }, fetched: true };
  } catch (e) {
    if (!cached) throw e;
    return { entry: cached, fetched: false, stale: e.message };
  }
}

async function gh(io, args) {
  const r = await io.exec("gh", args);
  if (r.code !== 0) throw new Error(r.stderr.trim() || `gh ${args[0]} failed`);
  return r.stdout;
}

export function orgRepos(io, org, cache) {
  const args = ["repo", "list", org, "--limit", "1000", "--no-archived", "--json", "name,description,pushedAt"];
  return cachedList(async () => JSON.parse(await gh(io, args)), cache);
}

// You, then every org you belong to. Your own repos list the same way an org's do.
export function myOrgs(io, cache) {
  return cachedList(async () => {
    const me = (await gh(io, ["api", "user", "--jq", ".login"])).trim();
    const orgs = (await gh(io, ["api", "user/orgs", "--paginate", "--jq", ".[].login"])).split("\n").filter(Boolean);
    return [me, ...orgs.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))];
  }, cache);
}

const LONG_LIMIT_MS = 15 * 60 * 1000;

// exec stops at 30 s, too short for a clone or a fetch, so slow work runs in a
// core terminal. Herdr's screens don't show it: it carries no herdr.* labels.
export async function runLong(io, argv, { cwd, onStart } = {}) {
  const args = ["run", "--bg", "--json", "--no-parent", "--no-notify"];
  if (cwd) args.push("--cwd", cwd);
  // A prompt for credentials would wait forever in a terminal nobody can see.
  const started = await io.hc([...args, "--", "env", "GIT_TERMINAL_PROMPT=0", ...argv]);
  if (started.code !== 0) throw new Error(`${argv[0]}: ${started.stderr.trim() || started.stdout.trim()}`);
  const { address } = JSON.parse(started.stdout);
  onStart?.(address);

  let result;
  let tail = "";
  try {
    const deadline = Date.now() + LONG_LIMIT_MS;
    do {
      if (Date.now() > deadline) {
        await io.hc(["kill", address]);
        throw new Error(`${argv.slice(0, 3).join(" ")} timed out after ${LONG_LIMIT_MS / 60000} minutes`);
      }
      const waited = await io.hc(["wait", address, "--json", "--timeout", "20"]);
      try {
        result = JSON.parse(waited.stdout);
      } catch {
        throw new Error(`lost track of ${argv[0]}: ${waited.stderr.trim() || waited.stdout.trim() || "hc wait gave nothing"}`);
      }
    } while (!result.ended);
    tail = (await io.hc(["read", address, "--lines", "12"])).stdout.trim().split("\n").slice(-6).join("\n");
  } finally {
    await io.hc(["rm", address]);
    onStart?.(null);
  }
  if (result.exit_code !== 0) throw new Error(`${argv.slice(0, 3).join(" ")} failed (${result.exit_code ?? result.reason})\n${tail}`);
}

// Brings a reused worktree up to its fetched branch. Only ever a fast-forward:
// local work stays, and the answer says why the worktree is still behind.
export async function syncWorktree(io, folder, remoteRef, { onStart } = {}) {
  const counts = await quiet(io, folder, ["rev-list", "--left-right", "--count", `HEAD...${remoteRef}`]);
  const [ahead, behind] = counts.stdout.trim().split(/\s+/).map(Number);
  if (counts.code !== 0) return `couldn't compare it with ${remoteRef}`;
  if (!behind) return null;
  const commits = `${behind} commit${behind === 1 ? "" : "s"} behind ${remoteRef}`;
  if (ahead) return `${commits} with ${ahead} local, so it was left alone`;
  const dirty = await quiet(io, folder, ["status", "--porcelain", "--untracked-files=no"]);
  if (dirty.code !== 0 || dirty.stdout.trim()) return `${commits} with uncommitted changes, so it was left alone`;
  try {
    await runLong(io, ["git", "merge", "--ff-only", remoteRef], { cwd: folder, onStart });
    return null;
  } catch {
    return `${commits}: the fast-forward failed, so it was left alone`;
  }
}
