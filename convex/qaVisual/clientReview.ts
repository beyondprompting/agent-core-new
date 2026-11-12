import { ConvexError, v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import { mutation, query, type QueryCtx } from "../_generated/server";
import { requireCampaign } from "./access";
import { assignedToCampaignClient } from "./clientAccess";
import {
  BRIEF_FIELDS,
  buildClientBrief,
  deliveryBlocker,
  pieceTitle,
} from "./model/clientBrief";
import { structuredRequirements } from "./model/contracts";
import { versionCopy } from "./imageCopies";

/** Internal side of the client review (§23): configuration, delivery rounds and withdrawals. */

async function clientPeople(ctx: QueryCtx, campaign: Doc<"qaVisualCampaigns">) {
  if (!campaign.client) return [];
  const assignments = await ctx.db
    .query("clientUserAssignments")
    .withIndex("by_client", (q) => q.eq("clientId", campaign.client!.clientId))
    .take(500);
  const ids = [
    ...new Set(
      assignments
        .filter((a) => !a.brandId || a.brandId === campaign.client!.brandId)
        .map((a) => a.userId),
    ),
  ];
  const people = await Promise.all(
    ids.map(async (id) => {
      const user = await ctx.db.get(id);
      return user ? { id, name: user.name || user.email || "Usuario", email: user.email ?? "" } : null;
    }),
  );
  return people.filter((p) => p !== null);
}

/** State of the client review for one piece, shown in internal cards and details. */
export async function pieceClientStatus(
  ctx: QueryCtx,
  piece: Pick<Doc<"qaVisualPieces">, "_id" | "currentVersionId">,
) {
  const items = await ctx.db
    .query("qaVisualDeliveryItems")
    .withIndex("by_piece", (q) => q.eq("pieceId", piece._id))
    .order("desc")
    .take(20);
  const item = items.find((i) => i.status !== "withdrawn");
  if (!item) return null;
  const delivery = await ctx.db.get(item.deliveryId);
  const approvedBefore = items.some(
    (i) => i.status !== "withdrawn" && i.clientState === "approved",
  );
  return {
    itemId: item._id,
    state: item.clientState,
    clientVersion: item.clientVersion,
    deliveryNumber: delivery?.number ?? 0,
    at: item.publishedAt,
    pieceVersionId: item.pieceVersionId,
    internalAhead: piece.currentVersionId !== item.pieceVersionId,
    changedAfterApproval:
      approvedBefore && piece.currentVersionId !== item.pieceVersionId,
  };
}

export const settings = query({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const { campaign } = await requireCampaign(ctx, campaignId);
    const client = campaign.client ? await ctx.db.get(campaign.client.clientId) : null;
    const brand = campaign.client?.brandId ? await ctx.db.get(campaign.client.brandId) : null;
    const people = await clientPeople(ctx, campaign);
    const clients = await ctx.db.query("corClients").withIndex("by_name").take(500);
    return {
      enabled: Boolean(campaign.clientReview?.enabled),
      agencyLabel: campaign.clientReview?.agencyLabel ?? "PTO99",
      approverIds: campaign.clientReview?.approverIds ?? [],
      briefFields:
        campaign.clientReview?.briefFields ?? BRIEF_FIELDS.map((f) => f.key),
      availableFields: BRIEF_FIELDS.map((f) => ({ key: f.key, label: f.label })),
      client: client
        ? { id: client._id, name: client.name, brandId: brand?._id, brandName: brand?.name }
        : null,
      people,
      clients: clients.map((c) => ({ id: c._id, name: c.name })),
    };
  },
});

export const brands = query({
  args: { campaignId: v.id("qaVisualCampaigns"), clientId: v.id("corClients") },
  handler: async (ctx, { campaignId, clientId }) => {
    await requireCampaign(ctx, campaignId);
    const rows = await ctx.db
      .query("clientBrands")
      .withIndex("by_client", (q) => q.eq("clientId", clientId))
      .take(200);
    return rows.map((b) => ({ id: b._id, name: b.name }));
  },
});

