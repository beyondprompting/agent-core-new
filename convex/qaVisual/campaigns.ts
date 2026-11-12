import { ConvexError, v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { internalMutation, internalQuery, query } from "../_generated/server";
import { queueSync, syncIsRunning } from "./campaignSnapshots";
import { requireCampaign, requireQaAdmin } from "./access";
import { isCurrentReview } from "./model/verdict";

const sourceSelection = v.object({
  excelFileId: v.optional(v.string()),
  csvFileId: v.optional(v.string()),
});
const campaignStatus = v.union(v.literal("active"), v.literal("archived"));

/** Lightweight, paginated cards. Piece totals have independent subscriptions. */
export const list = query({
  args: { status: campaignStatus, paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireQaAdmin(ctx);
    const result = await ctx.db
      .query("qaVisualCampaigns")
      .withIndex("by_status", (q) => q.eq("status", args.status))
      .order("desc")
      .paginate(args.paginationOpts);
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (campaign) => {
          const syncing =
            campaign.status === "active" &&
            (await syncIsRunning(ctx, campaign.sync));
          const syncError =
            campaign.syncError ??
            (campaign.sync && !syncing && campaign.status === "active"
              ? "Se interrumpió la importación de Drive. Intentá actualizar de nuevo."
              : undefined);
          const snapshot = campaign.currentSnapshotId
            ? await ctx.db.get(campaign.currentSnapshotId)
            : null;
          const activeRuns =
            campaign.status === "active"
              ? await Promise.all(
                  (["preparing", "running"] as const).map((state) =>
                    ctx.db
                      .query("qaVisualRuns")
                      .withIndex("by_campaign_state", (q) =>
                        q.eq("campaign", campaign.reviewKey).eq("state", state),
                      )
                      .first(),
                  ),
                )
              : [];
          return {
            _id: campaign._id,
            name: campaign.name,
            status: campaign.status,
            createdAt: campaign._creationTime,
            lastSyncedAt: campaign.lastSyncedAt,
            imported: Boolean(campaign.currentSnapshotId),
            syncing,
            syncError,
            snapshotId: campaign.currentSnapshotId,
            needsSources:
              campaign.syncNeedsSources ??
              Boolean(syncError?.includes("Elegir fuentes")),
            importStage: syncing ? (campaign.sync?.stage ?? "listing") : null,
            importImages: syncing ? campaign.sync?.images : undefined,
            sourceSelection: campaign.sourceSelection ?? {},
            folderUrl: `https://drive.google.com/drive/folders/${campaign.driveFolderId}`,
            noticeKeys: (snapshot?.notices ?? []).map(
              (message) => `campaign:${message}`,
            ),
            analyzing: activeRuns.some(Boolean),
          };
        }),
      ),
    };
  },
});

export const counts = query({
  args: {},
  handler: async (ctx) => {
    await requireQaAdmin(ctx);
    const count = async (status: "active" | "archived") => {
      const rows = await ctx.db
        .query("qaVisualCampaigns")
        .withIndex("by_status", (q) => q.eq("status", status))
        .take(1001);
      return { value: Math.min(rows.length, 1000), more: rows.length > 1000 };
    };
    return { active: await count("active"), archived: await count("archived") };
  },
});

/** Small pages keep full review/input documents out of the campaign-list response. */
export const pieceSummaries = query({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    snapshotId: v.optional(v.id("qaVisualCampaignSnapshots")),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { campaignId, paginationOpts }) => {
    await requireQaAdmin(ctx);
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) throw new ConvexError("La campaña ya no está disponible.");
    const result = await ctx.db
      .query("qaVisualPieces")
      .withIndex("by_campaign", (q) =>
        q.eq("campaignId", campaignId).eq("status", "active"),
      )
      .paginate({
        ...paginationOpts,
        numItems: Math.min(paginationOpts.numItems, 50),
      });
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (piece) => {
          const version = piece.currentVersionId
            ? await ctx.db.get(piece.currentVersionId)
            : null;
          const input = piece.currentImportPieceId
            ? await ctx.db.get(piece.currentImportPieceId)
            : null;
          const decision = version?.currentDecisionId
            ? await ctx.db.get(version.currentDecisionId)
            : null;
          const review = version
            ? await ctx.db
                .query("qaVisualReviews")
                .withIndex("by_version", (q) =>
                  q.eq("pieceVersionId", version._id),
                )
                .order("desc")
                .first()
            : null;
          const current =
            review &&
            version &&
            isCurrentReview(review.input, version.currentInputHash);
          return {
            id: piece._id,
            approved:
              decision?.decision === "approved" &&
              decision.aiSeen.inputHash === version?.currentInputHash,
            verdict:
              current && review.status === "completed"
                ? (review.verdict ?? null)
                : null,
            failed: Boolean(current && review.status === "failed"),
            issueKeys: (input?.input.issues ?? []).map((issue) =>
              issue.scope === "campaign"
                ? `campaign:${issue.message}`
                : `${piece._id}:${issue.id}`,
            ),
          };
        }),
      ),
    };
  },
});

/** The service account e-mail is not secret: people need it to share the folder. */
export const serviceAccount = query({
  args: {},
  handler: async (ctx) => {
    await requireQaAdmin(ctx);
    try {
      const account = JSON.parse(
        process.env.QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON ?? "",
      ) as { client_email?: unknown };
      return typeof account.client_email === "string"
        ? account.client_email
        : null;
    } catch {
      return null;
    }
  },
});

export const getActive = internalQuery({
  args: { campaignId: v.string() },
  handler: async (ctx, { campaignId }) => {
    await requireQaAdmin(ctx);
    const id = ctx.db.normalizeId("qaVisualCampaigns", campaignId);
    if (!id) return null;
    const campaign = await ctx.db.get(id);
    return campaign?.status === "active" ? campaign : null;
  },
});

export const register = internalMutation({
  args: {
    name: v.string(),
    driveFolderId: v.string(),
    reviewKey: v.string(),
    sourceSelection: v.optional(sourceSelection),
  },
  handler: async (ctx, args) => {
    const createdBy = await requireQaAdmin(ctx);
    const existing = await ctx.db
      .query("qaVisualCampaigns")
      .withIndex("by_drive_folder", (q) =>
        q.eq("driveFolderId", args.driveFolderId),
      )
      .unique();
    if (existing)
      return {
        status:
          existing.status === "active"
            ? ("existing" as const)
            : ("archived" as const),
        campaignId: existing._id,
      };

    const campaignId = await ctx.db.insert("qaVisualCampaigns", {
      ...args,
      status: "active",
      createdBy,
    });
    await queueSync(ctx, campaignId);
    return { status: "created" as const, campaignId };
  },
});

export const setSources = internalMutation({
  args: { campaignId: v.id("qaVisualCampaigns"), sourceSelection },
  handler: async (ctx, { campaignId, sourceSelection }) => {
    const { campaign } = await requireCampaign(ctx, campaignId);
    if (await syncIsRunning(ctx, campaign.sync))
      throw new ConvexError(
        "Esperá a que termine la importación antes de cambiar las fuentes.",
      );
    await ctx.db.patch(campaignId, { sourceSelection });
    await queueSync(ctx, campaignId);
  },
});
