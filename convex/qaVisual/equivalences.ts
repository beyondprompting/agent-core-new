import { ConvexError, v } from "convex/values";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { requireCampaign, requireQaAdmin } from "./access";
import { queueSync, syncIsRunning } from "./campaignSnapshots";
import type { LinkOverride } from "./model/contracts";
import { equivalenceKey, IDENTITY_COLUMNS } from "./model/mapping";

/**
 * Equivalences between the CSV and the client's matrix (§5.5). When an identity column of the
 * CSV and of the matrix say the same with other words («BANNER HOR» and «Banner»), the team
 * may approve it for one campaign or for every campaign of the client instead of changing
 * the CSV. They are the only equivalences the linker knows: there are none in the code.
 */
const MAX = 500;
export const equivalence = v.object({
  column: v.string(),
  csvValue: v.string(),
  matrixValue: v.string(),
});

async function active(ctx: QueryCtx, campaign: Doc<"qaVisualCampaigns">) {
  const own = await ctx.db
    .query("qaVisualEquivalences")
    .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id))
    .take(MAX);
  const clientId = campaign.client?.clientId;
  const shared = clientId
    ? await ctx.db
        .query("qaVisualEquivalences")
        .withIndex("by_client", (q) => q.eq("clientId", clientId))
        .take(MAX)
    : [];
  const rows = new Map<
    Id<"qaVisualEquivalences">,
    Doc<"qaVisualEquivalences">
  >();
  for (const row of [...own, ...shared])
    if (
      !row.revokedAt &&
      (row.scope === "client" ? row.clientId === clientId : true)
    )
      rows.set(row._id, row);
  // A campaign-scoped row of another campaign never applies (by_client only finds client rows).
  return [...rows.values()].filter(
    (row) => row.scope === "client" || row.campaignId === campaign._id,
  );
}

/** Equivalences that apply to a campaign, as link overrides of the import and the check. */
export const forCampaign = internalQuery({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }): Promise<LinkOverride[]> => {
    const campaign = await ctx.db.get(campaignId);
    if (!campaign) return [];
    return (await active(ctx, campaign)).map((row) => ({
      kind: "matrixEquivalence",
      column: row.column,
      from: row.csvValue,
      to: row.matrixValue,
      author: String(row.createdBy),
      at: row._creationTime,
    }));
  },
});

export const list = query({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const { campaign } = await requireCampaign(ctx, campaignId);
    return {
      canShare: Boolean(campaign.client?.clientId),
      items: (await active(ctx, campaign)).map((row) => ({
        id: row._id,
        scope: row.scope,
        column: row.column,
        csvValue: row.csvValue,
        matrixValue: row.matrixValue,
        piece: row.piece,
        at: row._creationTime,
        fromOtherCampaign: row.campaignId !== campaign._id,
      })),
    };
  },
});

/** Saves equivalences already verified by `approveEquivalence` and imports again. */
export const record = internalMutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    scope: v.union(v.literal("campaign"), v.literal("client")),
    piece: v.string(),
    items: v.array(equivalence),
  },
  handler: async (ctx, { campaignId, scope, piece, items }) => {
    const user = await requireQaAdmin(ctx);
    const campaign = await ctx.db.get(campaignId);
    if (!campaign || campaign.status !== "active")
      throw new ConvexError("La campaña ya no está disponible.");
    const clientId = campaign.client?.clientId;
    if (scope === "client" && !clientId)
      throw new ConvexError(
        "La campaña no tiene un cliente asignado: aprobá la equivalencia solo para esta campaña.",
      );
    const columns = new Set<string>(IDENTITY_COLUMNS.map(([name]) => name));
    if (!items.length || items.some((item) => !columns.has(item.column)))
      throw new ConvexError("La equivalencia no es válida.");
    const current = await active(ctx, campaign);
    if (current.length + items.length > MAX)
      throw new ConvexError(`Se pueden aprobar hasta ${MAX} equivalencias.`);
    const known = new Set(
      current
        .filter((row) => scope === "campaign" || row.scope === "client")
        .map((row) => row.key),
    );
    let added = 0;
    for (const item of items) {
      const key = equivalenceKey(item as Parameters<typeof equivalenceKey>[0]);
      if (known.has(key)) continue;
      known.add(key);
      await ctx.db.insert("qaVisualEquivalences", {
        scope,
        campaignId,
        ...(scope === "client" ? { clientId } : {}),
        column: item.column,
        csvValue: item.csvValue.trim(),
        matrixValue: item.matrixValue.trim(),
        key,
        piece,
        createdBy: user,
      });
      added++;
    }
    if (
      added &&
      !campaign.activeImportId &&
      !(await syncIsRunning(ctx, campaign.sync))
    )
      await queueSync(ctx, campaignId, true, user);
    return { added };
  },
});

export const revoke = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    equivalenceId: v.id("qaVisualEquivalences"),
  },
  handler: async (ctx, { campaignId, equivalenceId }) => {
    const { user, campaign } = await requireCampaign(ctx, campaignId);
    const row = await ctx.db.get(equivalenceId);
    if (
      !row ||
      row.revokedAt ||
      !(await active(ctx, campaign)).some((r) => r._id === row._id)
    )
      throw new ConvexError("La equivalencia ya no está vigente.");
    if (campaign.activeImportId || (await syncIsRunning(ctx, campaign.sync)))
      throw new ConvexError(
        "Esperá a que termine la actualización antes de quitar la equivalencia.",
      );
    await ctx.db.patch(row._id, { revokedAt: Date.now(), revokedBy: user });
    await queueSync(ctx, campaignId, true, user);
  },
});
