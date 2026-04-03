// convex/data/projects.ts
// =====================================================
// CRUD de proyectos locales (tabla intermedia Client → Project → Task).
//
// Los proyectos se crean primero en Convex (editables en Panel de Control).
// Cuando el usuario publica, se sincronizan a COR.
// =====================================================

import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  internalQuery,
  internalAction,
} from "../_generated/server";
import { internal } from "../_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";
import { getProjectManagementProvider } from "../integrations/registry";

// ==================== QUERIES ====================

/**
 * Obtiene un proyecto por su ID.
 */
export const getProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("No autenticado");

    return await ctx.db.get(args.projectId);
  },
});

/**
 * Lista proyectos creados por el usuario autenticado.
 */
export const listMyProjects = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("No autenticado");

    return await ctx.db
      .query("projects")
      .withIndex("by_createdBy", (q) => q.eq("createdBy", userId))
      .collect();
  },
});

/**
 * Busca un proyecto por threadId.
 * Uso interno — el agente necesita saber si ya existe un proyecto para el thread actual.
 */
export const getProjectByThread = internalQuery({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_threadId", (q) => q.eq("threadId", args.threadId))
      .unique();
  },
});

/**
 * Obtiene un proyecto por su ID (uso interno desde actions).
 */
export const getProjectInternal = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.projectId);
  },
});

// ==================== MUTATIONS ====================

/**
 * Crea un proyecto local en Convex.
 * Llamado internamente por el flujo del createTaskTool.
 * El proyecto nace con corSyncStatus = "pending" (editable antes de publicar).
 */
export const createProjectInternal = internalMutation({
  args: {
    name: v.string(),
    brief: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.string(),
    clientId: v.optional(v.id("corClients")),
    createdBy: v.optional(v.string()),
    threadId: v.optional(v.string()),
    corClientId: v.optional(v.number()),
    pmId: v.optional(v.number()),
    deliverables: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = await ctx.db.insert("projects", {
      name: args.name,
      brief: args.brief,
      startDate: args.startDate,
      endDate: args.endDate,
      status: args.status,
      clientId: args.clientId,
      createdBy: args.createdBy,
      threadId: args.threadId,
      corClientId: args.corClientId,
      pmId: args.pmId,
      deliverables: args.deliverables,
      corSyncStatus: "pending",
    });

    console.log(`[projects] ✅ Proyecto creado: "${args.name}" (ID: ${projectId})`);
    return projectId;
  },
});

/**
 * Actualiza campos de un proyecto existente.
 * Usado desde el Panel de Control para edición pre/post-publicación.
 * Si el proyecto está publicado en COR, dispara sincronización automática.
 */
export const updateProjectFields = mutation({
  args: {
    projectId: v.id("projects"),
    name: v.optional(v.string()),
    brief: v.optional(v.string()),
    startDate: v.optional(v.string()),
    endDate: v.optional(v.string()),
    status: v.optional(v.string()),
    estimatedTime: v.optional(v.number()),
    billable: v.optional(v.boolean()),
    incomeType: v.optional(v.string()),
    deliverables: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("No autenticado");

    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Proyecto no encontrado");

    // ─── Validación de permisos (clientUserAssignments) ───
    if (project.corClientId) {
      const client = await ctx.db
        .query("corClients")
        .filter((q) => q.eq(q.field("corClientId"), project.corClientId))
        .first();

      if (client) {
        const user = await ctx.db
          .query("users")
          .filter((q) => q.eq(q.field("_id"), userId))
          .first();

        if (user) {
          const assignment = await ctx.db
            .query("clientUserAssignments")
            .withIndex("by_client_and_user", (q) =>
              q.eq("clientId", client._id).eq("userId", user._id)
            )
            .first();

          if (!assignment) {
            throw new Error(
              `No tienes permisos para editar proyectos del cliente "${client.name}".`
            );
          }
        }
      }
    }

    // Construir objeto de actualización solo con los campos proporcionados
    const updates: Record<string, unknown> = {};
    if (args.name !== undefined) updates.name = args.name;
    if (args.brief !== undefined) updates.brief = args.brief;
    if (args.startDate !== undefined) updates.startDate = args.startDate;
    if (args.endDate !== undefined) updates.endDate = args.endDate;
    if (args.status !== undefined) updates.status = args.status;
    if (args.estimatedTime !== undefined) updates.estimatedTime = args.estimatedTime;
    if (args.billable !== undefined) updates.billable = args.billable;
    if (args.incomeType !== undefined) updates.incomeType = args.incomeType;
    if (args.deliverables !== undefined) updates.deliverables = args.deliverables;

    if (Object.keys(updates).length === 0) return;

    await ctx.db.patch(args.projectId, updates);
    console.log(`[projects] ✅ Proyecto "${project.name}" actualizado (${Object.keys(updates).join(", ")})`);

    // Programar sync a COR si corresponde
    const changedFields = Object.keys(updates);
    await ctx.scheduler.runAfter(0, internal.data.projects.scheduleProjectSyncToCOR, {
      projectId: args.projectId,
      changedFields,
    });
  },
});

/**
 * Mutation interna para actualizar un proyecto (llamada desde editProjectTool del agente).
 */
