// convex/ragSearch.ts
// Funciones de búsqueda RAG para el agente
import { action, query, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import rag from "./rag";
import { internal, components } from "../_generated/api";
import { getFile, listMessages } from "@convex-dev/agent";

// Namespace para los documentos en el RAG
const RAG_NAMESPACE = "rag-documents";

// ============================================================
// BÚSQUEDA POR TEXTO
// ============================================================

// Búsqueda semántica por texto
export const searchByText = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query, limit = 10 }) => {
    console.log(`[RAG:searchByText] 🔍 Buscando: "${query}" (limit: ${limit})`);
    
    const startTime = Date.now();
    const { results, text, entries, usage } = await rag.search(ctx, {
      namespace: RAG_NAMESPACE,
      query,
      limit,
      chunkContext: { before: 1, after: 1 },
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`[RAG:searchByText] ✅ Encontrados ${results.length} resultados en ${elapsed}ms`);
    console.log(`[RAG:searchByText] 📊 Tokens usados: ${usage.tokens}`);

    return { results, text, entries, usage };
  },
});

// Búsqueda semántica enriquecida con información de documentos y páginas
// PARA USO DEL AGENTE - incluye metadatos completos
export const searchByTextEnriched = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { query, limit = 5 }): Promise<{
    resultados: Array<{
      score: number;
      text: string;
      documento: string;
      pagina: number | undefined;
      textoCompleto: string;
    }>;
    total: number;
    usage: any;
  }> => {
    console.log(`[RAG:searchEnriched] 🔍 Búsqueda enriquecida: "${query}"`);
    
    // 1. Búsqueda RAG básica
    const { results, text, entries, usage } = await rag.search(ctx, {
      namespace: RAG_NAMESPACE,
      query,
      limit,
      chunkContext: { before: 1, after: 1 },
    });
    
    console.log(`[RAG:searchEnriched] ✅ ${results.length} resultados del RAG`);
    
    // 2. Extraer IDs únicos de páginas desde los entries
    const pageRagIds: string[] = entries?.map((entry: any) => entry.entryId).filter(Boolean) || [];
    console.log(`[RAG:searchEnriched] 📄 Buscando info de ${pageRagIds.length} páginas...`);
    
    // 3. Obtener información de páginas y documentos
    const enrichedResults = await ctx.runQuery(internal.rag.ragSearch.enrichResultsWithMetadata, {
      ragEntryIds: pageRagIds,
    });
    
    console.log(`[RAG:searchEnriched] ✅ ${enrichedResults.length} resultados enriquecidos`);
    
    // 4. Combinar resultados del RAG con metadatos
    const finalResults = results.map((result: any, idx: number) => {
      const metadata = enrichedResults[idx];
      return {
        score: result.score,
        text: text || result.text || "",
        documento: metadata?.documentName || "Desconocido",
        pagina: metadata?.pageNumber,
        textoCompleto: metadata?.pageText || text || "",
      };
    });
    
    return {
      resultados: finalResults,
      total: finalResults.length,
      usage,
    };
  },
});

// Query interna para enriquecer resultados con metadatos
export const enrichResultsWithMetadata = internalQuery({
  args: {
    ragEntryIds: v.array(v.string()),
  },
  handler: async (ctx, { ragEntryIds }) => {
    console.log(`[enrichMetadata] 🔍 Buscando ${ragEntryIds.length} páginas...`);
    
    const enriched = [];
    
    for (let i = 0; i < ragEntryIds.length; i++) {
      const ragId = ragEntryIds[i];
      
      // Buscar página por ragEntryId
      const page = await ctx.db
        .query("ragPages")
        .withIndex("by_rag_entry", (q) => q.eq("ragEntryId", ragId))
        .first();
      
      if (!page) {
        console.log(`[enrichMetadata] ❌ No se encontró página con ragEntryId: "${ragId}"`);
        enriched.push(null);
        continue;
      }
      
      // Obtener documento asociado
      const document = await ctx.db.get(page.documentId);
      
      enriched.push({
        pageNumber: page.pageNumber,
        pageText: page.text,
        documentName: document?.filename || "Desconocido",
        documentId: page.documentId,
      });
    }
    
    console.log(`[enrichMetadata] ✅ Procesados ${enriched.length} resultados`);
    return enriched;
  },
});

