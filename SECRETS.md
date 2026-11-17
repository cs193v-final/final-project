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

All backups (database urls, data_encryption_keys, and passwords) are stored in a 
locked notes app file created by Jacky Law.

5. Catching leaks
  - the gitleaks pre-commit hooks (scripts/install-gitleaks.sh, run on every computer);
  - the CI secret scan;
