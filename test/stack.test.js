import test from "node:test";
import assert from "node:assert/strict";
import { parseNativeStack, stackName, walkStacks } from "../mods/phin-picker/stack.js";

const pr = (number, head, base, extra = {}) => ({ number, title: `t${number}`, url: `u${number}`, headRefName: head, baseRefName: base, ...extra });
const numbers = (paths) => paths.map((p) => p.map((l) => l.number));
const three = [pr(100, "a", "main"), pr(101, "b", "a"), pr(102, "c", "b"), pr(50, "other", "main")];

test("the whole chain, asked from any layer", () => {
  for (const n of [100, 101, 102]) assert.deepEqual(numbers(walkStacks(three, n)), [[100, 101, 102]]);
});

test("a lone PR is a chain of one", () => {
  assert.deepEqual(numbers(walkStacks(three, 50)), [[50]]);
});

test("a PR that isn't open has no chain", () => {
  assert.deepEqual(walkStacks(three, 999), []);
});

test("a fork in the stack gives a chain per tip, sharing what's below", () => {
  const prs = [pr(1, "a", "main"), pr(2, "b", "a"), pr(3, "c", "a"), pr(4, "d", "c")];
  assert.deepEqual(numbers(walkStacks(prs, 1)), [[1, 2], [1, 3, 4]]);
  assert.deepEqual(numbers(walkStacks(prs, 3)), [[1, 3, 4]]);
});

test("a loop ends", () => {
  assert.deepEqual(numbers(walkStacks([pr(1, "a", "b"), pr(2, "b", "a")], 1)), [[2, 1]]);
});

test("a fork's branch doesn't parent what's based on the same name here", () => {
  const prs = [pr(1, "main", "main", { isCrossRepository: true }), pr(2, "x", "main"), pr(3, "y", "main")];
  assert.deepEqual(numbers(walkStacks(prs, 2)), [[2]]);
  assert.deepEqual(numbers(walkStacks(prs, 1)), [[1]]);
  assert.equal(walkStacks(prs, 1)[0][0].fork, true);
});

test("layers keep what opening one needs", () => {
  assert.deepEqual(walkStacks(three, 102)[0][1], { number: 101, title: "t101", url: "u101", branch: "b", base: "a", fork: false });
});

test("GitHub's stack comes back in position order, and null is no answer", () => {
  const nodes = [{ position: 2, pullRequest: pr(2, "b", "a") }, { position: 1, pullRequest: pr(1, "a", "main") }];
  const wrap = (stack) => JSON.stringify({ data: { repository: { pullRequest: { stack } } } });
  assert.deepEqual(parseNativeStack(wrap({ entries: { nodes } })).map((l) => l.number), [1, 2]);
  assert.equal(parseNativeStack(wrap(null)), null);
  assert.equal(parseNativeStack(wrap({ entries: { nodes: [] } })), null);
});

test("a stack's Space is named by its ends", () => {
  assert.equal(stackName({ repo: "roux" }, [{ number: 1 }, { number: 2 }, { number: 3 }]), "roux#1-3");
});
