import { canAccessLocalQa } from "@/app/lib/qa-visual/server/access";
import { localQaSource } from "@/app/lib/qa-visual/server/local-source";

export async function GET(request: Request) {
  if (!(await canAccessLocalQa())) return new Response(null, { status: 404 });
  const name = new URL(request.url).searchParams.get("name");
  const root = process.env.QA_VISUAL_LOCAL_ROOT;
  const image = root && name ? await localQaSource(root).readPiece(name) : null;
  if (!image) return new Response(null, { status: 404 });
  return new Response(image.bytes, {
    headers: { "Content-Type": image.mime, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
