#!/bin/sh
#
# Phin Picker uninstaller. Removes the mod from the Herdr desktop app.
#
# It walks you through two steps, and asks before it changes anything:
#   1. Move phin-picker and phin-worktrees out of Herdr's mods folder.
#   2. Remove the keys that open them, leaving every other key alone.
#
# Nothing is deleted: the mods move to a backup folder you can remove yourself.
# Your settings and saved prompts stay in ~/.config/phin-tech/picker.
#
#   sh uninstall.sh          ask first
#   sh uninstall.sh --yes    don't ask, for scripts

set -eu

MOD_NAMES="phin-picker phin-worktrees"

HERDR_HOME=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
MODS_DIR=$HERDR_HOME/mods
KEYS_FILE=$HERDR_HOME/keys.json

say() { printf '%s\n' "$*"; }
stop() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }
step() { say ""; say "Step $1 of 2: $2"; }

refuse_symlinks() {
  for mod in $MOD_NAMES; do
    [ -L "$MODS_DIR/$mod" ] && stop "$MODS_DIR/$mod is a symlink to a clone. Remove the link yourself."
  done
  return 0
}

show_plan() {
  say "Phin Picker uninstaller"
  say ""
  say "This will:"
  say "  1. move phin-picker and phin-worktrees out of $MODS_DIR"
  say "  2. remove the keys that open them from $KEYS_FILE"
  say ""
  say "Nothing is deleted, and your settings and saved prompts stay."
  say ""
}

# Under `curl | sh` the script itself is on stdin, so the answer has to come from
# the terminal. With no terminal there's nobody to ask, and no means no.
ask() {
  [ "$ASSUME_YES" = no ] || return 0
  ( : </dev/tty ) 2>/dev/null || stop "no terminal to ask on. Run it with --yes to skip the question."
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r answer </dev/tty || answer=""
  case $answer in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

move_mods_out() {
  step 1 "Removing the mods"
  backup_dir=$HERDR_HOME/phin-picker-backup-$(date +%Y%m%d-%H%M%S)
  for mod in $MOD_NAMES; do
    if [ -d "$MODS_DIR/$mod" ]; then
      mkdir -p "$backup_dir"
      mv "$MODS_DIR/$mod" "$backup_dir/$mod"
      say "Removed $mod"
    fi
  done
  if [ -d "$backup_dir" ]; then say "Saved to $backup_dir"; else say "No mods to remove."; fi
}

print_keys_to_remove() {
  say "To remove them yourself, delete these from \"global\" in $KEYS_FILE:"
  say '  "cmd-o": "mod.open:phin-picker"'
  say '  "cmd-shift-o": "mod.open:phin-worktrees"'
}

remove_keys() {
  step 2 "Removing the keys"
  [ -f "$KEYS_FILE" ] || { say "No keys.json, so there's nothing to remove."; return 0; }
  command -v jq >/dev/null 2>&1 || { say "jq isn't installed, so the keys weren't removed."; print_keys_to_remove; return 0; }
  jq empty "$KEYS_FILE" 2>/dev/null || { say "$KEYS_FILE isn't valid JSON, so the keys weren't removed."; print_keys_to_remove; return 0; }

  # Matches on what a key does, not which key it is, so a rebound key goes too and
  # a key you use for something else stays. Written beside the file and moved over
  # it, so a failure can't damage keys.json.
  merged=$(mktemp "$HERDR_HOME/keys.json.XXXXXX")
  jq '
    def ours: . == "mod.open:phin-picker" or . == "mod.open:phin-worktrees";
    with_entries(.value |= if type == "object" then with_entries(select(.value | ours | not)) else . end)
  ' "$KEYS_FILE" >"$merged"
  mv "$merged" "$KEYS_FILE"
  say "Keys removed."
}

# Everything runs from here, on the last line of the file, so a download cut off
# halfway does nothing at all.
main() {
  case ${1:-} in
    "") ASSUME_YES=no ;;
    --yes | -y) ASSUME_YES=yes ;;
    *) stop "unknown option $1. Use --yes or nothing." ;;
  esac

  refuse_symlinks
  show_plan
  ask "Continue?" || { say "Nothing changed."; exit 0; }

  move_mods_out
  remove_keys

  say ""
  say "Done. Phin Picker is uninstalled."
}

main "$@"
