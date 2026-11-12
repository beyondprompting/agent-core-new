import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import { internalQuery, mutation, query, type QueryCtx } from "../_generated/server";
import { attachAudio, audioArg, claimAudio } from "./audio";
import {
  assignedToCampaignClient,
  portalAuthor,
  portalViewer,
  requireClientCampaign,
  requireClientItem,
  requireClientWriter,
} from "./clientAccess";
import { anchor, validateAnchor } from "./model/collaboration";
import { imageVariant, variantStorage, versionCopy } from "./imageCopies";

/**
 * Client portal (§23.6). Every function reads only delivered items, client threads and
 * client-visible comments, and declares its return shape so internal data cannot leak.
 */

const clientState = v.union(
  v.literal("sent"),
  v.literal("viewed"),
  v.literal("changesRequested"),
  v.literal("approved"),
);
const mode = v.union(v.literal("client"), v.literal("preview"));
const counts = v.object({
  total: v.number(),
  approved: v.number(),
  changes: v.number(),
  pending: v.number(),
});
const transcript = v.union(
  v.null(),
  v.object({
    status: v.union(v.literal("pending"), v.literal("done"), v.literal("failed")),
    text: v.optional(v.string()),
  }),
);
const portalComment = v.object({
  id: v.id("qaVisualComments"),
  body: v.string(),
  author: v.string(),
  authorKind: v.union(v.literal("client"), v.literal("agency")),
  at: v.number(),
  audio: v.union(v.null(), v.object({ durationMs: v.number() })),
  transcript,
  canDelete: v.boolean(),
});
const portalThread = v.object({
  id: v.id("qaVisualThreads"),
  anchor,
  resolved: v.boolean(),
  comments: v.array(portalComment),
});

function countItems(items: Doc<"qaVisualDeliveryItems">[]) {
  const approved = items.filter((i) => i.clientState === "approved").length;
  const changes = items.filter((i) => i.clientState === "changesRequested").length;
  return { total: items.length, approved, changes, pending: items.length - approved - changes };
}

async function activeItems(ctx: QueryCtx, campaignId: Id<"qaVisualCampaigns">) {
  const items = await ctx.db
    .query("qaVisualDeliveryItems")
    .withIndex("by_campaign_status_order", (q) =>
      q.eq("campaignId", campaignId).eq("status", "active"),
    )
    .take(1001);
  return items.slice(0, 1000);
}

async function latestDelivery(ctx: QueryCtx, campaignId: Id<"qaVisualCampaigns">) {
  const rounds = await ctx.db
    .query("qaVisualDeliveries")
    .withIndex("by_campaign_number", (q) => q.eq("campaignId", campaignId))
    .order("desc")
    .take(10);
  return rounds.find((r) => r.status === "published") ?? null;
}

export const campaigns = query({
  args: {},
  returns: v.object({
    mode: v.union(v.null(), mode),
    campaigns: v.array(
      v.object({
        id: v.id("qaVisualCampaigns"),
        name: v.string(),
        counts,
        lastDeliveryAt: v.union(v.null(), v.number()),
      }),
    ),
  }),
  handler: async (ctx) => {
    const viewer = await portalViewer(ctx);
    if (!viewer) return { mode: null, campaigns: [] };
    const rows = await ctx.db
      .query("qaVisualCampaigns")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .take(500);
    const result = [];
    for (const campaign of rows) {
      if (!campaign.client || !campaign.clientReview?.enabled) continue;
      if (viewer.mode === "client" && !(await assignedToCampaignClient(ctx, viewer.userId, campaign)))
        continue;
      const items = await activeItems(ctx, campaign._id);
      if (!items.length && viewer.mode === "client") continue;
      result.push({
        id: campaign._id,
        name: campaign.name,
        counts: countItems(items),
        lastDeliveryAt: (await latestDelivery(ctx, campaign._id))?.publishedAt ?? null,
      });
    }
    return { mode: viewer.mode, campaigns: result };
  },
});

