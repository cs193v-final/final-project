# shellcheck shell=bash
# shellcheck disable=SC2034  # variables are used by the hooks that source this file
# Shared by pre-commit and pre-push. Sourced, not executed.

# Minimum gitleaks version: the hooks use `gitleaks git` (v8.19+) and the
# config uses [[allowlists]] / [[rules.allowlists]] (v8.25+).
GITLEAKS_MIN_VERSION=8.25.0

# gitleaks exits 1 on tool errors (bad revision, config parse error, ...).
# We ask it to use this distinct code for "leaks found" so we can tell them apart.
GITLEAKS_LEAK_EXIT=99

config="$(git rev-parse --show-toplevel)/.gitleaks.toml"

# version_ge A B: true if version A >= version B.
version_ge() { [ "$(printf '%s\n%s\n' "$2" "$1" | sort -V | head -n1)" = "$2" ]; }

# require_gitleaks <hook name>: exit unless a new-enough gitleaks is installed.
require_gitleaks() {
  if ! command -v gitleaks >/dev/null 2>&1; then
    echo "$1: gitleaks is not installed, so this is blocked." >&2
    echo "     Install it with: scripts/install-gitleaks.sh" >&2
    exit 1
  fi
  local v
  v="$(gitleaks version 2>/dev/null | sed 's/^v//')"
  if ! version_ge "$v" "$GITLEAKS_MIN_VERSION"; then
    echo "$1: gitleaks ${v:-unknown} is too old (need $GITLEAKS_MIN_VERSION+), so this is blocked." >&2
    echo "     Upgrade it with: scripts/install-gitleaks.sh" >&2
    exit 1
  fi
}

# is_zero_sha SHA: true for git's all-zero object id (SHA-1 or SHA-256).
is_zero_sha() { [[ "$1" =~ ^0+$ ]]; }
