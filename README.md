# Phin Picker

Get to a repo, a branch, a PR or a Linear ticket in one keystroke, in the
[Herdr](https://herdr.dev) desktop app. A JavaScript mod ported from the picker
in [herdr-phin-util](https://github.com/phin-tech/herdr-phin-util), which stays
the plugin for terminal Herdr.

Needs `git`, and `gh` authenticated for PRs, issues and cloning.

## Install

Link or copy both mod folders, then merge `keys.json` into
`~/.config/herdr-app/keys.json`:

```sh
ln -s "$PWD/mods/phin-picker" "$PWD/mods/phin-worktrees" ~/.config/herdr-app/mods/
herdr-app check ~/.config/herdr-app/mods/phin-picker
herdr-app check ~/.config/herdr-app/mods/phin-worktrees
```

| Key | Does |
| --- | --- |
| `cmd-o` | open the picker on your projects |
| `cmd-shift-o` | open it on the branches of the repo in focus |

## Using it

Open Spaces come first, then checkouts on disk. A checkout with a Space never
appears twice.

| Key | Does |
| --- | --- |
| type | subsequence filter over name and path |
| `enter` | open the row |
| `tab` | go into a repo's worktrees and branches |
| `shift+tab` / `esc` | back up a level, filter intact |
| `ctrl+a` | toggle "start an agent" |
| `ctrl+r` | fetch and refresh, at the branch level |

Paste into the box instead of filtering:

| Pasted | You get |
| --- | --- |
| GitHub PR URL | a worktree Space on the PR's branch |
| GitHub issue URL | a worktree Space on a branch named from the title |
| Linear URL | pick a repository, then a base, for the ticket's branch |
| `owner/repo` or a repo URL | clone it, or open it if you have it |

Type a name that matches no branch and you get a row that creates it, based on
the default branch.

Agent prompts are sent as soon as the agent starts. The app has no way to type
one and leave it unsent.

## Configuration

`~/.config/phin-picker/config.json`. Every key is optional:

```json
{
  "repos": { "templates": ["~/src/{host}/{owner}/{repo}"] },
  "agent": {
    "enabled": true,
    "argv": ["claude"],
    "prompts": {
      "github_pr": "Review PR #{{.Number}} — {{.Title}}\n{{.URL}}",
      "github_issue": "Work issue #{{.Number}} — {{.Title}}\n{{.URL}}",
      "linear": "Work {{.Issue}} — {{.Title}}\n{{.URL}}",
      "project": ""
    }
  },
  "projects": { "roots": ["~/src/*/*"], "git_only": true, "depth": 1 },
  "worktrees": { "path": "~/.herdr/worktrees/{repo}/{branch}" }
}
```

`projects.roots` defaults to what `repos.templates` implies. Roots must be inside
your home folder, since mods can't read outside it. Prompts take plain
`{{.Field}}` placeholders: `URL Host Owner Repo Number Title Issue Slug Branch
Text Path`.

## Hacking on it

`target.js`, `rows.js` and `config.js` are pure, and `lookup.js` and `actions.js`
take the outside world as an argument, so they all run under Node:

```sh
npm test
```

`herdr-app check` only loads a mod and renders it once, so run both.
- Mods can't import across folders, which is why `phin-worktrees` just opens
  `phin-picker` with props: `mod.open` passes none.
- `exec` stops at 30 seconds, so clones, fetches and `git worktree add` run in a
  core terminal through `runLong`. Without `herdr.*` labels it stays off screen.
- `fs/promises` only reads inside home, so glob walks start at the deepest
  literal folder.
