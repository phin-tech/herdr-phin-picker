# Phin Picker

A Herdr app mod that opens repos, branches, PRs and tickets as Spaces. `README.md`
has the keys, the config schema and the built-in prompts. Herdr's own manual is
`~/.config/herdr-app/AGENTS.md`; the app's API is in `herdr.d.ts` and
`gpui-kit.d.ts` beside it.

## Using the picker for someone

The picker has no CLI: `herdr-app do mod.open --name phin-picker` opens it, and
only a person can drive it from there. To do what it does yourself, use the
commands it uses:

- PR: `gh pr view`, `git fetch origin <branch>`, `git worktree add`, then
  `herdr-app do space.new --name "repo#N" --folder <worktree> --argv '["claude"]' --task "<prompt>"`.
- Worktrees belong at `worktrees.path` from the config (default
  `~/.herdr/worktrees/{repo}/{branch}`), so the picker finds them later.
- Name a PR or issue Space `repo#N`, a ticket Space by its key, and a stack Space
  `repo#first-last`. That name is how the picker recognises it as already open.

## Configuring it for someone

Everything lives in `~/.config/phin-tech/picker/`, and the picker reads it each
time it opens. Done when `config.json` parses and the picker shows no ⚠ line.

- A saved prompt is `prompts/<name>.md` or `.txt`, shown on every row. Using a
  built-in's name replaces that built-in.
- A prompt shows on every row, so a file using `{{.Number}}` leaves it blank on a
  branch. Keep saved prompts to fields every row has, or none. Which row has which
  field: `promptData` in `config.js`, and `openRow` in `actions.js`.
- To change which row a prompt suits, or add one for everyone, edit
  `mods/phin-picker/prompts.js`. Each `for` is a target kind or `local`.

## Changing the code

Done when all three pass, in this order:

1. `npm test`
2. `herdr-app check` on both mods, in `~/.config/herdr-app/mods/`.
3. `herdr-app do mod.open --name phin-picker`, then `herdr-app shot <file>.png`,
   and look at it. Use `phin-worktrees` for the branch level, and
   `herdr-app status` for errors.

`target.js`, `rows.js`, `config.js` and `prompts.js` are pure. `lookup.js` and
`actions.js` take the outside world as `io` and `ctx`. Keep new logic in these so
Node can test it, and keep `main.js` to the UI.

Every pushed change bumps `version` in `mods/phin-picker/mod.json` and adds an entry
to the Changelog in `RECIPE.md`, since that's what installed copies update from. Say
under **You need to** anything a person or their agent must do by hand. `npm test`
fails if the two versions differ.

The installed mods are symlinks to this repo, so saving a file changes the
running app.

`herdr-app check` and step 3 stop at the first screen, because nothing here can
press keys in the app. To exercise a flow for real, copy the modules into a
temporary mod that calls `openRow`, run it with `mod.open`, then remove the mod
and everything it made. Use `phin-tech/test-repo` #95 for a PR. Use `echo` as the
agent to read a prompt without starting a real one: `task` arrives as its last
argument.

### What the app won't let you do

- **`run()` answers nothing.** Use `command` (`herdr-app do`) when a later step needs
  an id, as a stack's tabs need their Space.

- **Imports stop at the mod's folder.** That's why `phin-worktrees` only opens
  `phin-picker` with props, and why a probe needs copies of the modules.
- **`mod.open` takes no props.** A key can't choose a starting level.
- **`exec` stops at 30 seconds.** Clones, fetches and `git worktree add` go through
  `runLong`, which uses a core terminal with no `herdr.*` labels so it stays off
  screen, with a 15 minute limit and credential prompts turned off.
- **`fs/promises` reads inside home only.** Glob walks start at the deepest literal
  folder. `readdir` Dirents don't follow symlinks, so `childDirs` checks `<path>/.`.
- **The text box takes `ctrl+a`,** and likely other editing keys. Offer choices as
  rows, on the tab levels, rather than as ctrl chords.
- **`task` is a plain argument,** so a leading `-` would read as a flag.
- **`hc keys` can't type `#`,** so prompts can't be typed and left unsent. `task` is
  the only way in, and it submits.

### Known gaps

- Reopening a PR only fast-forwards. A worktree with local commits or uncommitted
  changes stays put, and the toast and the agent's prompt both say so.
- A plain open uses `run()`, so a `space.new` that fails after the work is done
  shows only the app's own error.
- A stack that's already open is updated and shown, so a layer added since then
  gets no tab until the Space is closed and reopened.
- `findRepo` looks only at `repos.templates`. A checkout filed under a different
  owner is listed by discovery, but its links won't find it.
- `[[sources]]`, setups, promote and handoff are still only in herdr-phin-util.
