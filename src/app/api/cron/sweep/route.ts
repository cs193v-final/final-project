// GET /api/cron/sweep: deletes expired sessions and rate-limit rows (#154).
// Called once a day by Vercel Cron (vercel.json) with the CRON_SECRET bearer
// token. Reading the request headers makes this run at request time, never
// prerendered or cached. See src/server/sweep.ts.
import { getDb } from "@/db";
import { sweepResponse } from "@/server/sweep";

export async function GET(request: Request): Promise<Response> {
  return sweepResponse(request.headers.get("authorization"), process.env.CRON_SECRET, getDb, new Date());
}