export const updateProjectInternal = internalMutation({
  args: {
    projectId: v.id("projects"),
    updates: v.object({
      name: v.optional(v.string()),
      brief: v.optional(v.string()),
      startDate: v.optional(v.string()),
      endDate: v.optional(v.string()),
      deliverables: v.optional(v.string()),
      estimatedTime: v.optional(v.number()),
    }),
  },
  handler: async (ctx, args) => {
    console.log(`[projects.updateProjectInternal] Actualizando proyecto ${args.projectId}...`);

    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args.updates)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }

    if (Object.keys(updateData).length === 0) return args.projectId;

    await ctx.db.patch(args.projectId, updateData);
    console.log(`[projects.updateProjectInternal] ✅ Proyecto actualizado`);
    return args.projectId;
  },
});

/**
 * Mutation interna: programa la sincronización de ediciones locales hacia COR.
 * Verifica que el proyecto esté publicado y luego schedula la action de sync.
 */
export const scheduleProjectSyncToCOR = internalMutation({
  args: {
    projectId: v.id("projects"),
    changedFields: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) return;

    if (project.corSyncStatus !== "synced" || !project.corProjectId) {
      console.log(`[scheduleProjectSyncToCOR] Proyecto ${args.projectId} no está publicado en COR, omitiendo sync.`);
      return;
    }

    console.log(`[scheduleProjectSyncToCOR] 🔄 Programando sync para proyecto ${args.projectId}`);
    await ctx.scheduler.runAfter(0, internal.data.projects.syncProjectEditToCORAction, {
      projectId: args.projectId,
      changedFields: args.changedFields,
    });
  },
});

/**
 * Campos de proyecto que tienen equivalente directo en COR.
 */
const COR_PROJECT_SYNCABLE_FIELDS = new Set([
  "name", "brief", "startDate", "endDate", "deliverables", "estimatedTime",
]);

/**
 * Action interna: sincroniza una edición local de proyecto hacia COR.
 */
export const syncProjectEditToCORAction = internalAction({
  args: {
    projectId: v.id("projects"),
    changedFields: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("\n========================================");
    console.log("[SyncProjectEdit] 🔄 SINCRONIZANDO PROYECTO → COR");
    console.log(`[SyncProjectEdit] Proyecto Convex ID: ${args.projectId}`);
    console.log(`[SyncProjectEdit] Campos cambiados: ${args.changedFields.join(", ")}`);
    console.log("========================================\n");

    try {
      const project = await ctx.runQuery(internal.data.projects.getProjectInternal, {
        projectId: args.projectId,
      });

      if (!project) {
        console.error("[SyncProjectEdit] ❌ Proyecto no encontrado en Convex");
        return;
      }

      if (project.corSyncStatus !== "synced") {
        console.error(`[SyncProjectEdit] ❌ Proyecto no está synced (estado: ${project.corSyncStatus}). Abortando.`);
        return;
      }

      const corProjectId = project.corProjectId;
      if (!corProjectId) {
        console.error("[SyncProjectEdit] ❌ Proyecto no tiene corProjectId. Abortando.");
        return;
      }

      // Solo sincronizar campos que aplican
      const syncableChanges = args.changedFields.filter((f) => COR_PROJECT_SYNCABLE_FIELDS.has(f));
      if (syncableChanges.length === 0) {
        console.log("[SyncProjectEdit] ℹ️ No hay campos sincronizables con COR");
        return;
      }

      console.log(`[SyncProjectEdit] 📝 Campos a sincronizar: ${syncableChanges.join(", ")}`);

      const updatePayload: Record<string, unknown> = {};
      if (syncableChanges.includes("name")) updatePayload.name = project.name;
      if (syncableChanges.includes("brief")) updatePayload.brief = project.brief;
      if (syncableChanges.includes("startDate")) updatePayload.startDate = project.startDate;
      if (syncableChanges.includes("endDate")) updatePayload.endDate = project.endDate;
      if (syncableChanges.includes("deliverables")) updatePayload.deliverables = project.deliverables;
      if (syncableChanges.includes("estimatedTime")) updatePayload.estimatedTime = project.estimatedTime;

      const provider = getProjectManagementProvider();
      const result = await provider.updateProject(corProjectId, updatePayload as any);

      if (!result.success) {
        console.error(`[SyncProjectEdit] ❌ Error actualizando COR: ${result.error}`);
        return;
      }

      // Actualizar timestamp de sync
      await ctx.runMutation(internal.data.projects.updateProjectPublishStatus, {
        projectId: args.projectId,
        corSyncStatus: "synced",
      });

      console.log(`[SyncProjectEdit] ✅ Sincronización completada`);
      console.log("========================================\n");
    } catch (error) {
      console.error("[SyncProjectEdit] ❌ Error en sincronización:", error);
    }
  },
});

/**
 * Actualiza el estado de publicación de un proyecto.
 * Llamado desde la action de publicación después de crear en COR.
 */
export const updateProjectPublishStatus = internalMutation({
  args: {
    projectId: v.id("projects"),
    corProjectId: v.optional(v.number()),
    corSyncStatus: v.string(),
    corSyncError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const updates: Record<string, unknown> = {
      corSyncStatus: args.corSyncStatus,
    };

    if (args.corProjectId !== undefined) {
      updates.corProjectId = args.corProjectId;
    }
    if (args.corSyncError !== undefined) {
      updates.corSyncError = args.corSyncError;
    }
    if (args.corSyncStatus === "synced") {
      updates.corSyncedAt = Date.now();
      updates.corSyncError = undefined;
    }

    await ctx.db.patch(args.projectId, updates);
    console.log(`[projects] 🔄 Proyecto ${args.projectId} → ${args.corSyncStatus}`);
  },
});
