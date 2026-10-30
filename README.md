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
| `enter` | open the row, with no agent unless `agent.enabled` is set |
| `tab` | on a repo, its worktrees and branches; on anything else, what to do with it |
| `shift+tab` / `esc` | back up a level, filter intact |
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

The `tab` level offers Open and a Start row for each agent installed here. Type
in the box there to give the agent a prompt, replacing the configured one, or
press `tab` on a Start row to pick a saved prompt.
Projects and branches have no configured prompt by default. Agent prompts are
sent as soon as the agent starts. The app has no way to type
one and leave it unsent.

## Configuration

Everything lives in `~/.config/phin-tech/picker/`. `config.json` is optional, and
so is every key in it:

```json
{
  "repos": { "templates": ["~/src/{host}/{owner}/{repo}"] },
  "agent": {
    "enabled": false,
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

## Saved prompts

`tab` on a Start row lists the prompts that suit that row:

| Row | Prompts |
| --- | --- |
| project or branch | `orient`, `plan`, `fix-tests`, `review-branch` |
| PR | `orient`, `review`, `address-comments`, `fix-ci` |
| issue or Linear ticket | `orient`, `plan`, `implement`, `investigate` |

Add your own, or replace one of these by using its name. Each `.md` or `.txt` file in `~/.config/phin-tech/picker/prompts/` is a prompt,
named after the file, and shows on every row:

```
~/.config/phin-tech/picker/prompts/
  review.md      Review {{.Branch}} for correctness bugs.
  plan.md        Read {{.Repo}} and write a plan before changing anything.
```

They take the same placeholders as the prompts above. A row only fills in what
it knows: a PR has `Number`, `Title` and `URL`, while a branch has `Repo`, `Path`
and `Branch`. Anything else renders empty. The picker reads the folder each time,
so a new file shows up without a reload.

## Hacking on it

`AGENTS.md` has how to change and test this, for agents and people alike.
