// convex/ragDocuments.ts
// CRUD para la tabla ragDocuments - Documentos PDF procesados
import { query, mutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Listar todos los documentos
export const list = query({
  args: {},
  handler: async (ctx) => {
    console.log("[RagDocuments:list] 📋 Listando documentos...");
    const docs = await ctx.db.query("ragDocuments").collect();
    console.log(`[RagDocuments:list] ✅ Encontrados ${docs.length} documentos`);
    return docs;
  },
});

// Obtener un documento por ID
export const get = query({
  args: { id: v.id("ragDocuments") },
  handler: async (ctx, { id }) => {
    console.log(`[RagDocuments:get] 🔍 Buscando documento: ${id}`);
    return await ctx.db.get(id);
  },
});

// Buscar documento por filename
export const getByFilename = query({
  args: { filename: v.string() },
  handler: async (ctx, { filename }) => {
    console.log(`[RagDocuments:getByFilename] 🔍 Buscando: ${filename}`);
    return await ctx.db
      .query("ragDocuments")
      .withIndex("by_filename", (q) => q.eq("filename", filename))
      .first();
  },
});

// Crear un nuevo documento (cuando se sube un PDF)
export const create = mutation({
  args: {
    filename: v.string(),
    pageCount: v.number(),
  },
  handler: async (ctx, { filename, pageCount }) => {
    console.log(`[RagDocuments:create] 📄 Creando documento: ${filename} (${pageCount} páginas)`);
    const id = await ctx.db.insert("ragDocuments", {
      filename,
      pageCount,
      processedAt: Date.now(),
      status: "pending",
    });
    console.log(`[RagDocuments:create] ✅ Documento creado: ${id}`);
    return id;
  },
});

// Actualizar estado del documento
export const updateStatus = mutation({
  args: {
    id: v.id("ragDocuments"),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, { id, status, errorMessage }) => {
    console.log(`[RagDocuments:updateStatus] 🔄 Actualizando ${id} -> ${status}`);
    await ctx.db.patch(id, { status, errorMessage });
    console.log(`[RagDocuments:updateStatus] ✅ Estado actualizado`);
  },
});

// Actualizar el pageCount del documento
export const updatePageCount = mutation({
  args: {
    id: v.id("ragDocuments"),
    pageCount: v.number(),
  },
  handler: async (ctx, { id, pageCount }) => {
    console.log(`[RagDocuments:updatePageCount] 🔄 Actualizando pageCount de ${id} -> ${pageCount}`);
    await ctx.db.patch(id, { pageCount });
    console.log(`[RagDocuments:updatePageCount] ✅ PageCount actualizado`);
  },
});

// Listar documentos por estado
export const listByStatus = query({
  args: {
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
  },
  handler: async (ctx, { status }) => {
    console.log(`[RagDocuments:listByStatus] 🔍 Buscando documentos con estado: ${status}`);
    return await ctx.db
      .query("ragDocuments")
      .withIndex("by_status", (q) => q.eq("status", status))
      .collect();
  },
});

// Eliminar un documento y sus páginas/entidades asociadas
export const deleteDocument = mutation({
  args: { id: v.id("ragDocuments") },
  handler: async (ctx, { id }) => {
    console.log(`[RagDocuments:delete] 🗑️ Eliminando documento: ${id}`);
    
    // Eliminar páginas asociadas
    const pages = await ctx.db
      .query("ragPages")
      .withIndex("by_document", (q) => q.eq("documentId", id))
      .collect();
    
    for (const page of pages) {
      if (page.imageStorageId) {
        try {
          await ctx.storage.delete(page.imageStorageId);
        } catch (e) {
          console.warn(`[RagDocuments:delete] ⚠️ No se pudo eliminar imagen: ${page.imageStorageId}`);
        }
      }
      await ctx.db.delete(page._id);
    }
    console.log(`[RagDocuments:delete] 🗑️ ${pages.length} páginas eliminadas`);
    
    // Eliminar imágenes de entidades
    const entityImages = await ctx.db
      .query("entityImages")
      .withIndex("by_document", (q) => q.eq("documentId", id))
      .collect();
    
    for (const entityImg of entityImages) {
      if (entityImg.imageStorageId) {
        try {
          await ctx.storage.delete(entityImg.imageStorageId);
        } catch (e) {
          console.warn(`[RagDocuments:delete] ⚠️ No se pudo eliminar imagen entidad: ${entityImg.imageStorageId}`);
        }
      }
      await ctx.db.delete(entityImg._id);
    }
    console.log(`[RagDocuments:delete] 🗑️ ${entityImages.length} imágenes de entidades eliminadas`);
    
    // Eliminar documento
    await ctx.db.delete(id);
    console.log(`[RagDocuments:delete] ✅ Documento eliminado`);
  },
});

// Estadísticas de documentos
export const getStats = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("ragDocuments").collect();
    return {
      total: docs.length,
      pending: docs.filter(d => d.status === "pending").length,
      processing: docs.filter(d => d.status === "processing").length,
      completed: docs.filter(d => d.status === "completed").length,
      error: docs.filter(d => d.status === "error").length,
      totalPages: docs.reduce((sum, d) => sum + d.pageCount, 0),
    };
  },
});

// Query interna para obtener documento (para uso en actions)
export const getInternal = internalQuery({
  args: { documentId: v.id("ragDocuments") },
  handler: async (ctx, { documentId }) => {
    return await ctx.db.get(documentId);
  },
});
