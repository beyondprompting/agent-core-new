import { query, mutation } from "../_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Obtener el workspace del usuario actual
export const getMyWorkspace = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      return null;
    }

    const workspace = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();

    return workspace;
  },
});

// Crear workspace para el usuario (si no existe)
export const ensureWorkspace = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    // Verificar si ya existe
    const existing = await ctx.db
      .query("workspaces")
      .withIndex("by_owner", (q) => q.eq("ownerId", userId))
      .first();

    if (existing) {
      return existing._id;
    }

    // Crear nuevo workspace
    const workspaceId = await ctx.db.insert("workspaces", {
      ownerId: userId,
      createdAt: Date.now(),
    });

    return workspaceId;
  },
});