// ============================================================
// BÚSQUEDA POR IMAGEN (usando vectorIndex)
// ============================================================

// Búsqueda por embedding de imagen en páginas
export const searchPagesByImage = action({
  args: {
    imageBase64: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { imageBase64, limit = 5 }): Promise<{ results: Array<{ pageId: any; documentId: any; pageNumber: number; similarity: number; imageUrl: string | null; documentName: string }> }> => {
    console.log(`[RAG:searchPagesByImage] 🖼️ Buscando páginas por imagen...`);
    
    // 1. Generar embedding de la imagen
    const { generateImageEmbedding } = await import("./rag");
    const queryEmbedding = await generateImageEmbedding(imageBase64, "query");
    
    // 2. Buscar en ragPages
    const results: Array<{ pageId: any; documentId: any; pageNumber: number; score: number }> = await ctx.runQuery(internal.rag.ragPages.searchByImageEmbedding, {
      embedding: queryEmbedding,
      limit,
    });
    
    // 3. Enriquecer con URLs de imágenes
    const enriched: Array<{ pageId: any; documentId: any; pageNumber: number; similarity: number; imageUrl: string | null; documentName: string }> = [];
    for (const result of results) {
      const imageUrl: string | null = await ctx.runQuery(internal.rag.ragPages.getImageUrlInternal, {
        pageId: result.pageId,
      });
      
      const doc = await ctx.runQuery(internal.rag.ragDocuments.getInternal, {
        documentId: result.documentId,
      });
      
      enriched.push({
        pageId: result.pageId,
        documentId: result.documentId,
        pageNumber: result.pageNumber,
        similarity: result.score,
        imageUrl,
        documentName: doc?.filename || "Desconocido",
      });
    }
    
    console.log(`[RAG:searchPagesByImage] ✅ ${enriched.length} resultados`);
    return { results: enriched };
  },
});

// Búsqueda por embedding de imagen en entidades
export const searchEntitiesByImage = action({
  args: {
    imageBase64: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { imageBase64, limit = 5 }): Promise<{ results: Array<{ entityId: any; name: string; similarity: number; imageUrl: string | null }> }> => {
    console.log(`[RAG:searchEntitiesByImage] 🖼️ Buscando entidades por imagen...`);
    
    // 1. Generar embedding de la imagen
    const { generateImageEmbedding } = await import("./rag");
    const queryEmbedding = await generateImageEmbedding(imageBase64, "query");
    
    // 2. Buscar en entityImages
    const results = await ctx.runQuery(internal.rag.entityImages.searchByImageEmbedding, {
      embedding: queryEmbedding,
      limit,
    });
    
    // 3. Enriquecer con URLs de imágenes
    const enriched: Array<{ entityId: any; name: string; similarity: number; imageUrl: string | null }> = [];
    for (const result of results) {
      const imageUrl: string | null = await ctx.runQuery(internal.rag.entityImages.getImageUrlInternal, {
        entityId: result.entityId,
      });
      
      enriched.push({
        entityId: result.entityId,
        name: result.entityName || "Sin nombre",
        similarity: result.score,
        imageUrl,
      });
    }
    
    console.log(`[RAG:searchEntitiesByImage] ✅ ${enriched.length} resultados`);
    return { results: enriched };
  },
});

// ============================================================
// BÚSQUEDA POR IMAGEN DEL USUARIO (usando fileId del mensaje)
// Esta es la función que usa la tool searchByImage
// ============================================================

/**
 * Busca productos similares usando la imagen que el usuario subió al chat
 * Obtiene la imagen desde el fileId → storageId → bytes → embedding
 */
