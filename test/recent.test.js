import test from "node:test";
import assert from "node:assert/strict";
import { recordUse, scoreAt } from "../mods/phin-picker/recent.js";

const day = 24 * 60 * 60 * 1000;

test("a score halves every two weeks", () => {
  const r = recordUse({}, "/a", 0);
  assert.equal(scoreAt(r["/a"], 0), 1);
  assert.equal(scoreAt(r["/a"], 14 * day), 0.5);
  assert.equal(scoreAt(undefined, 0), 0);
});

test("uses add up", () => {
  const r = recordUse(recordUse({}, "/a", 0), "/a", 0);
  assert.equal(scoreAt(r["/a"], 0), 2);
});

test("often beats once, and today beats a long-left favourite", () => {
  let r = recordUse({}, "/once", 10 * day);
  for (let i = 0; i < 5; i++) r = recordUse(r, "/often", 9 * day + i);
  assert.ok(scoreAt(r["/often"], 10 * day) > scoreAt(r["/once"], 10 * day));

  let s = {};
  for (let i = 0; i < 10; i++) s = recordUse(s, "/old", 0);
  s = recordUse(s, "/new", 90 * day);
  assert.ok(scoreAt(s["/new"], 90 * day) > scoreAt(s["/old"], 90 * day));
});

test("keeps the strongest when it gets long", () => {
  let r = {};
  for (let i = 0; i < 305; i++) r = recordUse(r, `/p${i}`, i * day);
  assert.equal(Object.keys(r).length, 300);
  assert.ok(r["/p304"]);
  assert.ok(!r["/p0"]);
});

test("recording leaves the old map alone", () => {
  const before = {};
  recordUse(before, "/a", 0);
  assert.deepEqual(before, {});
});
