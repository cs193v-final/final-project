#!/usr/bin/env bash
# Tests the gitleaks git hooks against synthetic (fake) credentials.
# Runs in a throwaway repo, so it never touches this one. Used by CI and
# safe to run locally:  scripts/test-hooks.sh
set -uo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
# A second folder, outside any repo, for the prepare-script cases (21-27).
pwork="$(mktemp -d)"
trap 'rm -rf "$work" "$pwork"' EXIT

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

# 9-13. A bare Neon password (npg_...) is blocked even outside a connection URL,
# including glued to other text: after a "\n" escape (env lines joined into one
# string, so the letter n sits right before npg_) and followed by "_old".
# Built at runtime so this file holds no npg_ token of its own.
fakenpg="npg_${fakepw}"
printf '{ "host": "ep-fake-123.neon.tech", "password": "%s" }\n' "$fakenpg" > creds.json
printf 'const pw = "%s";\n' "$fakenpg" > pw.ts
printf 'DATABASE_URL=%s://fakeuser@ep-fake-123.neon.tech/neondb\nDB_PASSWORD=%s\n' \
  "$scheme" "$fakenpg" > config.sh
printf 'const env = "PGHOST=ep-fake-123.neon.tech\\n%s";\n' "$fakenpg" > joined.ts
printf 'DB_PASSWORD_PREVIOUS=%s_old\n' "$fakenpg" > rotated.sh
for f in creds.json pw.ts config.sh joined.ts rotated.sh; do
  try_commit "Neon password in $f" "$f"
  if blocked Commit && [[ "$out" == *neon-password* ]]; then pass "Neon password in $f is blocked"
  else fail "Neon password in $f was not blocked (rc=$rc): $out"; fi
  rm -f "$f"
done

# 14. A full Neon URL is reported by both rules: postgres-connection-url for the
# URL and neon-password for its password. Both fingerprints go in .gitleaksignore
# (README). Checked by rule id, not by counting gitleaks' output labels.
echo "const db = \"${scheme}ql://fakeuser:${fakenpg}@ep-fake-123.us-east-1.aws.neon.tech/neondb\";" > neonurl.js
try_commit "full Neon URL" neonurl.js
if blocked Commit && [[ "$out" == *postgres-connection-url* ]] && [[ "$out" == *neon-password* ]]; then
  pass "a full Neon URL is reported by both rules"
else fail "a full Neon URL wasn't reported by both postgres-connection-url and neon-password (rc=$rc): $out"; fi
rm -f neonurl.js

# 15. Docs that only mention the prefix are allowed.
printf 'Neon passwords start with "npg_", like npg_... or npg_\xe2\x80\xa6 (never commit one).\n' > neon.md
try_commit "npg_ prefix in docs" neon.md
if [ $rc -eq 0 ]; then pass "the bare npg_ prefix in docs is allowed"
else fail "the bare npg_ prefix in docs was blocked: $out"; fi
rm -f neon.md

# 16. Placeholder passwords (npg_xxxx..., npg_XXXX...) are allowed, alone or in a URL.
x12="xxxxxxxxxxxx"
{ echo "DB_PASSWORD=npg_${x12}"
  echo "DB_PASSWORD=npg_XXXXXXXX"
  echo "DATABASE_URL=${scheme}ql://neondb_owner:npg_${x12}@ep-example.neon.tech/neondb"
} > placeholders.md
try_commit "npg_ placeholders in docs" placeholders.md
if [ $rc -eq 0 ]; then pass "npg_ placeholders are allowed"
else fail "npg_ placeholders were blocked: $out"; fi
rm -f placeholders.md

# 17. Pre-push catches a Neon password in an older commit, like case 4.
git reset -q --hard origin/main
printf 'const pw = "%s";\n' "$fakenpg" > pw.ts && git add pw.ts && git commit -q --no-verify -m "npg secret"
echo clean > clean.txt && git add clean.txt && git commit -q --no-verify -m "clean on top"
try_push
if blocked Push && [[ "$out" == *neon-password* ]]; then pass "pre-push blocks a Neon password in an older commit"
else fail "pre-push did not block a Neon password (rc=$rc): $out"; fi
git reset -q --hard origin/main

# 18. A second password on the same line as a full URL is reported on its own,
# not hidden behind the URL's finding (two neon-password findings).
fakenpg2="npg_Wk3$(head -c8 /dev/urandom | od -An -tx1 | tr -d ' \n')"
echo "{\"url\":\"${scheme}ql://fakeuser:${fakenpg}@ep-fake-123.neon.tech/db\",\"old\":\"${fakenpg2}\"}" > twopw.json
try_commit "URL and a second password" twopw.json
nneon="$(grep -o 'neon-password' <<<"$out" | wc -l)"
if blocked Commit && [ "$nneon" -ge 2 ]; then pass "a second password next to a URL is reported"
else fail "a second password next to a URL wasn't reported ($nneon neon-password findings, rc=$rc): $out"; fi
rm -f twopw.json

# 19. A real password on the same line as a placeholder URL is still blocked.
echo "DATABASE_URL=${scheme}://fakeuser:npg_${x12}@ep-example.neon.tech/db PGPASS=${fakenpg}" > mixed.md
try_commit "placeholder URL and a real password" mixed.md
if blocked Commit && [[ "$out" == *neon-password* ]]; then pass "a real password next to a placeholder URL is blocked"
else fail "a real password next to a placeholder URL was not blocked (rc=$rc): $out"; fi
rm -f mixed.md

