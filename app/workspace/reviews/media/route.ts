import { proxyQaMedia } from "@/app/lib/qa-visual/server/media-proxy";

// Portal images and voice comments; the Convex HTTP action checks the client's access.
export function GET(request: Request) {
  return proxyQaMedia(request);
}