export const configure = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    clientId: v.id("corClients"),
    brandId: v.optional(v.id("clientBrands")),
    enabled: v.boolean(),
    agencyLabel: v.string(),
    approverIds: v.optional(v.array(v.id("users"))),
    briefFields: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const { campaign } = await requireCampaign(ctx, args.campaignId);
    const briefFields = args.briefFields?.filter((key) =>
      BRIEF_FIELDS.some((f) => f.key === key),
    );
    if (!(await ctx.db.get(args.clientId)))
      throw new ConvexError("Elegí un cliente válido.");
    if (args.brandId) {
      const brand = await ctx.db.get(args.brandId);
      if (brand?.clientId !== args.clientId)
        throw new ConvexError("La marca no pertenece a ese cliente.");
    }
    const agencyLabel = args.agencyLabel.trim().slice(0, 60) || "Agencia";
    const next = { ...campaign, client: { clientId: args.clientId, brandId: args.brandId } };
    const approverIds = [...new Set(args.approverIds ?? [])].slice(0, 20);
    for (const id of approverIds)
      if (!(await assignedToCampaignClient(ctx, id, next)))
        throw new ConvexError("Todas las personas que aprueban deben estar asignadas al cliente.");
    await ctx.db.patch(campaign._id, {
      client: { clientId: args.clientId, ...(args.brandId ? { brandId: args.brandId } : {}) },
      clientReview: {
        enabled: args.enabled,
        agencyLabel,
        ...(approverIds.length ? { approverIds } : {}),
        ...(briefFields ? { briefFields } : {}),
      },
    });
  },
});

/** A duplicate is resolved by a human confirmation; until then the notice stays on the piece. */
function hasUnresolvedDuplicate(
  item: { input: { issues?: { code: string }[] } } | null,
) {
  return Boolean(item?.input.issues?.some((i) => i.code === "file_duplicate_name"));
}

async function currentImportPiece(ctx: QueryCtx, version: Doc<"qaVisualPieceVersions">) {
  return ctx.db.get(version.currentImportPieceId);
}

export const deliveryPreview = query({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const { campaign } = await requireCampaign(ctx, campaignId);
    const pieces = await ctx.db
      .query("qaVisualPieces")
      .withIndex("by_campaign", (q) => q.eq("campaignId", campaign._id).eq("status", "active"))
      .take(1001);
    const last = await ctx.db
      .query("qaVisualDeliveries")
      .withIndex("by_campaign_number", (q) => q.eq("campaignId", campaign._id))
      .order("desc")
      .first();
    const eligible = [];
    const blocked = [];
    for (const piece of pieces) {
      const version = piece.currentVersionId && (await ctx.db.get(piece.currentVersionId));
      if (!version) continue;
      const item = await currentImportPiece(ctx, version);
      const decision = version.currentDecisionId ? await ctx.db.get(version.currentDecisionId) : null;
      const sent = await ctx.db
        .query("qaVisualDeliveryItems")
        .withIndex("by_version", (q) => q.eq("pieceVersionId", version._id))
        .take(10);
      const client = await pieceClientStatus(ctx, piece);
      const title = pieceTitle(version.fileName, item?.input.production);
      const reason = deliveryBlocker({
        pieceStatus: piece.status,
        approved: decision?.decision === "approved",
        alreadySent: sent.some((i) => i.status !== "withdrawn"),
        unresolvedDuplicate: hasUnresolvedDuplicate(item),
      });
      const row = {
        pieceId: piece._id,
        pieceVersionId: version._id,
        title,
        fileName: version.fileName,
        internalVersion: version.number,
        nextClientVersion: (client?.clientVersion ?? 0) + 1,
        previousClientState: client?.state ?? null,
        withException: Boolean(decision?.exception),
        duplicate: Boolean(item?.input.issues?.some((i) => i.code === "file_duplicate_name")),
      };
      if (reason) {
        if (!sent.some((i) => i.status !== "withdrawn")) blocked.push({ ...row, reason });
      } else eligible.push(row);
    }
    return {
      configured: Boolean(campaign.client),
      enabled: Boolean(campaign.clientReview?.enabled),
      nextRound: (last?.number ?? 0) + 1,
      recipients: (await clientPeople(ctx, campaign)).length,
      eligible,
      blocked,
    };
  },
});

