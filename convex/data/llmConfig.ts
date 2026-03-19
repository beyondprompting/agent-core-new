// convex/llmConfig.ts
// Funciones para manejar configuración de LLM y registro de errores
import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

// ==================== QUERIES ====================

/**
 * Obtener configuración de un proveedor específico
 */
export const getProviderConfig = query({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, { provider }) => {
    return await ctx.db
      .query("llmConfig")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .first();
  },
});

/**
 * Obtener toda la configuración de LLM
 */
export const getAllConfigs = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("llmConfig").collect();
  },
});

/**
 * Query interna para verificar si un proveedor está habilitado
 */
export const isProviderEnabled = internalQuery({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, { provider }): Promise<boolean> => {
    const config = await ctx.db
      .query("llmConfig")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .first();
    
    // Si no hay configuración, está habilitado por defecto
    if (!config) {
      return true;
    }
    
    return config.enabled;
  },
});

/**
 * Obtener errores recientes de LLM
 */
export const getRecentErrors = query({
  args: {
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { limit = 50 }) => {
    return await ctx.db
      .query("llmErrors")
      .withIndex("by_timestamp")
      .order("desc")
      .take(limit);
  },
});

/**
 * Obtener estadísticas de errores por proveedor
 */
export const getErrorStats = query({
  args: {},
  handler: async (ctx) => {
    const errors = await ctx.db.query("llmErrors").collect();
    
    const stats = {
      gemini: { total: 0, resolved: 0, unresolved: 0 },
      openai: { total: 0, resolved: 0, unresolved: 0 },
    };
    
    for (const error of errors) {
      const provider = error.provider as keyof typeof stats;
      if (stats[provider]) {
        stats[provider].total++;
        if (error.resolved) {
          stats[provider].resolved++;
        } else {
          stats[provider].unresolved++;
        }
      }
    }
    
    return stats;
  },
});

// ==================== MUTATIONS ====================

/**
 * Actualizar configuración de un proveedor (para testing)
 */
export const setProviderEnabled = mutation({
  args: {
    provider: v.string(),
    enabled: v.boolean(),
  },
  handler: async (ctx, { provider, enabled }) => {
    const existing = await ctx.db
      .query("llmConfig")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .first();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled,
        updatedAt: Date.now(),
      });
      console.log(`[LLMConfig] ${provider} ${enabled ? "habilitado" : "deshabilitado"}`);
      return existing._id;
    } else {
      const id = await ctx.db.insert("llmConfig", {
        provider,
        enabled,
        updatedAt: Date.now(),
      });
      console.log(`[LLMConfig] ${provider} configurado: ${enabled ? "habilitado" : "deshabilitado"}`);
      return id;
    }
  },
});

/**
 * Registrar un error de LLM (interno)
 */
export const logLLMError = internalMutation({
  args: {
    provider: v.string(),
    model: v.string(),
    agentName: v.string(),
    errorType: v.string(),
    errorMessage: v.string(),
    threadId: v.optional(v.string()),
    resolved: v.boolean(),
    fallbackUsed: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = await ctx.db.insert("llmErrors", {
      ...args,
      timestamp: Date.now(),
    });
    
    console.log(`[LLMError] Registrado: ${args.provider}/${args.model} - ${args.errorType}`);
    if (args.resolved && args.fallbackUsed) {
      console.log(`[LLMError] Resuelto con fallback: ${args.fallbackUsed}`);
    }
    
    return id;
  },
});

/**
 * Limpiar errores antiguos (más de 7 días)
 */
export const cleanupOldErrors = mutation({
  args: {},
  handler: async (ctx) => {
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    
    const oldErrors = await ctx.db
      .query("llmErrors")
      .withIndex("by_timestamp")
      .filter((q) => q.lt(q.field("timestamp"), sevenDaysAgo))
      .collect();
    
    for (const error of oldErrors) {
      await ctx.db.delete(error._id);
    }
    
    console.log(`[LLMConfig] Limpiados ${oldErrors.length} errores antiguos`);
    return oldErrors.length;
  },
});

// ==================== FUNCIONES DE TEST ====================

/**
 * Simular caída de un proveedor (para testing)
 */
export const simulateProviderDown = mutation({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, { provider }) => {
    return await ctx.db.insert("llmConfig", {
      provider,
      enabled: false,
      updatedAt: Date.now(),
      updatedBy: "test-simulation",
    }).catch(async () => {
      // Si ya existe, actualizar
      const existing = await ctx.db
        .query("llmConfig")
        .withIndex("by_provider", (q) => q.eq("provider", provider))
        .first();
      if (existing) {
        await ctx.db.patch(existing._id, {
          enabled: false,
          updatedAt: Date.now(),
          updatedBy: "test-simulation",
        });
        return existing._id;
      }
      throw new Error("No se pudo configurar el proveedor");
    });
  },
});

/**
 * Restaurar un proveedor (para testing)
 */
export const restoreProvider = mutation({
  args: {
    provider: v.string(),
  },
  handler: async (ctx, { provider }) => {
    const existing = await ctx.db
      .query("llmConfig")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .first();
    
    if (existing) {
      await ctx.db.patch(existing._id, {
        enabled: true,
        updatedAt: Date.now(),
        updatedBy: "test-restore",
      });
      console.log(`[LLMConfig] ${provider} restaurado`);
      return existing._id;
    }
    
    // Si no existe configuración, no hay nada que restaurar (está habilitado por defecto)
    return null;
  },
});

/**
 * Resetear toda la configuración de test
 */
export const resetAllConfigs = mutation({
  args: {},
  handler: async (ctx) => {
    const configs = await ctx.db.query("llmConfig").collect();
    
    for (const config of configs) {
      await ctx.db.delete(config._id);
    }
    
    console.log(`[LLMConfig] Reseteo completo: ${configs.length} configuraciones eliminadas`);
    return configs.length;
  },
});