export const gallery = query({
  args: { campaignId: v.id("qaVisualCampaigns") },
  returns: v.object({
    mode,
    canApprove: v.boolean(),
    canComment: v.boolean(),
    campaign: v.object({ id: v.id("qaVisualCampaigns"), name: v.string(), agencyLabel: v.string() }),
    delivery: v.union(
      v.null(),
      v.object({ number: v.number(), message: v.optional(v.string()), publishedAt: v.number() }),
    ),
    counts,
    items: v.array(
      v.object({
        id: v.id("qaVisualDeliveryItems"),
        title: v.string(),
        format: v.string(),
        clientVersion: v.number(),
        state: clientState,
        isNew: v.boolean(),
        image: v.union(v.null(), v.object({ width: v.number(), height: v.number() })),
        comments: v.number(),
        publishedAt: v.number(),
      }),
    ),
  }),
  handler: async (ctx, { campaignId }) => {
    const access = await requireClientCampaign(ctx, campaignId);
    const items = await activeItems(ctx, campaignId);
    const delivery = await latestDelivery(ctx, campaignId);
    return {
      mode: access.mode,
      canApprove: access.canApprove,
      canComment: access.canComment,
      campaign: {
        id: access.campaign._id,
        name: access.campaign.name,
        agencyLabel: access.campaign.clientReview?.agencyLabel ?? "Agencia",
      },
      delivery: delivery
        ? {
            number: delivery.number,
            ...(delivery.message ? { message: delivery.message } : {}),
            publishedAt: delivery.publishedAt,
          }
        : null,
      counts: countItems(items),
      items: await Promise.all(
        items.map(async (item) => {
          const threads = await ctx.db
            .query("qaVisualThreads")
            .withIndex("by_item", (q) => q.eq("deliveryItemId", item._id))
            .take(200);
          return {
            id: item._id,
            title: item.brief.title,
            format: item.brief.format,
            clientVersion: item.clientVersion,
            state: item.clientState,
            isNew:
              item.clientVersion > 1 &&
              (item.clientState === "sent" || item.clientState === "viewed"),
            image: item.image ?? null,
            comments: threads.filter((t) => t.audience === "client").length,
            publishedAt: item.publishedAt,
          };
        }),
      ),
    };
  },
});

async function clientThreads(
  ctx: QueryCtx,
  item: Doc<"qaVisualDeliveryItems">,
  campaign: Doc<"qaVisualCampaigns">,
  viewerId: Id<"users">,
) {
  const threads = await ctx.db
    .query("qaVisualThreads")
    .withIndex("by_item", (q) => q.eq("deliveryItemId", item._id))
    .take(200);
  return Promise.all(
    threads
      .filter((t) => t.audience === "client")
      .map(async (thread) => {
        const comments = await ctx.db
          .query("qaVisualComments")
          .withIndex("by_thread", (q) => q.eq("threadId", thread._id))
          .take(200);
        return {
          id: thread._id,
          anchor: thread.anchor,
          resolved: thread.status === "resolved",
          comments: await Promise.all(
            comments
              .filter((c) => c.visibility === "client" && !c.event && !c.deletedAt)
              .map(async (c) => {
                const author = await portalAuthor(ctx, campaign, c.authorId, c.authorKind, viewerId);
                return {
                  id: c._id,
                  body: c.body,
                  author: author.name,
                  authorKind: author.kind,
                  at: c._creationTime,
                  audio: c.audio ? { durationMs: c.audio.durationMs } : null,
                  transcript: c.transcript ?? null,
                  canDelete: c.authorId === viewerId,
                };
              }),
          ),
        };
      }),
  );
}

export const piece = query({
  args: { itemId: v.id("qaVisualDeliveryItems") },
  returns: v.object({
    mode,
    canApprove: v.boolean(),
    canComment: v.boolean(),
    readOnly: v.boolean(),
    campaignId: v.id("qaVisualCampaigns"),
    agencyLabel: v.string(),
    item: v.object({
      id: v.id("qaVisualDeliveryItems"),
      title: v.string(),
      format: v.string(),
      clientVersion: v.number(),
      state: clientState,
      deliveryNumber: v.number(),
      publishedAt: v.number(),
      image: v.union(v.null(), v.object({ width: v.number(), height: v.number() })),
      fields: v.array(v.object({ key: v.string(), label: v.string(), value: v.string() })),
    }),
    versions: v.array(
      v.object({
        id: v.id("qaVisualDeliveryItems"),
        clientVersion: v.number(),
        state: clientState,
        current: v.boolean(),
      }),
    ),
    previousAsks: v.array(v.object({ text: v.string(), resolved: v.boolean() })),
    decision: v.union(
      v.null(),
      v.object({
        id: v.id("qaVisualClientDecisions"),
        decision: v.union(v.literal("approved"), v.literal("changesRequested")),
        note: v.optional(v.string()),
        author: v.string(),
        at: v.number(),
      }),
    ),
    threads: v.array(portalThread),
  }),
  handler: async (ctx, { itemId }) => {
    const access = await requireClientItem(ctx, itemId);
    const { item, campaign, user } = access;
    const delivery = await ctx.db.get(item.deliveryId);
    const history = (
      await ctx.db
        .query("qaVisualDeliveryItems")
        .withIndex("by_piece", (q) => q.eq("pieceId", item.pieceId))
        .take(50)
    ).filter((i) => i.status !== "withdrawn");
    const previous = history
      .filter((i) => i.clientVersion < item.clientVersion)
      .sort((a, b) => b.clientVersion - a.clientVersion)[0];
    const previousAsks = previous
      ? (await clientThreads(ctx, previous, campaign, user)).flatMap((t) => {
          const first = t.comments[0];
          const text = first?.body || first?.transcript?.text || (first?.audio ? "Comentario de voz" : "");
          return text ? [{ text: text.slice(0, 600), resolved: t.resolved }] : [];
        })
      : [];
    const decision = item.currentDecisionId ? await ctx.db.get(item.currentDecisionId) : null;
    return {
      mode: access.mode,
      canApprove: access.canApprove && item.status === "active",
      canComment: access.canComment && item.status === "active",
      readOnly: item.status !== "active",
      campaignId: campaign._id,
      agencyLabel: campaign.clientReview?.agencyLabel ?? "Agencia",
      item: {
        id: item._id,
        title: item.brief.title,
        format: item.brief.format,
        clientVersion: item.clientVersion,
        state: item.clientState,
        deliveryNumber: delivery?.number ?? 0,
        publishedAt: item.publishedAt,
        image: item.image ?? null,
        fields: item.brief.fields,
      },
      versions: history
        .sort((a, b) => b.clientVersion - a.clientVersion)
        .map((i) => ({
          id: i._id,
          clientVersion: i.clientVersion,
          state: i.clientState,
          current: i.status === "active",
        })),
      previousAsks: previousAsks.slice(0, 20),
      decision: decision
        ? {
            id: decision._id,
            decision: decision.decision,
            ...(decision.note ? { note: decision.note } : {}),
            author: (await portalAuthor(ctx, campaign, decision.decidedBy, "client", user)).name,
            at: decision._creationTime,
          }
        : null,
      threads: await clientThreads(ctx, item, campaign, user),
    };
  },
});

