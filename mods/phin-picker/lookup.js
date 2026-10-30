// Finding things on disk and through git and gh. Everything from the outside
// world arrives in `io`, so Node can test this against real repositories:
// { exec(cmd, args, opts), hc(args), readdir(path), readText(path), exists(path), home }.

import { PROMPTS_PATH, expandHome, repoCandidates } from "./config.js";
import { DEFAULT_PROMPTS } from "./prompts.js";
import { parseBranches, parseWorktrees } from "./rows.js";

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
        for (const stack = [dir]; stack.length; ) {
          const at = stack.pop();
          next.push(at);
          stack.push(...(await childDirs(io, at)));
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
    const text = (await io.readText(`${dir}/${name}`))?.trim();
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
  const r = await io.exec("gh", ["pr", "view", String(t.number), "--repo", `${t.owner}/${t.repo}`, "--json", "headRefName,title"]);
  if (r.code !== 0) throw new Error(`gh pr view ${t.owner}/${t.repo}#${t.number}: ${r.stderr.trim()}`);
  const pr = JSON.parse(r.stdout);
  return { branch: pr.headRefName, title: pr.title };
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

// exec stops at 30 s, too short for a clone or a fetch, so slow work runs in a
// core terminal. Herdr's screens don't show it: it carries no herdr.* labels.
export async function runLong(io, argv, { cwd, onStart } = {}) {
  const args = ["run", "--bg", "--json", "--no-parent", "--no-notify"];
  if (cwd) args.push("--cwd", cwd);
  const started = await io.hc([...args, "--", ...argv]);
  if (started.code !== 0) throw new Error(`${argv[0]}: ${started.stderr.trim() || started.stdout.trim()}`);
  const { address } = JSON.parse(started.stdout);
  onStart?.(address);

  let result;
  do {
    result = JSON.parse((await io.hc(["wait", address, "--json", "--timeout", "20"])).stdout);
  } while (!result.ended);

  const output = await io.hc(["read", address, "--lines", "12"]);
  await io.hc(["rm", address]);
  onStart?.(null);
  if (result.exit_code !== 0) {
    const tail = output.stdout.trim().split("\n").slice(-6).join("\n");
    throw new Error(`${argv.slice(0, 3).join(" ")} failed (${result.exit_code ?? result.reason})\n${tail}`);
  }
}
