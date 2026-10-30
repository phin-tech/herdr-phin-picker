// Settings: ~/.config/phin-tech/picker/config.json, every key optional.
// Saved prompts sit beside it in prompts/, one file each.

import { sanitize } from "./target.js";

export const CONFIG_PATH = ".config/phin-tech/picker/config.json";
export const PROMPTS_PATH = ".config/phin-tech/picker/prompts";

const DEFAULTS = {
  repos: { templates: ["~/src/{host}/{owner}/{repo}"] },
  agent: {
    enabled: false,
    argv: ["claude"],
    prompts: {
      github_pr: "Review PR #{{.Number}} — {{.Title}}\n{{.URL}}",
      github_issue: "Work issue #{{.Number}} — {{.Title}}\n{{.URL}}",
      linear: "Work {{.Issue}} — {{.Title}}\n{{.URL}}",
      project: "",
    },
  },
  projects: { roots: null, git_only: true, depth: 1 },
  worktrees: { path: "~/.herdr/worktrees/{repo}/{branch}" },
};

export const MAX_DEPTH = 8;

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export function parseConfig(text) {
  let file = {};
  let problem = null;
  if (text) {
    try {
      file = JSON.parse(text);
      if (!isObject(file)) throw new Error("expected an object");
    } catch (e) {
      file = {};
      problem = `config.json: ${e.message}; using defaults`;
    }
  }
  // A wrong type falls back to its default and says so, rather than breaking the picker.
  const bad = [];
  const pick = (section, key, ok, fallback) => {
    const value = isObject(file[section]) ? file[section][key] : undefined;
    if (value === undefined) return fallback;
    if (ok(value)) return value;
    bad.push(`${section}.${key}`);
    return fallback;
  };
  const strings = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === "string" && s);
  const text_ = (v) => typeof v === "string" && v;

  const templates = pick("repos", "templates", strings, DEFAULTS.repos.templates);
  const prompts = pick("agent", "prompts", isObject, {});
  const roots = pick("projects", "roots", strings, null) ?? deriveRoots(templates);
  const depth = pick("projects", "depth", (v) => Number.isInteger(v) && v >= 1, DEFAULTS.projects.depth);
  const cfg = {
    repos: { templates },
    agent: {
      enabled: pick("agent", "enabled", (v) => typeof v === "boolean", DEFAULTS.agent.enabled),
      argv: pick("agent", "argv", strings, DEFAULTS.agent.argv),
      prompts: { ...DEFAULTS.agent.prompts, ...prompts },
    },
    projects: { roots, git_only: pick("projects", "git_only", (v) => typeof v === "boolean", true), depth: Math.min(depth, MAX_DEPTH) },
    worktrees: { path: pick("worktrees", "path", text_, DEFAULTS.worktrees.path) },
  };
  if (bad.length) problem = `config.json: bad value for ${bad.join(", ")}; using defaults`;
  return { ...cfg, problem };
}

// "~/src/{host}/{owner}/{repo}" means "~/src/*/*": the folders checkouts sit in.
export function deriveRoots(templates) {
  const roots = [];
  for (const tmpl of templates) {
    const segments = tmpl.trim().split("/");
    const cut = segments.findIndex((s) => s.includes("{repo}"));
    if (cut <= 0) continue;
    const root = segments.slice(0, cut).join("/").replace(/\{[a-z_]+\}/g, "*");
    if (root && !roots.includes(root)) roots.push(root);
  }
  return roots;
}

export function expandHome(path, home) {
  if (path === "~") return home;
  return path.startsWith("~/") ? `${home}/${path.slice(2)}` : path;
}

export function expandTemplate(tmpl, values, home) {
  return expandHome(tmpl.replace(/\{([a-z_]+)\}/g, (_m, key) => values[key] ?? ""), home);
}

export function repoCandidates(cfg, t, home) {
  return cfg.repos.templates.map((tmpl) => expandTemplate(tmpl, { host: t.host ?? "github.com", owner: t.owner, repo: t.repo }, home));
}

export function worktreePath(cfg, { repo, repoRoot, branch, owner, host }, home) {
  return expandTemplate(cfg.worktrees.path, { host: host ?? "github.com", owner: owner ?? "", repo, repo_root: repoRoot, branch: sanitize(branch) }, home);
}

// The plain {{.Field}} subset of the old Go templates. An unknown field renders empty.
export function renderPrompt(tmpl, data) {
  return (tmpl ?? "").replace(/\{\{\s*\.(\w+)\s*\}\}/g, (_m, key) => String(data[key] ?? ""));
}

export function promptData(t, { branch = "", title = "", path = "" } = {}) {
  return {
    URL: t.url, Host: t.host, Owner: t.owner, Repo: t.repo, Number: t.number,
    Issue: t.issue, Slug: t.slug, Text: t.text, Branch: branch, Title: title, Path: path,
  };
}
