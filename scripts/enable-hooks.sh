#!/usr/bin/env bash
# Turn on this repo's gitleaks hooks (core.hooksPath = .githooks). Run by
# `npm install` / `npm ci` as the `prepare` script (#88, audit finding L10), so
# a fresh clone gets the hooks without anyone remembering to. It also warns if
# gitleaks itself is missing; scripts/install-gitleaks.sh installs it.
#
# Never fails: it must not break `npm ci` on Vercel, in CI, without git, or
# outside a clone (a tarball, or this package installed as a dependency). In
# those cases it does nothing. Quiet when there's nothing to do. Safe to rerun.

# Not -e: every failure here is handled, and the script always exits 0.
set -uo pipefail

# If this package is ever installed as a dependency, the script runs inside
# someone's node_modules: leave their repo alone.
root="$(cd "$(dirname "$0")/.." && pwd)" || exit 0
case "$root" in */node_modules/*) exit 0 ;; esac

# CI and Vercel builds don't commit, and CI runs its own secret scan.
if [ -n "${CI:-}" ] || [ -n "${VERCEL:-}" ]; then exit 0; fi

command -v git >/dev/null 2>&1 || exit 0
# Must be the top of a git checkout (a clone or a worktree), not just somewhere
# inside one: a copy of this folder inside another repo must not change that repo.
top="$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[ "$(cd "$top" && pwd -P)" = "$(cd "$root" && pwd -P)" ] || exit 0

if [ "$(git -C "$root" config --get core.hooksPath 2>/dev/null)" != .githooks ]; then
  if git -C "$root" config core.hooksPath .githooks 2>/dev/null; then
    echo "Git hooks enabled (core.hooksPath = .githooks)."
  else
    echo "warning: couldn't set core.hooksPath; run scripts/install-gitleaks.sh." >&2
    exit 0
  fi
fi

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "warning: gitleaks is not installed, so the git hooks will block commits and pushes." >&2
  echo "         Install it with: scripts/install-gitleaks.sh" >&2
fi
exit 0
