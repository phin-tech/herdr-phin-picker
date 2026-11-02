#!/bin/sh
#
# Phin Picker installer. Installs or updates the mod for the Herdr desktop app.
#
# It walks you through four steps, and asks before it changes anything:
#   1. Download a fixed release from GitHub and check its SHA-256.
#   2. Back up any copy you already have.
#   3. Copy phin-picker and phin-worktrees into Herdr's mods folder.
#   4. Add two keys to keys.json, if you say yes and they're free.
#
# It never uses sudo, and it only touches Herdr's own folder.
#
#   sh install.sh          ask first
#   sh install.sh --yes    don't ask, for scripts

set -eu

VERSION=0.4.4
SHA256=85f3dd05b0b7da3010f2bd20d6eac8af5093584f27820f41014ac98de47ed815
REPO_URL=https://github.com/phin-tech/herdr-phin-picker
TARBALL=$REPO_URL/releases/download/v$VERSION/herdr-phin-picker-$VERSION.tar.gz
MOD_NAMES="phin-picker phin-worktrees"

HERDR_HOME=${HERDR_APP_HOME:-$HOME/.config/herdr-app}
MODS_DIR=$HERDR_HOME/mods
KEYS_FILE=$HERDR_HOME/keys.json

say() { printf '%s\n' "$*"; }
stop() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }
step() { say ""; say "Step $1 of 4: $2"; }

refuse_symlinks() {
  for mod in $MOD_NAMES; do
    [ -L "$MODS_DIR/$mod" ] && stop "$MODS_DIR/$mod is a symlink to a clone. Update the clone instead."
  done
  return 0
}

show_plan() {
  say "Phin Picker $VERSION installer"
  say ""
  say "This will:"
  say "  1. download version $VERSION from GitHub and check its SHA-256"
  say "  2. back up any copy already in $MODS_DIR"
  say "  3. copy phin-picker and phin-worktrees there"
  say "  4. offer to add cmd-o and cmd-shift-o to $KEYS_FILE"
  say ""
  say "The mod runs git, gh, hc and herdr-app, and can start your coding agents."
  say ""
}

# Under `curl | sh` the script itself is on stdin, so the answer has to come from
# the terminal. With no terminal there's nobody to ask, and no means no.
ask() {
  [ "$ASSUME_YES" = no ] || return 0
  ( : </dev/tty ) 2>/dev/null || stop "no terminal to ask on. Run it with --yes to skip the questions."
  printf '%s [y/N] ' "$1" >/dev/tty
  read -r answer </dev/tty || answer=""
  case $answer in
    y | Y | yes | YES) return 0 ;;
    *) return 1 ;;
  esac
}

sha256_of() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  elif command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    stop "no shasum or sha256sum here, so the download can't be checked. Nothing changed."
  fi
}

download() {
  step 1 "Downloading version $VERSION"
  curl -fsSL -o "$WORK_DIR/release.tar.gz" "$TARBALL"
  [ "$(sha256_of "$WORK_DIR/release.tar.gz")" = "$SHA256" ] ||
    stop "the download doesn't match the SHA-256 in this script. Nothing changed."
  say "Download verified."

  mkdir "$WORK_DIR/release"
  tar -xzf "$WORK_DIR/release.tar.gz" -C "$WORK_DIR/release" --strip-components=1
}

back_up_old_copies() {
  step 2 "Backing up any old copy"
  backup_dir=$HERDR_HOME/phin-picker-backup-$(date +%Y%m%d-%H%M%S)
  for mod in $MOD_NAMES; do
    if [ -d "$MODS_DIR/$mod" ]; then
      mkdir -p "$backup_dir"
      mv "$MODS_DIR/$mod" "$backup_dir/$mod"
    fi
  done
  if [ -d "$backup_dir" ]; then say "Saved to $backup_dir"; else say "Nothing to back up."; fi
}

install_mods() {
  step 3 "Installing the mods"
  mkdir -p "$MODS_DIR"
  for mod in $MOD_NAMES; do
    cp -R "$WORK_DIR/release/mods/$mod" "$MODS_DIR/$mod"
    say "Added $mod"
  done
}

print_keys_to_add() {
  say "To add them yourself, put these in \"global\" in $KEYS_FILE:"
  say '  "cmd-o": "mod.open:phin-picker"'
  say '  "cmd-shift-o": "mod.open:phin-worktrees"'
}

add_keys() {
  step 4 "Adding the keys"
  if ! ask "Add cmd-o and cmd-shift-o to keys.json?"; then
    say "Left keys.json alone."
    print_keys_to_add
    return 0
  fi
  command -v jq >/dev/null 2>&1 || { say "jq isn't installed, so the keys weren't added."; print_keys_to_add; return 0; }
  [ -f "$KEYS_FILE" ] || printf '{}\n' >"$KEYS_FILE"
  jq empty "$KEYS_FILE" 2>/dev/null || { say "$KEYS_FILE isn't valid JSON, so the keys weren't added."; print_keys_to_add; return 0; }

  # A key already bound to something else stays as it is, and gets named here.
  jq -r --slurpfile new "$WORK_DIR/release/keys.json" '
    (.global // {}) as $have | $new[0].global | to_entries[]
    | select($have[.key] != null and $have[.key] != .value)
    | "Left \(.key) alone: it already does \($have[.key]). To use it, bind \(.value)."
  ' "$KEYS_FILE"

  # Written beside the file and moved over it, so a failure can't damage keys.json.
  merged=$(mktemp "$HERDR_HOME/keys.json.XXXXXX")
  jq --slurpfile new "$WORK_DIR/release/keys.json" '.global = ($new[0].global + (.global // {}))' "$KEYS_FILE" >"$merged"
  mv "$merged" "$KEYS_FILE"
  say "Keys are ready."
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

  WORK_DIR=$(mktemp -d)
  trap 'rm -rf "$WORK_DIR"' EXIT

  download
  back_up_old_copies
  install_mods
  add_keys

  say ""
  say "Done. Phin Picker $VERSION is installed. Press cmd-o in Herdr to open it."
}

main "$@"
