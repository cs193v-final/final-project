// Runs once after every Playwright project (desktop and phone share the
// database). Removes what e2e/daily.spec.ts and e2e/stanford.spec.ts created:
// their packs are all named pk-e2e-daily-<date> or pk-e2e-stanford, so real
// content is never touched. Leaving a daily one behind would block a later
// seed for that day, because a day can't move to another pack once its pack
// has games (review of #119). Leaving the Stanford one behind would make
// Stanford mode play it instead of a real pack seeded before it (#65).
import pg from "pg";

export default async function globalTeardown(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const ours = "id LIKE 'pk-e2e-daily-%' OR id = 'pk-e2e-stanford'";
    const packs = `SELECT id FROM packs WHERE ${ours}`;
    await client.query(`DELETE FROM games WHERE pack_id IN (${packs})`); // game_rounds cascade
    await client.query(`DELETE FROM daily_schedule WHERE pack_id IN (${packs})`);
    await client.query(`DELETE FROM pack_puzzles WHERE pack_id IN (${packs})`);
    await client.query(`DELETE FROM packs WHERE ${ours}`);
  } finally {
    await client.end();
  }
}
