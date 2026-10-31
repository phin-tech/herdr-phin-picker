import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTrace, timed, traced } from "../mods/phin-picker/debug.js";
import { parseConfig } from "../mods/phin-picker/config.js";

const realExec = (cmd, args) => new Promise((resolve) => {
  execFile(cmd, args, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }));
});

const settled = () => new Promise((resolve) => setTimeout(resolve, 150));
const logIn = async () => join(await mkdtemp(join(tmpdir(), "picker-debug-")), "debug.log");

test("debug is off unless it's exactly true", () => {
  assert.equal(parseConfig(null).debug, false);
  assert.equal(parseConfig('{"debug": true}').debug, true);
  assert.equal(parseConfig('{"debug": "yes"}').debug, false);
  assert.match(parseConfig('{"debug": "yes"}').problem, /debug/);
});

test("a line is sent before the note returns, ahead of any hang", () => {
  const sent = [];
  // Never answers, as under a blocked script: the next line still mustn't wait.
  const trace = createTrace((_cmd, args) => { sent.push(args[3]); return new Promise(() => {}); }, "/log", () => 0);
  trace.note("first");
  trace.note("about to hang");
  assert.match(sent[1], /about to hang/);
  assert.equal(trace.last, "about to hang");
});

test("the log keeps every line, and is private", async () => {
  const path = await logIn();
  const trace = createTrace(realExec, path);
  for (let i = 0; i < 50; i++) trace.note(`line ${i}`);
  await settled();
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  assert.deepEqual(new Set(lines.map((l) => l.split(" ").slice(1).join(" "))), new Set(Array.from({ length: 50 }, (_, i) => `line ${i}`)));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("a log past its limit keeps only the newest part", async () => {
  const path = await logIn();
  await writeFile(path, "x".repeat(1200000));
  createTrace(realExec, path).note("newest");
  await settled();
  const text = await readFile(path, "utf8");
  assert.ok(text.length < 1000100);
  assert.match(text, /newest\n$/);
});

test("a failing write never reaches the picker", async () => {
  const trace = createTrace(() => Promise.reject(new Error("no sh")), "/log");
  trace.note("one");
  await settled();
  trace.note("two");
  await settled();
});

test("timed notes a start, and how sync and async work ended", async () => {
  const notes = [];
  const note = (m) => notes.push(m.replace(/\d+ms/, "Nms"));
  assert.equal(timed(note, "sync", () => 1), 1);
  assert.equal(await timed(note, "async", async () => 2), 2);
  await assert.rejects(timed(note, "bad", async () => { throw new Error("boom"); }), /boom/);
  assert.throws(() => timed(note, "worse", () => { throw new Error("bang"); }), /bang/);
  assert.deepEqual(notes, [
    "sync: start", "sync: done Nms",
    "async: start", "async: done Nms",
    "bad: start", "bad: failed (boom) Nms",
    "worse: start", "worse: failed (bang) Nms",
  ]);
});

test("traced notes commands, clipping long arguments, and leaves results alone", async () => {
  const notes = [];
  const io = { home: "/h", exec: async () => ({ code: 1, stdout: "", stderr: "denied\n" }), hc: async () => ({ code: 0, stdout: "ok" }) };
  const t = traced(io, (m) => notes.push(m));
  const r = await t.exec("gh", ["api", "x".repeat(500)], { cwd: "/repo" });
  assert.equal(r.code, 1);
  assert.equal(t.home, "/h");
  assert.equal((await t.hc(["ls"])).stdout, "ok");
  assert.match(notes[0], /^gh api x+… \(in \/repo\): start$/);
  assert.ok(notes[0].length < 120);
  assert.match(notes[1], /exit 1 denied \d+ms$/);
  assert.match(notes[3], /^hc ls: exit 0 \d+ms$/);
});
