import { type Infer, v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation, type MutationCtx } from "../_generated/server";
import { getProjectManagementProvider } from "../integrations/registry";
import { workflow } from "../workflows";

const target = v.union(
  v.object({ taskId: v.id("tasks") }),
  v.object({ projectId: v.id("projects") }),
  v.object({ event: v.literal("client.created") }),
  v.object({ corUserDocumentIds: v.array(v.id("corUsers")) }),
);

export const syncRecord = workflow.define({
  args: { target, corId: v.number(), verifyDeletion: v.optional(v.literal(true)) },
  handler: async (step, { target, corId, verifyDeletion }): Promise<void> => {
    const options = { retry: { maxAttempts: 8, initialBackoffMs: 5000, base: 2 } };
    const sync = internal.data.corInboundSync;
    if ("taskId" in target) {
      await step.runAction(sync.pullTaskFromCORWorker, { ...target, webhookCorId: corId }, options);
    } else if ("projectId" in target) {
      await step.runAction(sync.pullProjectFromCORWorker, {
        ...target, webhookCorId: corId, ...(verifyDeletion && { verifyDeletion }),
      }, options);
    } else if ("corUserDocumentIds" in target) {
      await step.runAction(internal.data.corWebhook.verifyDeletedUser, { corId, ...target }, options);
    } else {
      await step.runAction(internal.data.corWebhook.importCreatedClient, { corId }, options);
    }
  },
});

const syncEvent = v.union(
  v.literal("task.updated"), v.literal("project.updated"), v.literal("project.deleted"),
  v.literal("client.created"), v.literal("user.deleted"),
);

async function findTargets(ctx: MutationCtx, event: Infer<typeof syncEvent>, corId: number): Promise<Infer<typeof target>[]> {
  switch (event) {
    case "client.created":
      return [{ event }];
    case "user.deleted": {
      const links = await ctx.db.query("corUsers").withIndex("by_corUserId", q => q.eq("corUserId", corId)).collect();
      return links.length ? [{ corUserDocumentIds: links.map(link => link._id) }] : [];
    }
    case "task.updated":
      return (await ctx.db.query("tasks").withIndex("by_corTaskId", q => q.eq("corTaskId", String(corId))).collect())
        .filter(task => !task.convexStatus || task.convexStatus === "active")
        .map(task => ({ taskId: task._id }));
    case "project.updated":
    case "project.deleted":
      return (await ctx.db.query("projects").withIndex("by_corProjectId", q => q.eq("corProjectId", corId)).collect())
        .filter(project => !project.convexStatus || project.convexStatus === "active")
        .map(project => ({ projectId: project._id }));
  }
}

export const enqueue = internalMutation({
  args: { event: syncEvent, corId: v.number() },
  handler: async (ctx, { event, corId }): Promise<number> => {
    const targets = await findTargets(ctx, event, corId);
    for (const target of targets) {
      await workflow.start(ctx, internal.data.corWebhook.syncRecord, {
        target, corId, ...(event === "project.deleted" && { verifyDeletion: true as const }),
      }, { startAsync: true });
    }
    return targets.length;
  },
});

export const importCreatedClient = internalAction({
  args: { corId: v.number() },
  handler: async (ctx, { corId }): Promise<void> => {
    const clients = internal.data.corClients;
    if (await ctx.runQuery(clients.getClientByCorId, { corClientId: corId })) return;
    const client = await getProjectManagementProvider().getClient(corId);
    if (!client) throw new Error(`El cliente COR ${corId} no está disponible para importar.`);
    await ctx.runMutation(clients.upsertClient, {
      corClientId: corId, name: client.name, businessName: client.businessName,
      nameContact: client.nameContact, lastNameContact: client.lastNameContact,
      emailContact: client.email, website: client.website, description: client.description,
      phone: client.phone, insertOnly: true,
    });
  },
});

export const verifyDeletedUser = internalAction({
  args: { corId: v.number(), corUserDocumentIds: v.array(v.id("corUsers")) },
  handler: async (ctx, { corId, corUserDocumentIds }): Promise<void> => {
    if (!(await getProjectManagementProvider().isUserDeleted(corId))) return;
    await ctx.runMutation(internal.data.corUsers.deactivateConfirmedMissingCorUsers, {
      candidates: corUserDocumentIds.map(corUserDocumentId => ({ corUserDocumentId, expectedCorUserId: corId })),
    });
  },
});
