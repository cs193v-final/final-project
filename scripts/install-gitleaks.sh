#!/usr/bin/env bash
# Install gitleaks (if missing) and turn on this repo's git hooks.
# Safe to run repeatedly. Run from anywhere inside the repo.
set -euo pipefail

if command -v gitleaks >/dev/null 2>&1; then
  echo "gitleaks already installed: $(gitleaks version)"
elif [ "$(uname -s)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
  brew install gitleaks
else
  case "$(uname -m)" in
    x86_64|amd64)  arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) echo "Unsupported CPU: $(uname -m). Install gitleaks manually." >&2; exit 1 ;;
  esac
  os=$(uname -s | tr '[:upper:]' '[:lower:]')
  # CI pins GITLEAKS_VERSION; otherwise use the latest release.
  version=${GITLEAKS_VERSION:-$(curl -fsSL https://api.github.com/repos/gitleaks/gitleaks/releases/latest \
            | sed -n 's/.*"tag_name": *"v\([^"]*\)".*/\1/p')}
  file="gitleaks_${version}_${os}_${arch}.tar.gz"
  base="https://github.com/gitleaks/gitleaks/releases/download/v${version}"
  tmp=$(mktemp -d)
  curl -fsSL -o "$tmp/$file" "$base/$file"
  curl -fsSL -o "$tmp/checksums.txt" "$base/gitleaks_${version}_checksums.txt"
  (cd "$tmp" && grep " $file\$" checksums.txt | sha256sum -c --quiet -) \
    || { echo "gitleaks checksum mismatch; not installing." >&2; exit 1; }
  tar xzf "$tmp/$file" -C "$tmp" gitleaks
  sudo install "$tmp/gitleaks" /usr/local/bin/gitleaks
  rm -rf "$tmp"
  echo "Installed gitleaks $(/usr/local/bin/gitleaks version)"
fi

git config core.hooksPath .githooks
echo "Git hooks enabled (core.hooksPath = .githooks)."
