// Runs once after every Playwright project (desktop and phone share the
// database). Removes what e2e/daily.spec.ts created: its packs are all named
// pk-e2e-daily-<date>, so real content is never touched. Leaving them behind
// would block a later seed for that day, because a day can't move to another
// pack once its pack has games (review of #119).
import pg from "pg";

export default async function globalTeardown(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) return;
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const packs = "SELECT id FROM packs WHERE id LIKE 'pk-e2e-daily-%'";
    await client.query(`DELETE FROM games WHERE pack_id IN (${packs})`); // game_rounds cascade
    await client.query(`DELETE FROM daily_schedule WHERE pack_id IN (${packs})`);
    await client.query(`DELETE FROM pack_puzzles WHERE pack_id IN (${packs})`);
    await client.query("DELETE FROM packs WHERE id LIKE 'pk-e2e-daily-%'");
  } finally {
    await client.end();
  }
}
