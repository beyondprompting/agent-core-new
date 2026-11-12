import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { qaVisualEnabled } from "./enabled";

/**
 * Forwards an authenticated media request to the Convex HTTP action. The session token lives
 * in an httpOnly cookie, so images and audio go through this route instead of a public URL.
 * Immutable responses keep their cache headers and ETag so a second visit downloads nothing.
 */
export async function proxyQaMedia(request: Request) {
  if (!qaVisualEnabled()) return new Response(null, { status: 404 });
  const token = await convexAuthNextjsToken();
  if (!token) return new Response(null, { status: 404 });
  try {
    const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    const url = new URL("/qa-visual/media", site || process.env.NEXT_PUBLIC_CONVEX_URL);
    if (!site) {
      if (!url.hostname.endsWith(".convex.cloud"))
        return new Response(null, { status: 503 });
      url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    }
    url.search = new URL(request.url).search;
    const forward: Record<string, string> = { Authorization: `Bearer ${token}` };
    const etag = request.headers.get("If-None-Match");
    if (etag) forward["If-None-Match"] = etag;
    const range = request.headers.get("Range");
    if (range) forward.Range = range;
    const upstream = await fetch(url, { headers: forward, cache: "no-store" });
    const cacheable = upstream.headers.get("Cache-Control")?.includes("immutable");
    const headers: Record<string, string> = {
      "Content-Type": upstream.headers.get("Content-Type") ?? "application/octet-stream",
      "Cache-Control": cacheable ? "private, max-age=31536000, immutable" : "private, no-store",
      "X-Content-Type-Options": "nosniff",
    };
    const tag = upstream.headers.get("ETag");
    if (tag) headers.ETag = tag;
    return new Response(upstream.ok ? upstream.body : null, {
      status: upstream.status,
      headers,
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