export const searchByUserImage = action({
  args: {
    fileId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { fileId, limit = 5 }): Promise<{
    results: Array<{
      entityId: any;
      entityName: string | null;
      entityCode: string | null;
      description: string | null;
      price: number | null;
      pageNumber: number;
      documentName: string;
      similarity: number;
      imageUrl: string | null;
    }>;
  }> => {
    console.log(`[RAG:searchByUserImage] 🖼️ Buscando por fileId: ${fileId}`);
    
    try {
      // 1. Obtener información del archivo usando getFile del componente agent
      const { file } = await getFile(ctx, components.agent, fileId);
      
      if (!file || !file.storageId) {
        console.error(`[RAG:searchByUserImage] ❌ No se encontró storageId para fileId: ${fileId}`);
        throw new Error(`No se encontró el archivo con fileId: ${fileId}`);
      }
      
      console.log(`[RAG:searchByUserImage] ✅ storageId obtenido: ${file.storageId}`);
      
      // 2. Obtener los bytes de la imagen desde el storage
      const blob = await ctx.storage.get(file.storageId);
      
      if (!blob) {
        console.error(`[RAG:searchByUserImage] ❌ No se encontró blob en storage: ${file.storageId}`);
        throw new Error(`No se encontró la imagen en storage`);
      }
      
      console.log(`[RAG:searchByUserImage] ✅ Blob obtenido: ${blob.size} bytes, tipo: ${blob.type}`);
      
      // 3. Convertir blob a base64
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      // Convertir a base64 usando chunks para evitar stack overflow
      const CHUNK_SIZE = 8192;
      let binaryString = "";
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const base64 = btoa(binaryString);
      const mimeType = blob.type || "image/jpeg";
      const imageBase64 = `data:${mimeType};base64,${base64}`;
      
      console.log(`[RAG:searchByUserImage] ✅ Imagen convertida a base64 (${Math.round(base64.length / 1024)}KB)`);
      
      // 4. Generar embedding de la imagen
      const { generateImageEmbedding } = await import("./rag");
      const queryEmbedding = await generateImageEmbedding(imageBase64, "query");
      
      console.log(`[RAG:searchByUserImage] ✅ Embedding generado (${queryEmbedding.length} dims)`);
      
      // 5. Buscar en entityImages por similitud vectorial
      const vectorResults = await ctx.runQuery(internal.rag.entityImages.searchByImageEmbedding, {
        embedding: queryEmbedding,
        limit,
      });
      
      console.log(`[RAG:searchByUserImage] 📊 ${vectorResults.length} resultados de vector search`);
      
      if (vectorResults.length === 0) {
        return { results: [] };
      }
      
      // 6. Enriquecer resultados con metadata completa
      const enrichedResults = [];
      for (const result of vectorResults) {
        // Obtener URL de la imagen de la entidad
        const imageUrl = await ctx.runQuery(internal.rag.entityImages.getImageUrlInternal, {
          entityId: result.entityId,
        });
        
        // Obtener información del documento
        const doc = await ctx.runQuery(internal.rag.ragDocuments.getInternal, {
          documentId: result.documentId,
        });
        
        enrichedResults.push({
          entityId: result.entityId,
          entityName: result.entityName ?? null,
          entityCode: result.entityCode ?? null,
          description: result.description ?? null,
          price: result.price ?? null,
          pageNumber: result.pageNumber,
          documentName: doc?.filename || "Desconocido",
          similarity: result.score,
          imageUrl,
        });
      }
      
      console.log(`[RAG:searchByUserImage] ✅ ${enrichedResults.length} resultados enriquecidos`);
      
      return { results: enrichedResults };
      
    } catch (error) {
      console.error(`[RAG:searchByUserImage] ❌ Error:`, error);
      throw error;
    }
  },
});

// ============================================================
// ESTADÍSTICAS RAG
// ============================================================