export const publishDelivery = mutation({
  args: {
    campaignId: v.id("qaVisualCampaigns"),
    pieceVersionIds: v.array(v.id("qaVisualPieceVersions")),
    message: v.optional(v.string()),
    requestId: v.string(),
  },
  handler: async (ctx, args) => {
    const { user, campaign } = await requireCampaign(ctx, args.campaignId);
    if (!campaign.client || !campaign.clientReview?.enabled)
      throw new ConvexError("Configurá el cliente de la campaña antes de enviar piezas.");
    if (args.requestId.length > 100) throw new ConvexError("Solicitud inválida.");
    const previous = await ctx.db
      .query("qaVisualDeliveries")
      .withIndex("by_request", (q) => q.eq("createdBy", user).eq("requestId", args.requestId))
      .unique();
    if (previous) return previous._id;
    const ids = [...new Set(args.pieceVersionIds)];
    if (!ids.length || ids.length > 1000)
      throw new ConvexError("Elegí entre 1 y 1000 piezas para enviar.");
    const message = args.message?.trim();
    if (message && message.length > 2000)
      throw new ConvexError("El mensaje puede tener hasta 2000 caracteres.");
    const last = await ctx.db
      .query("qaVisualDeliveries")
      .withIndex("by_campaign_number", (q) => q.eq("campaignId", campaign._id))
      .order("desc")
      .first();
    const publishedAt = Date.now();
    const deliveryId = await ctx.db.insert("qaVisualDeliveries", {
      campaignId: campaign._id,
      number: (last?.number ?? 0) + 1,
      status: "published",
      ...(message ? { message } : {}),
      createdBy: user,
      publishedAt,
      itemCount: ids.length,
      requestId: args.requestId,
    });
    for (const id of ids) {
      const version = await ctx.db.get(id);
      const piece = version && (await ctx.db.get(version.pieceId));
      const decision = version?.currentDecisionId ? await ctx.db.get(version.currentDecisionId) : null;
      const sent = version
        ? await ctx.db
            .query("qaVisualDeliveryItems")
            .withIndex("by_version", (q) => q.eq("pieceVersionId", version._id))
            .take(10)
        : [];
      if (
        !version ||
        !piece ||
        piece.campaignId !== campaign._id ||
        piece.currentVersionId !== version._id ||
        deliveryBlocker({
          pieceStatus: piece.status,
          approved: decision?.decision === "approved",
          alreadySent: sent.some((i) => i.status !== "withdrawn"),
          unresolvedDuplicate: hasUnresolvedDuplicate(
            await ctx.db.get(version.currentImportPieceId),
          ),
        })
      )
        throw new ConvexError({
          code: "not_eligible",
          message: `«${version?.fileName ?? "Una pieza"}» ya no se puede enviar. Actualizá la lista y volvé a intentar.`,
        });
      const history = await ctx.db
        .query("qaVisualDeliveryItems")
        .withIndex("by_piece", (q) => q.eq("pieceId", piece._id))
        .order("desc")
        .take(20);
      const latest = history.find((i) => i.status !== "withdrawn");
      if (latest?.status === "active") await ctx.db.patch(latest._id, { status: "superseded" });
      const importPiece = await ctx.db.get(version.currentImportPieceId);
      const copy = await versionCopy(ctx, campaign.reviewKey, version);
      const image = copy?.files?.snapshot;
      await ctx.db.insert("qaVisualDeliveryItems", {
        deliveryId,
        campaignId: campaign._id,
        pieceId: piece._id,
        pieceVersionId: version._id,
        order: importPiece?.order ?? 0,
        clientVersion: (latest?.clientVersion ?? 0) + 1,
        status: "active",
        brief: buildClientBrief({
          fileName: version.fileName,
          requirements: importPiece ? structuredRequirements(importPiece.input) : [],
          production: importPiece?.input.production,
          image,
          requirementsHash: importPiece?.input.requirementsHash,
          allowedFields: campaign.clientReview.briefFields,
        }),
        ...(image ? { image: { width: image.width, height: image.height } } : {}),
        clientState: "sent",
        publishedAt,
      });
    }
    return deliveryId;
  },
});