# 20. Names and examples that only contain npg_ aren't passwords.
{ echo 'const npg_password = process.env.NPG;'
  echo 'NEON_PASSWORD=npg_yourpassword'
  echo 'x = "npg_example1"; y = "npg_REDACTED"; setup_npg_connection();'
} > names.ts
try_commit "npg_ names and examples" names.ts
if [ $rc -eq 0 ]; then pass "npg_ names and examples are allowed"
else fail "npg_ names and examples were blocked: $out"; fi
rm -f names.ts

# 21-27. scripts/enable-hooks.sh (the npm `prepare` script, #88) turns the hooks
# on in a clone and never fails an install. Each case runs a copy of it in its
# own folder. CI and VERCEL are cleared unless a case sets them, since CI sets CI.
prep() {  # $1 = folder holding scripts/enable-hooks.sh; rest = env assignments
  local dir="$1"; shift
  out="$(cd "$dir" && env -u CI -u VERCEL "$@" "$BASH" scripts/enable-hooks.sh 2>&1)"; rc=$?
}
newrepo() {  # $1 = folder: a fresh git repo with a copy of the script
  mkdir -p "$1/scripts" && cp "$root/scripts/enable-hooks.sh" "$1/scripts/"
  git -C "$1" init -q -b main
}
hookspath() { git -C "$1" config --get core.hooksPath; }
# git must not find a repo above $pwork (if the temp folder sits inside one).
export GIT_CEILING_DIRECTORIES="${pwork%/*}"
# A PATH with git but no gitleaks, and one with neither.
nogl="$pwork/bin-nogl" nogit="$pwork/bin-nogit"
mkdir -p "$nogl" "$nogit"
ln -s "$(command -v git)" "$nogl/git"
for b in dirname env; do ln -s "$(command -v "$b")" "$nogl/$b"; ln -s "$(command -v "$b")" "$nogit/$b"; done

# 21. Sets core.hooksPath in a fresh clone, then is quiet on a rerun.
newrepo "$pwork/p-repo"
prep "$pwork/p-repo"
if [ $rc -eq 0 ] && [ "$(hookspath "$pwork/p-repo")" = .githooks ]; then pass "prepare sets core.hooksPath in a clone"
else fail "prepare didn't set core.hooksPath (rc=$rc): $out"; fi
prep "$pwork/p-repo"
if [ $rc -eq 0 ] && [[ "$out" != *"hooks enabled"* ]]; then pass "prepare is a quiet no-op when hooks are already on"
else fail "prepare rerun wasn't a quiet no-op (rc=$rc): $out"; fi

# 22. Outside a git repo (a tarball, Vercel's build folder): exits 0, creates nothing.
mkdir -p "$pwork/p-plain/scripts" && cp "$root/scripts/enable-hooks.sh" "$pwork/p-plain/scripts/"
prep "$pwork/p-plain"
if [ $rc -eq 0 ] && [ -z "$out" ] && [ ! -e "$pwork/p-plain/.git" ]; then pass "prepare is a silent no-op outside a git repo"
else fail "prepare outside a git repo (rc=$rc): $out"; fi

# 23. A copy inside another repo's subfolder doesn't touch that repo.
newrepo "$pwork/p-outer" && mkdir -p "$pwork/p-outer/sub/scripts"
cp "$root/scripts/enable-hooks.sh" "$pwork/p-outer/sub/scripts/"
prep "$pwork/p-outer/sub"
if [ $rc -eq 0 ] && [ -z "$(hookspath "$pwork/p-outer")" ]; then pass "prepare leaves an enclosing repo alone"
else fail "prepare changed an enclosing repo (rc=$rc): $out"; fi

# 24-25. CI and Vercel builds: exit 0 and change nothing.
for var in CI VERCEL; do
  newrepo "$pwork/p-$var"
  prep "$pwork/p-$var" "$var=1"
  if [ $rc -eq 0 ] && [ -z "$out" ] && [ -z "$(hookspath "$pwork/p-$var")" ]; then pass "prepare does nothing when $var is set"
  else fail "prepare with $var set (rc=$rc): $out"; fi
done

# 26. gitleaks missing: still sets the hooks and exits 0, with a warning.
newrepo "$pwork/p-nogl"
prep "$pwork/p-nogl" PATH="$nogl"
if [ $rc -eq 0 ] && [ "$(hookspath "$pwork/p-nogl")" = .githooks ] && [[ "$out" == *"gitleaks is not installed"* ]]; then
  pass "prepare warns but exits 0 when gitleaks is missing"
else fail "prepare without gitleaks (rc=$rc): $out"; fi

# 27. git missing: exits 0 silently.
newrepo "$pwork/p-nogit"
prep "$pwork/p-nogit" PATH="$nogit"
if [ $rc -eq 0 ] && [ -z "$out" ]; then pass "prepare is a silent no-op when git is missing"
else fail "prepare without git (rc=$rc): $out"; fi

echo
if [ $fails -eq 0 ]; then echo "All hook tests passed."; else echo "$fails hook test(s) failed."; exit 1; fi
