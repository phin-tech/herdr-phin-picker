import test from "node:test";
import assert from "node:assert/strict";
import { branchFor, labelFor, parse, parseRepoShorthand, sanitize } from "../mods/phin-picker/target.js";

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

test("sanitize", () => {
  assert.equal(sanitize("UPPER/Case"), "upper/case");
  assert.equal(sanitize("  Fix: the  thing!  "), "fix-the-thing");
  assert.equal(sanitize("a..b"), "a-b");
  assert.equal(sanitize("--./x./"), "x");
});