export const withdrawItem = mutation({
  args: { itemId: v.id("qaVisualDeliveryItems") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item) throw new ConvexError("El envío ya no existe.");
    await requireCampaign(ctx, item.campaignId);
    if (item.status === "withdrawn") return;
    if (item.clientState === "approved" || item.clientState === "changesRequested")
      throw new ConvexError("El cliente ya decidió sobre esta versión; no se puede retirar.");
    await ctx.db.patch(item._id, { status: "withdrawn" });
    if (item.status === "active") {
      const previous = (
        await ctx.db
          .query("qaVisualDeliveryItems")
          .withIndex("by_piece", (q) => q.eq("pieceId", item.pieceId).lt("clientVersion", item.clientVersion))
          .order("desc")
          .take(20)
      ).find((i) => i.status === "superseded");
      if (previous) await ctx.db.patch(previous._id, { status: "active" });
    }
  },
});

export const deliveries = query({
  args: { campaignId: v.id("qaVisualCampaigns") },
  handler: async (ctx, { campaignId }) => {
    const { campaign } = await requireCampaign(ctx, campaignId);
    const rounds = await ctx.db
      .query("qaVisualDeliveries")
      .withIndex("by_campaign_number", (q) => q.eq("campaignId", campaign._id))
      .order("desc")
      .take(50);
    return Promise.all(
      rounds.map(async (round) => {
        const items = await ctx.db
          .query("qaVisualDeliveryItems")
          .withIndex("by_delivery", (q) => q.eq("deliveryId", round._id))
          .take(1001);
        const author = await ctx.db.get(round.createdBy);
        return {
          id: round._id,
          number: round.number,
          publishedAt: round.publishedAt,
          message: round.message,
          author: author?.name || author?.email || "Revisor",
          items: items.length,
          approved: items.filter((i) => i.clientState === "approved").length,
          changes: items.filter((i) => i.clientState === "changesRequested").length,
          withdrawn: items.filter((i) => i.status === "withdrawn").length,
        };
      }),
    );
  },
});

export type PieceClientStatus = NonNullable<Awaited<ReturnType<typeof pieceClientStatus>>>;

/** Withdraws every item of a round that the client has not decided yet. */
export const withdrawRound = mutation({
  args: { deliveryId: v.id("qaVisualDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const round = await ctx.db.get(deliveryId);
    if (!round) throw new ConvexError("La ronda ya no existe.");
    await requireCampaign(ctx, round.campaignId);
    const items = await ctx.db
      .query("qaVisualDeliveryItems")
      .withIndex("by_delivery", (q) => q.eq("deliveryId", deliveryId))
      .take(1001);
    let withdrawn = 0;
    for (const item of items) {
      if (item.status === "withdrawn" || item.clientState === "approved" || item.clientState === "changesRequested")
        continue;
      await ctx.db.patch(item._id, { status: "withdrawn" });
      withdrawn++;
      if (item.status !== "active") continue;
      const previous = (
        await ctx.db
          .query("qaVisualDeliveryItems")
          .withIndex("by_piece", (q) => q.eq("pieceId", item.pieceId).lt("clientVersion", item.clientVersion))
          .order("desc")
          .take(20)
      ).find((i) => i.status === "superseded");
      if (previous) await ctx.db.patch(previous._id, { status: "active" });
    }
    if (withdrawn === items.length) await ctx.db.patch(round._id, { status: "withdrawn" });
    return withdrawn;
  },
});

/** Freezes the brief again with the current order of the same version (§23.4 «Actualizar ficha»). */
export const updateBrief = mutation({
  args: { itemId: v.id("qaVisualDeliveryItems") },
  handler: async (ctx, { itemId }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.status === "withdrawn") throw new ConvexError("El envío ya no existe.");
    const { campaign } = await requireCampaign(ctx, item.campaignId);
    const version = await ctx.db.get(item.pieceVersionId);
    const importPiece = version && (await ctx.db.get(version.currentImportPieceId));
    if (!version || !importPiece) throw new ConvexError("La pieza ya no está disponible.");
    await ctx.db.patch(item._id, {
      brief: buildClientBrief({
        fileName: version.fileName,
        requirements: structuredRequirements(importPiece.input),
        production: importPiece.input.production,
        image: item.image,
        requirementsHash: importPiece.input.requirementsHash,
        allowedFields: campaign.clientReview?.briefFields,
      }),
    });
  },
});
