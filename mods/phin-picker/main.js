// Get to a repo, a branch, a PR or a ticket. Open Spaces first, then checkouts
// on disk. Type to filter or paste a link; tab goes deeper, enter opens.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, hc, home, knownAgents, notify, panes, spaces, focused, props, closeOverlay, readTextFile, run, setShared, shared, theme } from "herdr";
import { exists, readdir } from "fs/promises";
import { CONFIG_PATH, parseConfig } from "./config.js";
import { promptsFor } from "./prompts.js";
import { parse, resolveRef } from "./target.js";
import { recordUse, scoreAt } from "./recent.js";
import { configuredAgents, discover, findRepo, isPullRequest, listBranches, loadPrompts, lookupStacks, myOrgs, orgRepos, repoOf, runLong } from "./lookup.js";
import { actionRows, mergeAgents, hasActions, hasExactBranch, linearBaseRows, newBranchRow, orgCompletions, orgPrefix, orgRow, orgRows, parseOrgQuery, parseQuery, projectRows, promptRows, rank, resolveLink, sameList, stackRows, worktreeRows } from "./rows.js";
import { cloneRepo, openRow } from "./actions.js";

const VISIBLE = 14;
const BADGES = {
  space: "open", project: "new", clone: "clone", link: "link", worktree: "tree",
  branch: "local", remote_branch: "remote", new_branch: "create", linear_base: "base", prunable: "gone", action: "do", prompt: "prompt", stack: "stack", org: "org",
};

const io = {
  exec,
  hc,
  // Throws outside home, where a mod can't read: to the picker that's just absent.
  exists: (path) => exists(path).catch(() => false),
  readText: readTextFile,
  home: home(),
  readdir: (path) => readdir(path, { withFileTypes: true }),
};

// `run`, but it answers: a stack's tabs need the Space the first command made.
async function command(name, args) {
  const r = await exec("herdr-app", ["do", name, JSON.stringify(args)]);
  const out = JSON.parse(r.stdout || "{}");
  if (r.code !== 0 || out.error) throw new Error(`${name}: ${out.error ?? r.stderr.trim()}`);
  return out;
}

const ORGS = "phin-picker.orgs";
const MY_ORGS = "@me"; // In the same cache: "@" can't start a GitHub login.
const orgCache = (org) => shared(ORGS)?.[org.toLowerCase()];
const rememberOrg = (org, entry) => setShared(ORGS, { ...shared(ORGS), [org.toLowerCase()]: entry });

const PATHS = "phin-picker.paths";
const PRELOADED_REPOS = 4;

const RECENT = "phin-picker.recent";
const recent = () => shared(RECENT) ?? {};
const used = (path) => setShared(RECENT, recordUse(recent(), path, Date.now()));

function scorer() {
  const seen = recent();
  const now = Date.now();
  return (path) => scoreAt(seen[path], now);
}

