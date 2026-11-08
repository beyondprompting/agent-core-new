import { cache } from "react";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export const canAccessQa = cache(async () => {
  if (process.env.NODE_ENV !== "development") return false;
  const token = await convexAuthNextjsToken();
  if (!token) return false;
  const profile = await fetchQuery(api.data.userAccess.viewerAccessProfile, {}, { token });
  return profile.canAccessQaVisual === true;
});
