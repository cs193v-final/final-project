#!/usr/bin/env bash
# Tests the gitleaks git hooks against synthetic (fake) credentials.
# Runs in a throwaway repo, so it never touches this one. Used by CI and
# safe to run locally:  scripts/test-hooks.sh
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fails=0
pass() { echo "PASS  $1"; }
fail() { echo "FAIL  $1"; fails=$((fails + 1)); }

# A random fake password, so the test can check it never gets printed.
fakepw="Zq8$(head -c8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
# Built in pieces so this source file doesn't itself look like a leaked URL.
scheme="postgres"
fakeurl="${scheme}://fakeuser:${fakepw}@ep-fake-123.us-east-1.aws.neon.tech/neondb"

# Ignore the user's global/system git config (commit.gpgsign, init.templateDir, ...)
# so the throwaway repo behaves the same everywhere.
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

cd "$work" || { echo "cannot enter temp dir; aborting" >&2; exit 1; }
git init -q -b main
git config user.email test@example.com
git config user.name "Hook Test"
cp -r "$root/.githooks" "$root/.gitleaks.toml" "$root/.gitignore" .
git config core.hooksPath .githooks
git add -A && git commit -q --no-verify -m "base"
git update-ref refs/remotes/origin/main HEAD   # pretend main is already pushed

# Each helper prints the hook's output and sets $rc.
# A "blocked" verdict requires the hook's own message, so a hook that merely
# crashes (or isn't executable) can't pass as "blocking".
try_commit() {  # $1 = message, rest = files to stage
  git add -f "${@:2}"
  out="$(git commit -q -m "$1" 2>&1)"; rc=$?
  [[ "$out" == *"$fakepw"* ]] && fail "$1: hook printed the secret"
  if [ $rc -eq 0 ]; then git reset -q --hard HEAD~1; else git reset -q -- "${@:2}"; fi
}
try_push() {  # $1 = remote ref (default main), $2 = remote sha (default origin/main)
  local ref="${1:-refs/heads/main}" rsha="${2:-$(git rev-parse origin/main)}"
  out="$(printf 'refs/heads/x %s %s %s\n' "$(git rev-parse HEAD)" "$ref" "$rsha" \
         | .githooks/pre-push 2>&1)"; rc=$?
  [[ "$out" == *"$fakepw"* ]] && fail "pre-push printed the secret"
}
zero="$(git rev-parse HEAD | tr '0-9a-f' '0')"
blocked() { [ "$rc" -ne 0 ] && [[ "$out" == *"$1 blocked"* ]]; }

# 1. A DB URL with a password in a code file is blocked.
echo "const db = \"$fakeurl\";" > leak.js
try_commit "DB URL in code" leak.js
if blocked Commit && [[ "$out" == *postgres-connection-url* ]]; then pass "DB URL in code is blocked"
else fail "DB URL in code was not blocked (rc=$rc)"; fi
rm -f leak.js

# 2. Any .env file is blocked, even if force-added.
echo "HELLO=world" > .env.test
try_commit ".env file" .env.test
if blocked Commit && [[ "$out" == *env-file* ]]; then pass ".env file is blocked"
else fail ".env file was not blocked (rc=$rc)"; fi
rm -f .env.test

# 3. .env.example with placeholder values is allowed.
echo "DATABASE_URL=postgres://USER:PASSWORD@host/neondb" > .env.example
try_commit ".env.example" .env.example
if [ $rc -eq 0 ]; then pass ".env.example with placeholders is allowed"
else fail ".env.example with placeholders was blocked: $out"; fi
rm -f .env.example

# 4. Pre-push scans every pushed commit, not just the latest.
echo "const db = \"$fakeurl\";" > leak.js && git add leak.js && git commit -q --no-verify -m "secret"
echo clean > clean.txt && git add clean.txt && git commit -q --no-verify -m "clean on top"
try_push
if blocked Push; then pass "pre-push blocks a secret in an older commit"
else fail "pre-push did not block an older secret (rc=$rc)"; fi

# 5. First push of a new branch (all-zero remote sha) scans commits not on any remote.
try_push refs/heads/feature "$zero"
if blocked Push; then pass "pre-push blocks a secret on a new branch"
else fail "pre-push did not block a secret on a new branch (rc=$rc)"; fi

# 6. A remote tip that isn't in the clone is a tool problem, not a secret.
try_push refs/heads/main "$(git rev-parse HEAD | tr '0-9a-f' '1')"
if [ "$rc" -ne 0 ] && [[ "$out" == *"git fetch"* ]] && [[ "$out" != *"possible secret"* ]]; then
  pass "unknown remote sha asks for a fetch instead of reporting a secret"
else fail "unknown remote sha handled wrongly (rc=$rc): $out"; fi

# 7. Pre-push allows a clean push.
git reset -q --hard origin/main
echo ok > ok.txt && git add ok.txt && git commit -q --no-verify -m "clean"
try_push
if [ $rc -eq 0 ]; then pass "pre-push allows clean commits"
else fail "pre-push blocked clean commits: $out"; fi

# 8. Clean first push of a new branch is allowed.
try_push refs/heads/feature "$zero"
if [ $rc -eq 0 ]; then pass "pre-push allows a clean new branch"
else fail "pre-push blocked a clean new branch: $out"; fi

echo
if [ $fails -eq 0 ]; then echo "All hook tests passed."; else echo "$fails hook test(s) failed."; exit 1; fi
