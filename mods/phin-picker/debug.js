// A trace for finding out why the picker hangs on somebody's machine, written to
// debug.log beside the config when `"debug": true` is set. It stays off otherwise.

export const DEBUG_LOG_PATH = ".config/phin-tech/picker/debug.log";

const MAX_LOG_BYTES = 1000000;
const MAX_ARG = 80;
const MAX_LINE = 300;

// Keeps the newest part of the log, and the log private to you.
const TRIM = `umask 077; if [ -f "$2" ] && [ "$(wc -c <"$2")" -gt ${MAX_LOG_BYTES} ]; then tail -c ${MAX_LOG_BYTES} "$2" >"$2.tmp" && mv "$2.tmp" "$2"; fi; `;
const APPEND = `printf %s "$1" >>"$2"`;

const clip = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

// A hang can be the last thing this code does, so every line gets its own write,
// started on the spot, and nothing sits in memory for a killed script to lose. Two
// writes can land out of order, so go by the timestamps.
export function createTrace(exec, path, now = Date.now) {
  let script = TRIM + APPEND;
  const trace = {
    last: "",
    note(message) {
      trace.last = message;
      const line = `${new Date(now()).toISOString()} ${clip(String(message), MAX_LINE).replaceAll("\n", " ")}\n`;
      exec("sh", ["-c", script, "sh", line, path]).catch(() => {});
      script = APPEND;
    },
  };
  return trace;
}

// Runs fn, sync or async, and notes how long it took. Its start is noted first, so
// a call that never comes back is the last line in the log.
export function timed(note, label, fn, outcome = () => "") {
  const started = Date.now();
  const finish = (word) => note(`${label}: ${word} ${Date.now() - started}ms`);
  const failed = (e) => {
    finish(`failed (${e?.message ?? e})`);
    throw e;
  };
  note(`${label}: start`);
  try {
    const out = fn();
    if (typeof out?.then !== "function") return (finish(outcome(out) || "done"), out);
    return out.then((value) => (finish(outcome(value) || "done"), value), failed);
  } catch (e) {
    return failed(e);
  }
}

const describe = (name, args = [], opts) =>
  [name, ...args.map((a) => clip(String(a), MAX_ARG)), opts?.cwd ? `(in ${opts.cwd})` : ""].filter(Boolean).join(" ");

function exitOf(r) {
  const why = r.code ? ` ${clip((r.stderr ?? "").trim(), 160)}` : "";
  return `exit ${r.code}${why}`;
}

// The same io, noting every command it runs.
export function traced(io, note) {
  return {
    ...io,
    note,
    exec: (cmd, args, opts) => timed(note, describe(cmd, args, opts), () => io.exec(cmd, args, opts), exitOf),
    hc: (args) => timed(note, describe("hc", args), () => io.hc(args), exitOf),
  };
}
