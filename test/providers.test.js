import test from "node:test";
import assert from "node:assert/strict";
import { rememberRows, actionArgv, matchProvider, parseProvider, parseRows } from "../mods/phin-picker/providers.js";

const manifest = (picker) => JSON.stringify({ place: "none", picker });

test("a mod registers with a prefix and a command", () => {
  assert.deepEqual(parseProvider("tasks", manifest({ prefix: ">", title: "Tasks", rows: ["x", "list"] })),
    { mod: "tasks", prefix: ">", title: "Tasks", rows: ["x", "list"] });
  assert.equal(parseProvider("tasks", manifest({ prefix: ">", rows: ["x"] })).title, "tasks");
});

test("anything else isn't a provider, and never throws", () => {
  assert.equal(parseProvider("a", "{nope"), null);
  assert.equal(parseProvider("a", "null"), null);
  assert.equal(parseProvider("a", '{"place":"none"}'), null);
  assert.equal(parseProvider("a", manifest({ prefix: "", rows: ["x"] })), null);
  assert.equal(parseProvider("a", manifest({ prefix: "a b", rows: ["x"] })), null);
  assert.equal(parseProvider("a", manifest({ prefix: ">", rows: [] })), null);
  assert.equal(parseProvider("a", manifest({ prefix: ">", rows: [1] })), null);
});

test("a prefix matches only at the start, and carries the query", () => {
  const providers = [{ prefix: ">" }];
  assert.deepEqual(matchProvider(">", providers).query, "");
  assert.deepEqual(matchProvider("  > build ", providers).query, "build");
  assert.equal(matchProvider("repo>x", providers), null);
  assert.equal(matchProvider(">", []), null);
});

test("rows get defaults, and unrunnable ones drop out", () => {
  const run = { label: "Run", run: ["x", "go"], input: "--args" };
  const rows = parseRows(JSON.stringify([
    { label: "build", detail: "Build it", tag: "just", args: "x", needs: true, actions: [run, { label: "broken" }] },
    { label: "bare", actions: [{ label: "Run", run: ["x"] }] },
    { label: "no actions" },
    { label: "bad actions", actions: [{ label: "Run", run: [1] }] },
    null,
  ]));
  assert.deepEqual(rows.map((r) => r.label), ["build", "bare"]);
  assert.equal(rows[0].kind, "provider");
  assert.equal(rows[0].needs, true);
  assert.equal(rows[0].actions.length, 1);
  assert.equal(rows[0].actions[0].kind, "provider_action");
  assert.deepEqual([rows[1].badge, rows[1].needs, rows[1].args, rows[1].actions[0].input], ["run", false, "", null]);
});

test("the box's text goes after the action's input flag", () => {
  const action = { run: ["x"], input: "--args" };
  assert.deepEqual(actionArgv(action, "a b"), ["x", "--args", "a b"]);
  assert.deepEqual(actionArgv(action, ""), ["x"]);
  assert.deepEqual(actionArgv({ run: ["x"], input: null }, "a"), ["x"]);
});

test("output that isn't a list is an error", () => {
  assert.throws(() => parseRows("{}"), /JSON array/);
  assert.throws(() => parseRows("nope"));
});

test("saved rows: null when unchanged, and the oldest folder goes first", () => {
  const rows = [{ label: "a" }];
  const saved = rememberRows(undefined, "one", rows);
  assert.deepEqual(saved.one, rows);
  assert.equal(rememberRows(saved, "one", rows), null);
  let many = saved;
  for (let i = 0; i < 40; i++) many = rememberRows(many, `f${i}`, rows);
  assert.equal(Object.keys(many).length, 30);
  assert.ok(!("one" in many));
  assert.ok("f39" in many);
});
