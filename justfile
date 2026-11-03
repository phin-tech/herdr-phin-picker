set shell := ["bash", "-euo", "pipefail", "-c"]

release_tool := "uv run --quiet --project scripts/release app-release"

default:
    @just --list

# Run the tests
test:
    npm test

# Check release.toml and the mods' versions (no network, changes nothing)
release-check:
    {{release_tool}} check

# Check everything a release needs outside the repo
doctor:
    {{release_tool}} doctor

# Bump (patch, minor or major), commit, push, put the zip on apps.phin.tech and tag. Takes --dry-run
[positional-arguments]
ship part *args:
    {{release_tool}} ship "$@"

# Run app-release directly
[positional-arguments]
release-tool *args:
    {{release_tool}} "$@"