export default class Picker extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Filter, or paste a link…" });
    this.input.on("change", (_e, cx) => this.applyFilter(cx));
    this.input.on("submit", (_e, cx) => this.submit(cx));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());

    this.levels = [];
    this.repoReads = new Map();
    this.rows = [];
    this.at = 0;
    this.steps = null;
    this.job = null;
    this.problem = null;
    this.ticket = null;

    cx.spawn(async (cx) => {
      this.cfg = parseConfig(await readTextFile(`${io.home}/${CONFIG_PATH}`).catch(() => null));
      this.problem = this.cfg.problem;
      try {
        if (props().start === "branches") {
          const folder = focused()?.cwd;
          if (!folder) throw new Error("no terminal in focus to take a repository from");
          if (spaces().find((s) => s.active)?.machine) throw new Error("this Space is on another machine, and the picker only works here");
          await this.pushRepo(folder, true);
        } else {
          // Last time's list now, then a fresh scan behind it, so opening is instant.
          const cached = shared(PATHS);
          if (cached) {
            this.showProjects(cached);
            this.applyFilter(cx);
          }
          const paths = await discover(io, this.cfg.projects);
          if (!cached || !sameList(cached, paths)) {
            setShared(PATHS, paths);
            this.showProjects(paths);
            this.refilterKeepingRow(cx);
          }
          this.preload();
        }
      } catch (e) {
        this.problem = e.message;
      }
      this.applyFilter(cx);
    });
  }

  showProjects(paths) {
    const rows = projectRows({ spaces: spaces(), panes: panes(), paths, home: io.home, score: scorer() });
    const orgs = this.cfg.orgs.map((org) => orgRow(org, orgCache(org), Date.now()));
    const all = [...rows, ...orgs];
    if (this.levels[0]?.kind === "projects") this.levels[0].all = all;
    else this.levels = [{ kind: "projects", all, filter: "" }];
  }

  refilterKeepingRow(cx) {
    if (this.level.kind !== "projects") return;
    const picked = this.rows[this.at];
    this.applyFilter(cx);
    const still = this.rows.findIndex((r) => r.path && r.path === picked?.path);
    if (still >= 0) this.at = still;
    cx.notify();
  }

  // Readied while you look at the list, so tab doesn't wait on the likely picks.
  // Only local reads: org lists stay behind asking for them.
  preload() {
    this.agents();
    for (const row of this.levels[0].all.filter((r) => r.path).slice(0, PRELOADED_REPOS)) this.readRepo(row.path);
  }

  agents() {
    this.agentList ??= (async () => {
      const known = await knownAgents().catch(() => []);
      return mergeAgents(known.filter((a) => a.installed), await configuredAgents(io, this.cfg));
    })();
    return this.agentList;
  }

  readRepo(folder) {
    if (!this.repoReads.has(folder)) {
      const read = (async () => {
        const repo = await repoOf(io, folder);
        return { repo, ...(await listBranches(io, repo)) };
      })();
      read.catch(() => this.repoReads.delete(folder)); // Tried again if it's picked.
      this.repoReads.set(folder, read);
    }
    return this.repoReads.get(folder);
  }

  async close() {
    const job = this.job;
    this.job = null;
    if (job) await exec("hc", ["kill", job]).then(() => exec("hc", ["rm", job])).catch(() => {});
    closeOverlay(props().overlay);
  }

  get level() {
    return this.levels[this.levels.length - 1];
  }

  async pushRepo(folder, root = false) {
    const { repo, worktrees, branches } = await this.readRepo(folder);
    const found = worktreeRows({ worktrees, branches, repo, spaces: spaces(), panes: panes(), home: io.home });
    const level = { kind: "branches", repo, found, all: this.ticket ? linearBaseRows(repo, this.ticket, found) : found, filter: "" };
    if (root) this.levels = [level];
    else this.levels.push(level);
  }

  applyFilter(cx) {
    const level = this.level;
    if (!level) return cx.notify();
    const query = this.input.value().trim();
    level.filter = query;
    this.at = 0;
    this.problem = this.notice ?? this.cfg?.problem ?? null;
    this.notice = null;
    const prefix = level.kind === "projects" ? orgPrefix(query) : null;
    if (prefix !== null) {
      this.rows = orgCompletions(prefix, orgCache(MY_ORGS)?.repos ?? [], orgCache, Date.now());
      this.loadMyOrgs(cx);
      return cx.notify();
    }
    const org = level.kind === "projects" ? parseOrgQuery(query) : null;
    if (org) {
      this.rows = [orgRow(org, orgCache(org), Date.now())];
      return cx.notify();
    }
    const t = level.kind === "actions" || level.kind === "prompts" ? parse("") : parseQuery(query, level.kind === "projects");
    if (t.kind === "github_repo") {
      this.rows = [];
      cx.spawn(async (cx) => {
        const row = resolveLink(spaces(), t, await findRepo(io, this.cfg, t), io.home, panes());
        if (this.input.value().trim() === query) this.rows = [row];
        cx.notify();
      });
      return cx.notify();
    }
    if (t.kind === "github_ref") {
      this.rows = [];
      cx.spawn(async (cx) => {
        try {
          const row = resolveLink(spaces(), resolveRef(t, await isPullRequest(io, t)), null, io.home);
          if (this.input.value().trim() === query) this.rows = [row];
        } catch (e) {
          if (this.input.value().trim() === query) this.problem = e.message;
        }
        cx.notify();
      });
      return cx.notify();
    }
    const link = resolveLink(spaces(), t, null, io.home);
    // At the action level the box holds a prompt, which only an agent can take.
    if (level.kind === "actions") this.rows = query ? level.all.filter((r) => r.argv) : level.all;
    else if (link) this.rows = [link];
    else if (!query) this.rows = level.all;
    else {
      this.rows = rank(query, level.all);
      if (level.kind === "branches" && !this.ticket && !hasExactBranch(level.all, query)) this.rows = [...this.rows, newBranchRow(level.repo, query)];
    }
    cx.notify();
  }

  // Runs slow work with a checklist on screen. A failed step stays there with why.
  busy(cx, work, { argv = null, prompt = "" } = {}) {
    this.steps = [];
    this.problem = null;
    cx.notify();
    cx.spawn(async (cx) => {
      const step = async (label, fn) => {
        const s = { label, state: "running", started: Date.now() };
        this.steps.push(s);
        cx.notify();
        try {
          const out = await fn();
          s.state = "done";
          s.secs = (Date.now() - s.started) / 1000;
          cx.notify();
          return out;
        } catch (e) {
          s.state = "failed";
          throw e;
        }
      };
      const warn = (title, body) => notify({ title, body, level: "warning" });
      const ctx = { io, cfg: this.cfg, run, command, spaces, argv, prompt, step, warn, used, onJob: (t) => { this.job = t; } };
      try {
        if (await work(ctx)) return closeOverlay(props().overlay);
        this.steps = null;
        this.applyFilter(cx);
      } catch (e) {
        this.problem = e.message;
      }
      cx.notify();
    });
  }

  submit(cx) {
    const row = this.rows[this.at];
    if (!row || this.steps) return;
    // A ticket names no repository, so the next pick is the repository.
    if (row.kind === "link" && row.target.kind === "linear") return this.takeTicket(row, cx);
    if (row.kind === "stack" || row.kind === "org" || (this.ticket && this.level.kind === "projects")) return this.descend(cx);
    const defaultAgent = this.cfg.agent.enabled ? this.cfg.agent.argv : null;
    const picked = row.row ?? row;
    const prompt = row.kind === "prompt" ? row.text : row.kind === "action" ? this.input.value().trim() : "";
    this.busy(cx, async (ctx) => {
      await openRow(ctx, picked, this.level.repo);
      const repoPath = this.level.repo?.root ?? picked.path;
      if (repoPath) used(repoPath);
      return true;
    }, row.row ? { argv: row.argv, prompt } : { argv: defaultAgent });
  }

  takeTicket(row, cx) {
    this.ticket = row.target;
    if (this.level.kind === "branches") this.level.all = linearBaseRows(this.level.repo, this.ticket, this.level.found);
    this.input.set_value("");
    this.applyFilter(cx);
  }

  descend(cx) {
    const row = this.rows[this.at];
    if (!row || this.steps) return;
    if (row.kind === "link" && row.target.kind === "linear") return this.takeTicket(row, cx);
    if (this.level.kind === "prompts") return;
    if (row.kind === "stack") return this.pushActions(row, cx);
    if (row.kind === "org") return this.pushOrg(row.org, cx);
    if (this.level.kind === "actions") {
      if (!row.argv) return;
      return this.busy(cx, async (ctx) => {
        const prompts = promptsFor(row.row, await ctx.step("Loading prompts", () => loadPrompts(io)));
        this.levels.push({ kind: "prompts", name: row.label, repo: this.level.repo, all: promptRows(row, prompts), filter: "" });
        this.input.set_value("");
        return false;
      });
    }
    const repoRow = row.kind === "project" || row.kind === "space";
    if (["projects", "org"].includes(this.level.kind) && row.kind === "clone") {
      return this.busy(cx, async (ctx) => {
        const dest = await cloneRepo(ctx, row.target);
        await this.pushRepo(dest);
        this.input.set_value("");
        return false;
      });
    }
    if (["projects", "org"].includes(this.level.kind) && repoRow) {
      if (!row.path) return;
      return this.busy(cx, async (ctx) => {
        await ctx.step(`Reading ${row.label}`, () => this.pushRepo(row.path));
        this.input.set_value("");
        return false;
      });
    }
    if (hasActions(row)) this.pushActions(row, cx);
  }

  // Your orgs for completing "org:", once per opening unless forced. Only names,
  // from the cache while it's fresh: no org's repos are read until one is picked.
  loadMyOrgs(cx, force = false) {
    if (this.orgsAsked && !force) return;
    this.orgsAsked = true;
    cx.spawn(async (cx) => {
      try {
        const found = await myOrgs(io, { cached: orgCache(MY_ORGS), now: Date.now(), force });
        if (found.fetched) rememberOrg(MY_ORGS, found.entry);
        if (found.stale) this.notice = `couldn't refresh your orgs, showing the saved list: ${found.stale}`;
      } catch (e) {
        this.notice = `couldn't list your orgs: ${e.message}`;
      }
      if (orgPrefix(this.input.value().trim()) !== null) this.applyFilter(cx);
    });
  }

  pushOrg(org, cx, force = false) {
    const projects = this.levels[0].all;
    this.busy(cx, async (ctx) => {
      const found = await ctx.step(`Listing ${org}`, () => orgRepos(io, org, { cached: orgCache(org), now: Date.now(), force }));
      if (found.fetched) rememberOrg(org, found.entry);
      if (force) this.levels.pop();
      this.levels.push({ kind: "org", org, name: org, all: orgRows({ org, repos: found.entry.repos, cfg: this.cfg, home: io.home, projects }), filter: "" });
      this.input.set_value("");
      this.notice = found.stale ? `couldn't refresh ${org}, showing the saved list: ${found.stale}` : null;
      return false;
    });
  }

  pushActions(row, cx) {
    this.busy(cx, async (ctx) => {
      const installed = await ctx.step("Checking your agents", () => this.agents());
      const choices = installed.length ? installed : [{ name: this.cfg.agent.argv[0], run: this.cfg.agent.argv }];
      const pr = row.kind === "link" && row.target.kind === "github_pr";
      const stacks = pr ? await ctx.step("Looking for a stack", async () => stackRows(row.target, await lookupStacks(io, row.target))) : [];
      this.levels.push({ kind: "actions", name: row.label, repo: this.level.repo, all: [...actionRows(row, choices), ...stacks], filter: "" });
      this.input.set_value("");
      return false;
    });
  }

  ascend(cx) {
    if (this.steps) {
      // Still running: leaving ends the job (close kills it).
      if (!this.problem) return this.close();
      this.steps = null;
      this.problem = null;
      return cx.notify();
    }
    if (this.levels.length <= 1 && !this.ticket) return this.close();
    if (this.levels.length > 1) this.levels.pop();
    else {
      this.ticket = null;
      if (this.level.kind === "branches") this.level.all = this.level.found;
    }
    this.input.set_value(this.level.filter);
    this.applyFilter(cx);
  }

  refresh(cx) {
    const level = this.level;
    if (level?.kind === "org" && !this.steps) return this.pushOrg(level.org, cx, true);
    if (level?.kind === "projects" && orgPrefix(this.input.value().trim()) !== null) return this.loadMyOrgs(cx, true);
    if (level?.kind !== "branches" || this.steps) return;
    this.busy(cx, async (ctx) => {
      await ctx.step("Fetching origin", () => runLong(io, ["git", "fetch", "--prune", "origin"], { cwd: level.repo.root, onStart: ctx.onJob }));
      this.levels.pop();
      this.repoReads.delete(level.repo.root);
      await this.pushRepo(level.repo.root, !this.levels.length);
      return false;
    });
  }

  footer() {
    const row = this.rows[this.at];
    const kind = this.level?.kind;
    const repoRow = (kind === "projects" || kind === "org") && (row?.kind === "clone" || ((row?.kind === "project" || row?.kind === "space") && row.path));
    const tab = repoRow ? "⇥ branches" : row?.kind === "stack" ? "⇥ choose" : row?.kind === "org" ? "⇥ search" : kind === "actions" ? (row?.argv ? "⇥ saved prompts" : null) : row && kind !== "prompts" && hasActions(row) ? "⇥ actions" : null;
    const parts = [kind === "actions" ? "↵ do it · type a prompt for the agent" : "↵ open", tab, kind === "branches" || kind === "org" ? "⌃R fetch" : null, "esc back"];
    return parts.filter(Boolean).join("   ");
  }

  title() {
    const names = this.levels.map((l) => l.name ?? l.repo?.name).filter(Boolean);
    return ["Open a project", ...names].join(" › ");
  }

  rowView(t, r, i) {
    const on = i === this.at;
    return h_flex().id(`row-${i}`).mx(4).px(10).h(30).flex_none().gap(10).items_center().rounded(7).cursor_pointer()
      .when(on, (el) => el.bg(t.hover))
      .hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => { this.at = i; this.submit(cx); })
      .child(div().w(48).flex_none().text_size(11).text_color(r.kind === "space" ? t.accent : t.dim).child(BADGES[r.kind] ?? r.kind))
      .child(div().flex_none().max_w(280).truncate().text_color(t.foreground).child(r.label))
      .child(div().flex_1().truncate().text_size(11.5).text_color(t.dim).child(r.detail ?? ""));
  }

  stepView(t, s, i) {
    const mark = { running: "◐", done: "✓", failed: "✕" }[s.state];
    return h_flex().id(`step-${i}`).px(14).h(26).flex_none().gap(10).items_center()
      .child(div().w(14).text_color(s.state === "failed" ? t.blocked : s.state === "done" ? t.done : t.working).child(mark))
      .child(div().flex_1().truncate().text_color(t.foreground).child(s.label))
      .child(div().text_size(11).text_color(t.dim).child(s.secs ? `${s.secs.toFixed(1)}s` : ""));
  }

  render() {
    const t = theme();
    this.at = Math.max(0, Math.min(this.at, this.rows.length - 1));
    const first = Math.max(0, Math.min(this.at - Math.floor(VISIBLE / 2), this.rows.length - VISIBLE));
    const shown = this.rows.slice(first, first + VISIBLE);

    const body = this.steps
      ? this.steps.map((s, i) => this.stepView(t, s, i))
      : shown.map((r, i) => this.rowView(t, r, first + i));

    return v_flex().id("phin-picker").track_focus(this.handle).size_full().min_h(0).p(16).gap(10).bg(t.popover).text_size(13)
      .on_key_down((e, cx) => {
        const n = this.rows.length;
        if (e.key === "escape") this.ascend(cx);
        else if (e.key === "down" && n) this.at = (this.at + 1) % n;
        else if (e.key === "up" && n) this.at = (this.at + n - 1) % n;
        else if (e.key === "tab" && e.modifiers.shift) this.ascend(cx);
        else if (e.key === "tab") this.descend(cx);
        else if (e.key === "r" && e.modifiers.control) this.refresh(cx);
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(div().truncate().text_size(15).font_semibold().text_color(t.foreground).child(this.title()))
      .when(!!this.ticket, (el) => el.child(div().text_size(12).text_color(t.accent).truncate().child(`Ticket ${this.ticket.issue}: ${this.level?.kind === "branches" ? "pick a base" : "pick a repository"}`)))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex().flex_1().min_h(0).overflow_hidden().children(body))
      .when(!!this.problem, (el) => el.child(div().text_size(11.5).text_color(t.blocked).child(`⚠ ${this.problem}`)))
      .child(div().text_size(11).text_color(t.dim).child(this.footer()));
  }
}
