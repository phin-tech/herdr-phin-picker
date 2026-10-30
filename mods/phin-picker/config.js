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

export function parseConfig(text) {
  let file = {};
  let problem = null;
  if (text) {
    try {
      file = JSON.parse(text);
    } catch (e) {
      problem = `config.json: ${e.message}; using defaults`;
    }
  }
  const agent = { ...DEFAULTS.agent, ...file.agent };
  agent.prompts = { ...DEFAULTS.agent.prompts, ...file.agent?.prompts };
  const repos = { ...DEFAULTS.repos, ...file.repos };
  const projects = { ...DEFAULTS.projects, ...file.projects };
  projects.roots ??= deriveRoots(repos.templates);
  return { repos, agent, projects, worktrees: { ...DEFAULTS.worktrees, ...file.worktrees }, problem };
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
