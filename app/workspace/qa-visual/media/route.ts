import { proxyQaMedia } from "@/app/lib/qa-visual/server/media-proxy";

export function GET(request: Request) {
  return proxyQaMedia(request);
}
