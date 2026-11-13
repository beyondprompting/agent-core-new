import { notFound } from "next/navigation";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { preloadQuery, preloadedQueryResult } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { canAccessQa } from "@/app/lib/qa-visual/server/access";
import { CampaignSnapshotViewer } from "@/app/components/qa-visual/campaign/CampaignSnapshotViewer";
import { parseReviewLocation } from "@/app/lib/qa-visual/review-location";

export default async function CampaignEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { campaignId } = await params;
  if (campaignId.length > 128 || !(await canAccessQa())) notFound();
  const token = await convexAuthNextjsToken();
  if (!token) notFound();

  const preloaded = await preloadQuery(api.qaVisual.campaignSnapshots.viewer, { campaignId }, { token });
  if (!preloadedQueryResult(preloaded)) notFound();
  const initialLocation = parseReviewLocation(await searchParams);
  return (
    <CampaignSnapshotViewer
      key={campaignId}
      preloaded={preloaded}
      initialLocation={initialLocation}
    />
  );
}