export const markViewed = mutation({
  args: { itemId: v.id("qaVisualDeliveryItems") },
  returns: v.null(),
  handler: async (ctx, { itemId }) => {
    const { item, mode, user } = await requireClientItem(ctx, itemId);
    if (mode === "client" && item.clientState === "sent" && item.status === "active")
      await ctx.db.patch(item._id, {
        clientState: "viewed",
        firstViewedAt: Date.now(),
        firstViewedBy: user,
      });
    return null;
  },
});

function validBody(body: string | undefined, hasAudio: boolean) {
  const text = body?.trim() ?? "";
  if ((!text && !hasAudio) || text.length > 4000)
    throw new ConvexError({
      code: "invalid_comment",
      message: "Escribí un comentario de hasta 4000 caracteres o grabá un audio.",
    });
  return text;
}

export const createComment = mutation({
  args: {
    itemId: v.id("qaVisualDeliveryItems"),
    anchor,
    body: v.optional(v.string()),
    audio: v.optional(audioArg),
    requestId: v.string(),
  },
  returns: v.id("qaVisualThreads"),
  handler: async (ctx, args) => {
    const access = await requireClientItem(ctx, args.itemId);
    requireClientWriter(access);
    if (access.item.status !== "active")
      throw new ConvexError("Esta versión ya fue reemplazada. Comentá la versión actual.");
    validateAnchor(args.anchor);
    const body = validBody(args.body, Boolean(args.audio));
    if (args.requestId.length > 100) throw new ConvexError("Solicitud inválida.");
    const previous = await ctx.db
      .query("qaVisualThreads")
      .withIndex("by_request", (q) => q.eq("createdBy", access.user).eq("requestId", args.requestId))
      .unique();
    if (previous) return previous._id;
    const version = await ctx.db.get(access.item.pieceVersionId);
    if (!version) throw new ConvexError("La pieza ya no está disponible.");
    const claim = args.audio ? await claimAudio(ctx, access.user, args.audio) : null;
    const now = Date.now();
    const threadId = await ctx.db.insert("qaVisualThreads", {
      campaignId: version.campaignId,
      pieceId: version.pieceId,
      pieceVersionId: version._id,
      origin: { kind: "human" },
      anchor: args.anchor,
      status: "open",
      audience: "client",
      deliveryItemId: access.item._id,
      createdBy: access.user,
      lastActivityAt: now,
      commentCount: 1,
      requestId: args.requestId,
    });
    const commentId = await ctx.db.insert("qaVisualComments", {
      threadId,
      pieceVersionId: version._id,
      authorId: access.user,
      body,
      visibility: "client",
      authorKind: "client",
      ...(claim
        ? { audio: claim.clip, transcript: { status: "pending" as const } }
        : {}),
    });
    if (claim) await attachAudio(ctx, claim.uploadId, commentId);
    return threadId;
  },
});

