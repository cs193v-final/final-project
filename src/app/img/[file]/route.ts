// GET /img/<id>.webp: one cut puzzle level image (#57). See src/server/images.ts.
import { getDb } from "@/db";
import { imageResponse } from "@/server/images";

export async function GET(_request: Request, ctx: RouteContext<"/img/[file]">): Promise<Response> {
  const { file } = await ctx.params;
  return imageResponse(getDb, file);
}