export const getRAGStats = query({
  args: {},
  handler: async (ctx) => {
    const docs = await ctx.db.query("ragDocuments").collect();
    const pages = await ctx.db.query("ragPages").collect();
    const entities = await ctx.db.query("entityImages").collect();
    
    return {
      documents: {
        total: docs.length,
        completed: docs.filter(d => d.status === "completed").length,
        totalPages: docs.reduce((sum, d) => sum + d.pageCount, 0),
      },
      pages: {
        total: pages.length,
        withText: pages.filter(p => p.text && p.text.length > 0).length,
        withImage: pages.filter(p => p.imageStorageId).length,
        withImageEmbedding: pages.filter(p => p.imageEmbedding && p.imageEmbedding.length > 0).length,
        indexed: pages.filter(p => p.ragEntryId).length,
      },
      entities: {
        total: entities.length,
        withEmbedding: entities.filter(e => e.imageEmbedding && e.imageEmbedding.length > 0).length,
        withName: entities.filter(e => e.entityName).length,
      },
    };
  },
});

// ============================================================
// ACTIONS PARA EL SCRIPT DE PROCESAMIENTO
// Las variables de Azure están en el dashboard de Convex
// ============================================================

// Agregar contenido al índice RAG (devuelve el entryId para guardarlo)
export const addToIndex = action({
  args: {
    text: v.string(),
    documentId: v.string(),
    pageNumber: v.number(),
  },
  handler: async (ctx, { text, documentId, pageNumber }) => {
    console.log(`[RAG:addToIndex] 📥 Indexando página ${pageNumber} (doc: ${documentId})`);
    console.log(`[RAG:addToIndex] 📝 Texto: ${text.substring(0, 100)}...`);
    
    const startTime = Date.now();
    
    // rag.add devuelve el entryId del embedding creado
    const result = await rag.add(ctx, {
      namespace: RAG_NAMESPACE,
      text,
      // Usar key único para poder reemplazar si se reprocesa
      key: `${documentId}-page-${pageNumber}`,
      filterValues: [
        { name: "documentId", value: documentId },
        { name: "pageNumber", value: pageNumber.toString() },
      ],
    });
    
    const elapsed = Date.now() - startTime;
    console.log(`[RAG:addToIndex] ✅ Página indexada en ${elapsed}ms (entryId: ${result.entryId})`);
    
    // Devolver el entryId para que se guarde en la tabla ragPages
    return { entryId: result.entryId };
  },
});

// Generar embedding de imagen de página
export const generatePageImageEmbedding = action({
  args: {
    imageBase64: v.string(),
  },
  handler: async (ctx, { imageBase64 }) => {
    console.log(`[RAG:pageEmbed] 🖼️ Generando embedding de imagen de página...`);
    const { generateImageEmbedding } = await import("./rag");
    const embedding = await generateImageEmbedding(imageBase64, "document");
    console.log(`[RAG:pageEmbed] ✅ Embedding generado (${embedding.length} dims)`);
    return embedding;
  },
});

// Generar embedding de imagen de entidad
export const generateEntityImageEmbedding = action({
  args: {
    imageBase64: v.string(),
  },
  handler: async (ctx, { imageBase64 }) => {
    console.log(`[RAG:entityEmbed] 🖼️ Generando embedding de imagen de entidad...`);
    const { generateImageEmbedding } = await import("./rag");
    const embedding = await generateImageEmbedding(imageBase64, "document");
    console.log(`[RAG:entityEmbed] ✅ Embedding generado (${embedding.length} dims)`);
    return embedding;
  },
});

// Eliminar un embedding específico del RAG por su entryId
export const deleteFromIndex = action({
  args: {
    entryId: v.string(),
  },
  handler: async (ctx, { entryId }) => {
    console.log(`[RAG:delete] 🗑️ Eliminando entry: ${entryId}`);
    
    try {
      // Cast necesario porque el RAG usa branded types
      await rag.delete(ctx, { entryId: entryId as any });
      console.log(`[RAG:delete] ✅ Entry eliminado`);
      return { success: true };
    } catch (error) {
      console.error(`[RAG:delete] ❌ Error:`, error);
      return { success: false, error: String(error) };
    }
  },
});

