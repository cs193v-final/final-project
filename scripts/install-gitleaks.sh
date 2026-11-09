#!/usr/bin/env bash
# Install gitleaks (if missing or too old) and turn on this repo's git hooks.
# Safe to run repeatedly. Run from anywhere inside the repo.
#
#   GITLEAKS_VERSION=8.30.1 scripts/install-gitleaks.sh   # install an exact version (CI does this)
#   GITHUB_TOKEN=...        avoids the 60 req/hour GitHub API limit when looking up "latest"
set -euo pipefail

root="$(git rev-parse --show-toplevel)"
# shellcheck source=.githooks/_common.sh
. "$root/.githooks/_common.sh"

installed=""
if command -v gitleaks >/dev/null 2>&1; then
  installed="$(gitleaks version 2>/dev/null | sed 's/^v//')"
fi

if [ -n "${GITLEAKS_VERSION:-}" ]; then
  [ "$installed" = "$GITLEAKS_VERSION" ] && need=no || need=yes
elif [ -n "$installed" ] && version_ge "$installed" "$GITLEAKS_MIN_VERSION"; then
  need=no
else
  need=yes
  [ -n "$installed" ] && echo "gitleaks $installed is older than $GITLEAKS_MIN_VERSION; upgrading."
fi

sha256() {  # print the sha256 of a file; Linux has sha256sum, macOS has shasum
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | awk '{print $1}'
  else echo "Neither sha256sum nor shasum found; can't verify the download." >&2; return 1
  fi
}

if [ "$need" = no ]; then
  echo "gitleaks already installed: $installed"
elif [ -z "${GITLEAKS_VERSION:-}" ] && [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
  if [ -n "$installed" ]; then brew upgrade gitleaks; else brew install gitleaks; fi
else
  case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "Unsupported CPU: $(uname -m). Install gitleaks manually." >&2; exit 1 ;;
  esac
  os=$(uname -s | tr '[:upper:]' '[:lower:]')

  version=${GITLEAKS_VERSION:-}
  if [ -z "$version" ]; then
    auth=()
    [ -n "${GITHUB_TOKEN:-}" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
    version=$(curl -fsSL "${auth[@]}" https://api.github.com/repos/gitleaks/gitleaks/releases/latest \
              | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p') || true
    if [ -z "$version" ]; then
      echo "Couldn't look up the latest gitleaks release (GitHub API rate limit?)." >&2
      echo "Retry later, set GITHUB_TOKEN, or pin one: GITLEAKS_VERSION=8.30.1 $0" >&2
      exit 1
    fi
  fi

  file="gitleaks_${version}_${os}_${arch}.tar.gz"
  base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
  tmp=$(mktemp -d)
  trap 'rm -rf "$tmp"' EXIT

  curl -fsSL -o "$tmp/$file" "$base/$file"
  curl -fsSL -o "$tmp/checksums.txt" "$base/gitleaks_${version}_checksums.txt"
  expected=$(awk -v f="$file" '$2==f {print $1}' "$tmp/checksums.txt")
  if [ -z "$expected" ]; then
    echo "No checksum entry for $file in the v$version release; not installing." >&2
    exit 1
  fi
  actual=$(sha256 "$tmp/$file")
  if [ "$actual" != "$expected" ]; then
    echo "gitleaks checksum mismatch for $file (expected $expected, got $actual); not installing." >&2
    exit 1
  fi

  tar xzf "$tmp/$file" -C "$tmp" gitleaks
  sudo mkdir -p /usr/local/bin       # missing on Apple Silicon Macs without Homebrew
  sudo install "$tmp/gitleaks" /usr/local/bin/gitleaks
  echo "Installed gitleaks $(/usr/local/bin/gitleaks version)"
fi

git -C "$root" config core.hooksPath .githooks
echo "Git hooks enabled (core.hooksPath = .githooks)."