export const reply = mutation({
  args: {
    threadId: v.id("qaVisualThreads"),
    body: v.optional(v.string()),
    audio: v.optional(audioArg),
    requestId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const thread = await ctx.db.get(args.threadId);
    if (!thread || thread.audience !== "client" || !thread.deliveryItemId)
      throw new ConvexError({ code: "not_found", message: "No encontramos esta conversación." });
    const access = await requireClientItem(ctx, thread.deliveryItemId);
    requireClientWriter(access);
    const body = validBody(args.body, Boolean(args.audio));
    if (args.requestId.length > 100) throw new ConvexError("Solicitud inválida.");
    const previous = await ctx.db
      .query("qaVisualComments")
      .withIndex("by_request", (q) => q.eq("authorId", access.user).eq("requestId", args.requestId))
      .unique();
    if (previous) return null;
    const claim = args.audio ? await claimAudio(ctx, access.user, args.audio) : null;
    const commentId = await ctx.db.insert("qaVisualComments", {
      threadId: thread._id,
      pieceVersionId: thread.pieceVersionId,
      authorId: access.user,
      body,
      visibility: "client",
      authorKind: "client",
      requestId: args.requestId,
      ...(claim
        ? { audio: claim.clip, transcript: { status: "pending" as const } }
        : {}),
    });
    if (claim) await attachAudio(ctx, claim.uploadId, commentId);
    await ctx.db.patch(thread._id, {
      commentCount: thread.commentCount + 1,
      lastActivityAt: Date.now(),
      status: "open",
    });
    return null;
  },
});

export const removeComment = mutation({
  args: { commentId: v.id("qaVisualComments") },
  returns: v.null(),
  handler: async (ctx, { commentId }) => {
    const comment = await ctx.db.get(commentId);
    const thread = comment && (await ctx.db.get(comment.threadId));
    if (!comment || !thread?.deliveryItemId || thread.audience !== "client")
      throw new ConvexError({ code: "not_found", message: "No encontramos este comentario." });
    const access = await requireClientItem(ctx, thread.deliveryItemId);
    requireClientWriter(access);
    if (comment.authorId !== access.user)
      throw new ConvexError("Solo podés borrar tus comentarios.");
    if (!comment.deletedAt) await ctx.db.patch(comment._id, { body: "", deletedAt: Date.now() });
    return null;
  },
});

export const decide = mutation({
  args: {
    itemId: v.id("qaVisualDeliveryItems"),
    decision: v.union(v.literal("approved"), v.literal("changesRequested")),
    note: v.optional(v.string()),
    expectedDecisionId: v.union(v.id("qaVisualClientDecisions"), v.null()),
  },
  returns: v.id("qaVisualClientDecisions"),
  handler: async (ctx, args) => {
    const access = await requireClientItem(ctx, args.itemId);
    requireClientWriter(access);
    const { item } = access;
    if (item.status !== "active")
      throw new ConvexError("Esta versión ya fue reemplazada por una más nueva.");
    if (args.decision === "approved" && !access.canApprove)
      throw new ConvexError({
        code: "not_approver",
        message: "La aprobación de esta campaña la realiza otra persona de tu equipo.",
      });
    if ((item.currentDecisionId ?? null) !== args.expectedDecisionId)
      throw new ConvexError({
        code: "decision_conflict",
        message: "Otra persona de tu equipo decidió sobre esta pieza. Revisá el estado actualizado.",
      });
    const note = args.note?.trim();
    if (note && note.length > 4000) throw new ConvexError("La nota puede tener hasta 4000 caracteres.");
    if (args.decision === "changesRequested" && !note) {
      const open = await ctx.db
        .query("qaVisualThreads")
        .withIndex("by_item", (q) => q.eq("deliveryItemId", item._id).eq("status", "open"))
        .take(50);
      if (!open.some((t) => t.audience === "client"))
        throw new ConvexError({
          code: "reason_required",
          message: "Contanos qué hay que cambiar: dejá un comentario o escribilo acá.",
        });
    }
    const id = await ctx.db.insert("qaVisualClientDecisions", {
      campaignId: item.campaignId,
      deliveryItemId: item._id,
      pieceId: item.pieceId,
      decision: args.decision,
      ...(note ? { note } : {}),
      decidedBy: access.user,
      ...(item.currentDecisionId ? { supersedesId: item.currentDecisionId } : {}),
    });
    await ctx.db.patch(item._id, { clientState: args.decision, currentDecisionId: id });
    return id;
  },
});

/** Image bytes for the portal. Withdrawn items are never served. */
export const itemMedia = internalQuery({
  args: {
    itemId: v.string(),
    variant: imageVariant,
  },
  handler: async (ctx, { itemId, variant }) => {
    const id = ctx.db.normalizeId("qaVisualDeliveryItems", itemId);
    if (!id) return null;
    try {
      const { item, campaign } = await requireClientItem(ctx, id);
      const version = await ctx.db.get(item.pieceVersionId);
      if (!version) return null;
      const copy = await versionCopy(ctx, campaign.reviewKey, version);
      return variantStorage(copy?.files, variant);
    } catch {
      return null;
    }
  },
});