// Eliminar todos los embeddings del namespace
export const deleteAllFromIndex = action({
  args: {},
  handler: async (ctx) => {
    console.log(`[RAG:deleteAll] 🗑️ Eliminando TODOS los embeddings del namespace...`);
    
    // Primero obtener el namespaceId
    const namespace = await rag.getNamespace(ctx, { namespace: RAG_NAMESPACE });
    
    if (!namespace) {
      console.log(`[RAG:deleteAll] ⚠️ Namespace no encontrado`);
      return { deletedCount: 0 };
    }
    
    let deletedCount = 0;
    let cursor: string | null = null;
    
    do {
      // Listar entries del namespace usando namespaceId
      const result = await rag.list(ctx, {
        namespaceId: namespace.namespaceId,
        paginationOpts: { numItems: 100, cursor },
      });
      
      console.log(`[RAG:deleteAll] 📋 Encontrados ${result.page.length} entries para eliminar`);
      
      if (result.page.length === 0) {
        break;
      }
      
      // Eliminar cada entry
      for (const entry of result.page) {
        try {
          await rag.delete(ctx, { entryId: entry.entryId });
          deletedCount++;
        } catch (error) {
          console.error(`[RAG:deleteAll] ⚠️ Error eliminando ${entry.entryId}:`, error);
        }
      }
      
      cursor = result.continueCursor;
    } while (cursor);
    
    console.log(`[RAG:deleteAll] 💾 Total embeddings eliminados: ${deletedCount}`);
    return { deletedCount };
  },
});

// ============================================================
// BÚSQUEDA POR IMAGEN DEL USUARIO (usando threadId automáticamente)
// Esta es la función que usa la tool searchByImage con useLatestUserImage
// ============================================================

/**
 * Busca productos similares usando la última imagen que el usuario subió al chat
 * Busca automáticamente en los mensajes del thread el fileId más reciente
 */
