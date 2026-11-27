// POST /api/lobby-uploads: one photo for a custom lobby (#67). The body is the
// photo's bytes. Login required, same origin only, rate-limited, at most 4 MB
// (Vercel's request limit is 4.5 MB), re-encoded with no metadata, stored
// encrypted. See uploadLobbyPhoto in src/server/lobbies.ts.
import { uploadLobbyPhoto } from "@/server/lobbies";

export async function POST(request: Request): Promise<Response> {
  return uploadLobbyPhoto(request);
}
