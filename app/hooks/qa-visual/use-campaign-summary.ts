import { useEffect } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import {
  summarizeCampaignPieces,
  type CampaignCardData,
} from "@/app/lib/qa-visual/campaign-model";

export function useCampaignSummary(campaign: CampaignCardData) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.qaVisual.campaigns.pieceSummaries,
    { campaignId: campaign._id, snapshotId: campaign.snapshotId },
    { initialNumItems: 50 },
  );
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(50);
  }, [status, loadMore]);
  return status === "Exhausted"
    ? summarizeCampaignPieces(results, campaign.noticeKeys)
    : null;
}
