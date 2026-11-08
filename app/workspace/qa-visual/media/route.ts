import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";

export async function GET(request: Request) {
  if (process.env.NODE_ENV !== "development") return new Response(null, { status: 404 });
  const token = await convexAuthNextjsToken();
  if (!token) return new Response(null, { status: 404 });

  try {
    const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
    const url = new URL("/qa-visual/media", site || process.env.NEXT_PUBLIC_CONVEX_URL);
    if (!site) {
      if (!url.hostname.endsWith(".convex.cloud")) return new Response(null, { status: 503 });
      url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    }
    url.search = new URL(request.url).search;
    const image = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    return new Response(image.ok ? image.body : null, {
      status: image.status,
      headers: {
        "Content-Type": image.headers.get("Content-Type") ?? "application/octet-stream",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response(null, { status: 502 });
  }
}