export const searchByLatestUserImage = action({
  args: {
    threadId: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, { threadId, limit = 5 }): Promise<{
    results: Array<{
      entityId: any;
      entityName: string | null;
      entityCode: string | null;
      description: string | null;
      price: number | null;
      pageNumber: number;
      documentName: string;
      similarity: number;
      imageUrl: string | null;
    }>;
    message: string;
  }> => {
    console.log(`[RAG:searchByLatestUserImage] 🔍 Buscando imagen en thread: ${threadId}`);
    
    try {
      // 1. Obtener mensajes recientes del thread
      const messagesResult = await listMessages(ctx, components.agent, {
        threadId,
        paginationOpts: { cursor: null, numItems: 20 },
      });
      
      console.log(`[RAG:searchByLatestUserImage] 📬 ${messagesResult.page.length} mensajes obtenidos`);
      
      // 2. Buscar el último mensaje del usuario que tenga fileIds
      let fileId: string | null = null;
      
      for (const msg of messagesResult.page) {
        const msgAny = msg as any;
        
        // Verificar que sea mensaje del usuario (no del asistente)
        if (msgAny.message?.role !== "user") {
          continue;
        }
        
        // fileIds está en el nivel raíz del documento del mensaje, NO en message.metadata
        // Estructura: { fileIds: [...], message: { role: "user", content: [...] }, ... }
        if (msgAny.fileIds && Array.isArray(msgAny.fileIds) && msgAny.fileIds.length > 0) {
          fileId = msgAny.fileIds[0]; // Tomar el primer fileId
          console.log(`[RAG:searchByLatestUserImage] ✅ fileId encontrado en raíz: ${fileId}`);
          break;
        }
        
        // Fallback: también revisar en metadata por si acaso
        const metadata = msgAny.message?.metadata;
        if (metadata?.fileIds && Array.isArray(metadata.fileIds) && metadata.fileIds.length > 0) {
          fileId = metadata.fileIds[0];
          console.log(`[RAG:searchByLatestUserImage] ✅ fileId encontrado en metadata: ${fileId}`);
          break;
        }
      }
      
      if (!fileId) {
        console.log(`[RAG:searchByLatestUserImage] ⚠️ No se encontró imagen en mensajes recientes`);
        return {
          results: [],
          message: "No se encontró ninguna imagen en los mensajes recientes del usuario.",
        };
      }
      
      // 3. Obtener información del archivo usando getFile
      const { file } = await getFile(ctx, components.agent, fileId);
      
      if (!file || !file.storageId) {
        console.error(`[RAG:searchByLatestUserImage] ❌ No se encontró storageId para fileId: ${fileId}`);
        return {
          results: [],
          message: `No se pudo acceder al archivo de imagen.`,
        };
      }
      
      console.log(`[RAG:searchByLatestUserImage] ✅ storageId obtenido: ${file.storageId}`);
      
      // 4. Obtener los bytes de la imagen desde el storage
      const blob = await ctx.storage.get(file.storageId);
      
      if (!blob) {
        console.error(`[RAG:searchByLatestUserImage] ❌ No se encontró blob en storage: ${file.storageId}`);
        return {
          results: [],
          message: `No se encontró la imagen en el almacenamiento.`,
        };
      }
      
      console.log(`[RAG:searchByLatestUserImage] ✅ Blob obtenido: ${blob.size} bytes, tipo: ${blob.type}`);
      
      // 5. Convertir blob a base64
      const arrayBuffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      
      // Convertir a base64 usando chunks para evitar stack overflow
      const CHUNK_SIZE = 8192;
      let binaryString = "";
      for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
        const chunk = bytes.subarray(i, Math.min(i + CHUNK_SIZE, bytes.length));
        binaryString += String.fromCharCode.apply(null, Array.from(chunk));
      }
      const base64 = btoa(binaryString);
      const mimeType = blob.type || "image/jpeg";
      const imageBase64 = `data:${mimeType};base64,${base64}`;
      
      console.log(`[RAG:searchByLatestUserImage] ✅ Imagen convertida a base64 (${Math.round(base64.length / 1024)}KB)`);
      
      // 6. Generar embedding de la imagen
      const { generateImageEmbedding } = await import("./rag");
      const queryEmbedding = await generateImageEmbedding(imageBase64, "query");
      
      console.log(`[RAG:searchByLatestUserImage] ✅ Embedding generado (${queryEmbedding.length} dims)`);
      
      // 7. Buscar en entityImages por similitud vectorial
      const vectorResults = await ctx.runQuery(internal.rag.entityImages.searchByImageEmbedding, {
        embedding: queryEmbedding,
        limit,
      });
      
      console.log(`[RAG:searchByLatestUserImage] 📊 ${vectorResults.length} resultados de vector search`);
      
      if (vectorResults.length === 0) {
        return {
          results: [],
          message: "No se encontraron productos similares en los documentos indexados.",
        };
      }
      
      // 8. Enriquecer resultados con metadata completa
      const enrichedResults = [];
      for (const result of vectorResults) {
        // Obtener URL de la imagen de la entidad
        const imageUrl = await ctx.runQuery(internal.rag.entityImages.getImageUrlInternal, {
          entityId: result.entityId,
        });
        
        // Obtener información del documento
        const doc = await ctx.runQuery(internal.rag.ragDocuments.getInternal, {
          documentId: result.documentId,
        });
        
        enrichedResults.push({
          entityId: result.entityId,
          entityName: result.entityName ?? null,
          entityCode: result.entityCode ?? null,
          description: result.description ?? null,
          price: result.price ?? null,
          pageNumber: result.pageNumber,
          documentName: doc?.filename || "Desconocido",
          similarity: result.score,
          imageUrl,
        });
      }
      
      console.log(`[RAG:searchByLatestUserImage] ✅ ${enrichedResults.length} resultados enriquecidos`);
      
      return {
        results: enrichedResults,
        message: `Se encontraron ${enrichedResults.length} productos similares.`,
      };
      
    } catch (error) {
      console.error(`[RAG:searchByLatestUserImage] ❌ Error:`, error);
      return {
        results: [],
        message: `Error en búsqueda por imagen: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});

