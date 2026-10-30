import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PROMPTS, promptsFor } from "../mods/phin-picker/prompts.js";
import { promptData, renderPrompt } from "../mods/phin-picker/config.js";
import { parse } from "../mods/phin-picker/target.js";

const names = (row) => promptsFor(row, DEFAULT_PROMPTS).map((p) => p.name);

test("each row gets the prompts that suit it", () => {
  assert.deepEqual(names({ kind: "branch" }), ["orient", "plan", "fix-tests", "review-branch"]);
  assert.deepEqual(names({ kind: "link", target: parse("https://github.com/a/b/pull/1") }), ["orient", "review", "address-comments", "fix-ci"]);
  assert.deepEqual(names({ kind: "link", target: parse("https://github.com/a/b/issues/1") }), ["orient", "plan", "implement", "investigate"]);
  assert.deepEqual(names({ kind: "linear_base", target: parse("https://linear.app/p/issue/ENG-1/x") }), ["orient", "plan", "implement", "investigate"]);
});

test("a prompt with no `for` shows everywhere, like your own", () => {
  assert.deepEqual(promptsFor({ kind: "branch" }, [{ name: "mine", text: "x" }]).map((p) => p.name), ["mine"]);
});

test("no prompt leaves a placeholder or a blank on a row it's offered for", () => {
  const rows = [
    { target: parse("https://github.com/a/b/pull/7") },
    { target: parse("https://github.com/a/b/issues/7") },
    { target: parse("https://linear.app/p/issue/ENG-1/x") },
  ];
  for (const row of rows) {
    for (const p of promptsFor(row, DEFAULT_PROMPTS)) {
      const out = renderPrompt(p.text, promptData(row.target, { title: "Title" }));
      assert.ok(!out.includes("{{"), p.name);
      assert.ok(!/#\s|: *$/m.test(out), `${p.name}: ${out}`);
    }
  }
  for (const p of promptsFor({ kind: "branch" }, DEFAULT_PROMPTS)) assert.ok(!p.text.includes("{{"), p.name);
});
