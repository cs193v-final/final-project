1. Title and intro
SECRETS.md stores a list of secrets and where to find each one. It never contains real values.

2. The list of secrets and where to find each one
DATABASE_URL: the pooled Postgres connection the app uses. 
- Dev: .env.local. 
- Preview and production: Vercel, each a separate Neon project.

DATABASE_URL_UNPOOLED: the direct connection for migrations. 
- Same places as above.

DATA_ENCRYPTION_KEY: the master key that encrypts usernames and lookups (#129). 
- Dev: .env.local. 
- Preview and production: Vercel, marked Sensitive, a different key for each.

RATE_LIMIT_HMAC_KEY: the key used to scramble visitors' IP addresses before they're
stored for rate limiting
- Preview and production: Vercel, marked Sensitive, a different key for each.

3. How they're stored safely
Secrets stored in .env.local are safe because .gitignore ignores every .env* 
file except .env.example meaning git can't add .env.local and it can't end up 
in a commit.

Sensitive means Vercel stores the value encrypted and never shows it again.
Not in the dashboard, not with vercel env pull, not even to you.
You can only replace or delete it.

Which code is allowed to read them?
Only the server code reads them (things like route handlers, server actions, and server
components. React components in the browsers never read them.

4. Backups. Which password manager, which entry, and who can open it? Why can't agents and
servers reach it? Why does the encryption key need a backup most of all

All backups (database urls, data_encryption_keys, and rate_limit_hmac_keys) are stored in a 
locked notes app file created by Jacky Law.

5. Catching leaks
  - the gitleaks pre-commit hooks (scripts/install-gitleaks.sh, run on every computer);
  - the CI secret scan;

6. Rotating Keys
For the database urls all we need to do is go to the neon console reset the role password
then copy the new urls and update vercel and redeploy. The old password stops working.

For data encryption keys you can't just swap it, because existing usernames become unreadable
and those users get logged out. There's no re-encryption script yet. If it leaks, make a new
key and wipe that tier's accounts

For the rate limiting key all we need to do is make a new key, replace it in Vercel
and redeploy. Rate-limit counts start over, and nothing else breaks.

7. If a real secret leaks
If anything leaks rotate it first, then for the full steps go over the README.txt.
