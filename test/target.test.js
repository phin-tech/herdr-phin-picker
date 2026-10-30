import test from "node:test";
import assert from "node:assert/strict";
import { branchFor, labelFor, parse, parseRef, parseRepoShorthand, resolveRef, sanitize } from "../mods/phin-picker/target.js";

test("pull request URLs, with anything after the number", () => {
  for (const url of [
    "https://github.com/phin-tech/herdr-phin-util/pull/42",
    "https://github.com/phin-tech/herdr-phin-util/pull/42/files",
    "https://github.com/phin-tech/herdr-phin-util/pull/42#issuecomment-1",
    "https://www.github.com/phin-tech/herdr-phin-util/pull/42",
  ]) {
    const t = parse(url);
    assert.equal(t.kind, "github_pr");
    assert.equal(t.owner, "phin-tech");
    assert.equal(t.repo, "herdr-phin-util");
    assert.equal(t.number, 42);
    assert.equal(t.host, "github.com");
  }
});

test("issues share a number sequence with PRs, so labels can't collide", () => {
  const t = parse("https://github.com/phin-tech/roux/issues/99#issuecomment-123");
  assert.equal(t.kind, "github_issue");
  assert.equal(labelFor(t), "roux#99");
  assert.equal(branchFor(t), "issue-99");
  assert.equal(branchFor({ ...t, slug: "Fix the flaky test" }), "99-fix-the-flaky-test");
  assert.equal(branchFor(parse("https://github.com/phin-tech/roux/pull/7")), "");
});

test("repository references", () => {
  for (const ref of ["https://github.com/phin-tech/roux", "https://github.com/phin-tech/roux.git", "https://github.com/phin-tech/roux/", "git@github.com:phin-tech/roux.git", "git@github.com:phin-tech/roux"]) {
    const t = parse(ref);
    assert.equal(t.kind, "github_repo", ref);
    assert.equal(t.owner, "phin-tech");
    assert.equal(t.repo, "roux");
  }
});

test("other GitHub pages and bare text are plain", () => {
  for (const s of ["https://github.com/phin-tech/herdr-phin-util/commits/main", "https://github.com/phin-tech", "https://github.com/", "fix login", "", "https://example.com/a/b"]) {
    assert.equal(parse(s).kind, "plain", s);
  }
  assert.equal(parse("phin-tech/roux").kind, "plain");
});

test("owner/repo shorthand", () => {
  assert.equal(parseRepoShorthand("phin-tech/roux").repo, "roux");
  assert.ok(parseRepoShorthand("codex/iterm-split"));
  for (const s of ["a/b/c", "owner/repo#42", "https://github.com/phin-tech/roux"]) assert.equal(parseRepoShorthand(s), null, s);
});

test("Linear", () => {
  const t = parse("https://linear.app/phin/issue/ENG-123/fix-the-flaky-test");
  assert.equal(t.kind, "linear");
  assert.equal(labelFor(t), "ENG-123");
  assert.equal(branchFor(t), "eng-123-fix-the-flaky-test");
  assert.equal(branchFor(parse("https://linear.app/phin/issue/ENG-123")), "eng-123");
  assert.equal(parse("https://linear.app/phin/issue/eng-7/x").issue, "ENG-7");
});

test("links pasted without a scheme, and an ssh URL", () => {
  assert.equal(parse("github.com/a/b/pull/3").kind, "github_pr");
  assert.equal(parse("www.github.com/a/b/issues/3").kind, "github_issue");
  assert.equal(parse("linear.app/p/issue/ENG-1/x").kind, "linear");
  assert.equal(parse("ssh://git@github.com/a/b.git").repo, "b");
});

test("a dotted owner or repo can't walk out of the checkout path", () => {
  for (const s of ["https://github.com/../x/pull/1", "https://github.com/a/..", "git@github.com:../x.git", "https://github.com/a/../issues/2"]) {
    assert.equal(parse(s).kind, "plain", s);
  }
});

test("owner/repo#42 waits for GitHub to say what it is", () => {
  const t = parseRef("  phin-tech/roux#42 ");
  assert.equal(t.kind, "github_ref");
  assert.equal(labelFor(t), "roux#42");
  assert.equal(resolveRef(t, true).kind, "github_pr");
  assert.equal(resolveRef(t, false).kind, "github_issue");
  assert.equal(resolveRef(t, true).url, "https://github.com/phin-tech/roux/pull/42");
  for (const s of ["roux#42", "a/b/c#1", "a/b#x", "a/..#1"]) assert.equal(parseRef(s), null, s);
});

test("sanitize", () => {
  assert.equal(sanitize("UPPER/Case"), "upper/case");
  assert.equal(sanitize("  Fix: the  thing!  "), "fix-the-thing");
  assert.equal(sanitize("a..b"), "a-b");
  assert.equal(sanitize("--./x./"), "x");
});
