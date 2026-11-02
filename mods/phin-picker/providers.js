// Other mods can add a prefix to the picker. Pure, so Node can test it.
// A mod registers in its mod.json, since it may not be running when the picker opens:
//   "picker": { "prefix": ">", "title": "Tasks", "rows": ["my-cli", "list", "--json"] }
// `rows` runs in the focused folder and prints a JSON array of
//   { label, actions: [{ label, run, detail?, input? }], detail?, tag?, args?, needs? }
// Enter runs the first action; tab lists them, and the box holds text for `input`.
// See the README.

const isText = (v) => typeof v === "string" && v.length > 0;

export function parseProvider(mod, text) {
  let picker;
  try { picker = JSON.parse(text)?.picker; } catch { return null; }
  if (!picker || !isText(picker.prefix) || /\s/.test(picker.prefix)) return null;
  if (!Array.isArray(picker.rows) || !picker.rows.length || !picker.rows.every(isText)) return null;
  return { mod, prefix: picker.prefix, title: isText(picker.title) ? picker.title : mod, rows: picker.rows };
}

export function matchProvider(text, providers) {
  const value = text.trimStart();
  const provider = providers.find((p) => value.startsWith(p.prefix));
  return provider ? { provider, query: value.slice(provider.prefix.length).trim() } : null;
}

const parseAction = (a) => {
  if (!isText(a?.label) || !Array.isArray(a.run) || !a.run.length || !a.run.every(isText)) return null;
  return { kind: "provider_action", label: a.label, detail: typeof a.detail === "string" ? a.detail : "", run: a.run, input: isText(a.input) ? a.input : null };
};

// A row it can't run is left out rather than failing the rest.
export function parseRows(stdout) {
  const rows = JSON.parse(stdout);
  if (!Array.isArray(rows)) throw new Error("expected a JSON array");
  return rows.flatMap((r) => {
    const actions = (Array.isArray(r?.actions) ? r.actions : []).map(parseAction).filter(Boolean);
    if (!isText(r?.label) || !actions.length) return [];
    return [{
      kind: "provider",
      label: r.label,
      detail: typeof r.detail === "string" ? r.detail : "",
      badge: isText(r.tag) ? r.tag.slice(0, 7) : "run",
      args: typeof r.args === "string" ? r.args : "",
      needs: r.needs === true,
      actions,
    }];
  });
}

const MAX_SAVED_FOLDERS = 30;

// Rows per folder from last time, so a prefix shows something at once. The answer
// is what to save, or null when nothing changed: saving re-renders every mod.
export function rememberRows(saved, key, rows) {
  if (JSON.stringify(saved?.[key]) === JSON.stringify(rows)) return null;
  const next = { ...saved };
  delete next[key];
  next[key] = rows;
  return Object.fromEntries(Object.entries(next).slice(-MAX_SAVED_FOLDERS));
}

// The command for an action; what's in the box goes after its `input` flag.
export function actionArgv(action, text) {
  return text && action.input ? [...action.run, action.input, text] : action.run;
}
