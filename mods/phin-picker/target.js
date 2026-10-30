// What a pasted string refers to. Pure parsing: no network, no filesystem.
// Ported from herdr-phin-util's internal/target.

const prPath = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const issuePath = /^\/([^/]+)\/([^/]+)\/issues\/(\d+)/;
const repoPath = /^\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
const sshRepo = /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/;
// Strict on purpose: "codex/iterm-split" is a branch far more often than a repo,
// so this only runs at the project level.
const shorthandRepo = /^([A-Za-z0-9][A-Za-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9._-]*)$/;
const linearPath = /^\/[^/]+\/issue\/([A-Za-z][A-Za-z0-9]*-\d+)(?:\/([^/?#]*))?/;
const urlParts = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^/?#]*)([^?#]*)/;

function repoTarget(text, owner, repo) {
  return { kind: "github_repo", url: text, text, host: "github.com", owner, repo };
}

function ghTarget(kind, text, m) {
  return { kind, url: text, text, host: "github.com", owner: m[1], repo: m[2], number: Number(m[3]) };
}

export function parse(input) {
  const text = input.trim();
  const plain = { kind: "plain", text };
  if (!text) return plain;

  const ssh = text.match(sshRepo);
  if (ssh) return repoTarget(text, ssh[1], ssh[2]);

  const url = text.match(urlParts);
  if (!url) return plain;
  const host = url[1].toLowerCase().replace(/^www\./, "");
  const path = url[2];

  if (host === "github.com") {
    let m = path.match(prPath);
    if (m) return ghTarget("github_pr", text, m);
    m = path.match(issuePath);
    if (m) return ghTarget("github_issue", text, m);
    m = path.match(repoPath);
    if (m) return repoTarget(text, m[1], m[2]);
    return plain;
  }
  if (host === "linear.app") {
    const m = path.match(linearPath);
    if (!m) return plain;
    return { kind: "linear", url: text, text, issue: m[1].toUpperCase(), slug: m[2] ?? "" };
  }
  return plain;
}

export function parseRepoShorthand(input) {
  const text = input.trim();
  const m = text.match(shorthandRepo);
  return m ? repoTarget(text, m[1], m[2]) : null;
}

export function sanitize(s) {
  let out = s.trim().toLowerCase().replace(/[^a-z0-9._/-]+/g, "-");
  out = out.replace(/^[-./]+|[-./]+$/g, "").replaceAll("..", "-");
  while (out.includes("--")) out = out.replaceAll("--", "-");
  return out;
}

// The branch to create. Only tickets get one: a PR's must be read, never guessed.
export function branchFor(t) {
  if (t.kind === "linear") {
    const key = t.issue.toLowerCase();
    return t.slug ? `${key}-${sanitize(t.slug)}` : key;
  }
  if (t.kind === "github_issue") return t.slug ? `${t.number}-${sanitize(t.slug)}` : `issue-${t.number}`;
  return "";
}

export function labelFor(t) {
  if (t.kind === "github_pr" || t.kind === "github_issue") return `${t.repo}#${t.number}`;
  if (t.kind === "linear") return t.issue;
  if (t.kind === "github_repo") return t.repo;
  return t.text;
}
