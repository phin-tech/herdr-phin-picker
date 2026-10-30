import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const recipe = readFileSync(new URL("../RECIPE.md", import.meta.url), "utf8");
const mod = JSON.parse(readFileSync(new URL("../mods/phin-picker/mod.json", import.meta.url), "utf8"));
const versions = [...recipe.matchAll(/^### (\d+\.\d+\.\d+) \(/gm)].map((m) => m[1]);

test("the newest Changelog entry is the mod's version", () => {
  assert.equal(versions[0], mod.version);
});

test("the Changelog runs newest first with no repeats", () => {
  const key = (v) => v.split(".").reduce((n, part) => n * 1000 + Number(part), 0);
  const sorted = [...new Set(versions)].sort((a, b) => key(b) - key(a));
  assert.deepEqual(versions, sorted);
});
