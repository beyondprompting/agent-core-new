// convex/ragTools.ts
// RAG tools for agent - Document search
import { createTool } from "@convex-dev/agent";
import { z } from "zod/v3";
import { api, internal } from "../_generated/api";

// ============================================================
// TOOL: searchDocuments (búsqueda por TEXTO)
// ============================================================

/**
 * Tool for searching indexed documents using semantic search
 */
export const searchDocumentsTool = createTool({
  description: `Searches indexed documents using semantic TEXT search. 
Use this tool when the user asks about:
- Specific products BY NAME or description
- Product prices
- Product characteristics
- Content from documents or catalogs
- Offers or promotions

DO NOT use this tool when:
- The user sends an IMAGE to find similar products (use searchByImage instead)
- The user wants help with their brief task (no RAG needed)

The search is semantic, so you can search for related concepts.`,
  
  args: z.object({
    query: z.string().describe("The search query. Be specific about what you're looking for."),
    limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  }),
  
  handler: async (ctx, args): Promise<{
    results: Array<{
      document: string;
      page: number | undefined;
      text: string;
      score: number;
    }>;
    message: string;
  }> => {
    console.log(`[Tool:searchDocuments] 🔍 Query: "${args.query}"`);
    
    try {
      const searchResults = await ctx.runAction(api.rag.ragSearch.searchByTextEnriched, {
        query: args.query,
        limit: args.limit ?? 5,
      });
      
      console.log(`[Tool:searchDocuments] ✅ ${searchResults.total} results found`);
      
      const formattedResults = searchResults.resultados.map((r: { documento: string; pagina: number | undefined; score: number; textoCompleto: string; text: string }, idx: number) => {
        console.log(`[Tool:searchDocuments] 📄 Result ${idx + 1}:`, {
          document: r.documento,
          page: r.pagina,
          score: r.score,
        });
        
        return {
          document: r.documento,
          page: r.pagina ?? 0,
          text: r.textoCompleto || r.text || "",
          score: r.score,
        };
      });
      
      return {
        results: formattedResults,
        message: `Found ${searchResults.total} results in documents.`,
      };
    } catch (error) {
      console.error(`[Tool:searchDocuments] ❌ Error:`, error);
      return {
        results: [],
        message: `Search error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});

// ============================================================
// TOOL: searchEntities
// ============================================================

/**
 * Tool for searching specific entities by code
 */
export const searchEntitiesTool = createTool({
  description: `Searches for specific entities (products, items) by their code.
Use this tool when the user mentions a specific product code.`,
  
  args: z.object({
    entityCode: z.string().describe("The entity code to search for"),
  }),
  
  handler: async (ctx, args): Promise<{
    found: boolean;
    entity: {
      name: string | null;
      code: string | null;
      description: string | null;
      price: number | null;
      page: number;
    } | null;
  }> => {
    console.log(`[Tool:searchEntities] 🔍 Code: "${args.entityCode}"`);
    
    try {
      const results = await ctx.runQuery(api.rag.entityImages.getByEntityCode, {
        entityCode: args.entityCode,
      });
      
      if (results.length === 0) {
        console.log(`[Tool:searchEntities] ❌ Not found`);
        return { found: false, entity: null };
      }
      
      const entityResult = results[0];
      console.log(`[Tool:searchEntities] ✅ Found:`, entityResult.entityName);
      
      return {
        found: true,
        entity: {
          name: entityResult.entityName ?? null,
          code: entityResult.entityCode ?? null,
          description: entityResult.description ?? null,
          price: entityResult.price ?? null,
          page: entityResult.pageNumber,
        },
      };
    } catch (error) {
      console.error(`[Tool:searchEntities] ❌ Error:`, error);
      return { found: false, entity: null };
    }
  },
});

// ============================================================
// TOOL: getRAGStatistics
// ============================================================

/**
 * Tool for getting RAG system statistics
 */
export const getRAGStatisticsTool = createTool({
  description: `Gets RAG system statistics.
Use this tool when the user asks about:
- How many documents are indexed
- How many pages have been processed
- General state of the search system`,
  
  args: z.object({}),
  
  handler: async (ctx): Promise<{
    documents: {
      total: number;
      completed: number;
      totalPages: number;
    };
    pages: {
      total: number;
      withText: number;
      withImage: number;
      indexed: number;
    };
    entities: {
      total: number;
      withEmbedding: number;
      withName: number;
    };
  }> => {
    console.log(`[Tool:getRAGStatistics] 📊 Getting statistics...`);
    
    try {
      const stats = await ctx.runQuery(api.rag.ragSearch.getRAGStats, {});
      
      console.log(`[Tool:getRAGStatistics] ✅ Stats retrieved`);
      
      return {
        documents: {
          total: stats.documents.total,
          completed: stats.documents.completed,
          totalPages: stats.documents.totalPages,
        },
        pages: {
          total: stats.pages.total,
          withText: stats.pages.withText,
          withImage: stats.pages.withImage,
          indexed: stats.pages.indexed,
        },
        entities: {
          total: stats.entities.total,
          withEmbedding: stats.entities.withEmbedding,
          withName: stats.entities.withName,
        },
      };
    } catch (error) {
      console.error(`[Tool:getRAGStatistics] ❌ Error:`, error);
      throw error;
    }
  },
});

// ============================================================
// TOOL: searchByImage (búsqueda por IMAGEN)
// ============================================================

/**
 * Tool for searching products/entities by visual similarity using an image
 * This tool uses the fileId from the user's message to find similar products
 */
export const searchByImageTool = createTool({
  description: `Searches for similar products/entities using IMAGE visual similarity.

WHEN TO USE THIS TOOL:
- The user sends an IMAGE and asks to find similar products
- The user wants to identify a product from a photo
- The user asks "what is this?" or "find this product" with an image
- The user wants to find where a product appears in catalogs
- The user asks "in which magazine/catalog is this product?"

WHEN NOT TO USE THIS TOOL:
- The user sends an image for their BRIEF task (use that image for the task, not for search)
- The user is describing what they want in text (use searchDocuments instead)
- The user is not asking to find or identify a product from an image

HOW TO USE:
- Set useLatestUserImage to true to automatically use the image from the user's latest message
- This is the RECOMMENDED way to use this tool`,
  
  args: z.object({
    useLatestUserImage: z.boolean().describe("Set to true to use the image from the user's latest message. This is the recommended approach."),
    limit: z.number().optional().describe("Maximum number of results (default: 5)"),
  }),
  
  handler: async (ctx, args): Promise<{
    results: Array<{
      entityName: string | null;
      entityCode: string | null;
      description: string | null;
      price: number | null;
      page: number;
      document: string;
      similarity: number;
    }>;
    message: string;
  }> => {
    console.log(`[Tool:searchByImage] 🖼️ useLatestUserImage: ${args.useLatestUserImage}`);
    
    try {
      // Get threadId from context (provided by the agent via @convex-dev/agent)
      const threadId = ctx.threadId;
      
      if (!threadId) {
        console.error(`[Tool:searchByImage] ❌ No threadId in context`);
        return {
          results: [],
          message: "Error: No se pudo obtener el thread actual.",
        };
      }
      
      console.log(`[Tool:searchByImage] 📍 ThreadId: ${threadId}`);
      
      // Call the action that handles the image search
      const searchResults = await ctx.runAction(api.rag.ragSearch.searchByLatestUserImage, {
        threadId,
        limit: args.limit ?? 5,
      });
      
      console.log(`[Tool:searchByImage] ✅ ${searchResults.results.length} results found`);
      
      const formattedResults = searchResults.results.map((r: any, idx: number) => {
        console.log(`[Tool:searchByImage] 📷 Result ${idx + 1}:`, {
          name: r.entityName,
          code: r.entityCode,
          page: r.pageNumber,
          document: r.documentName,
          similarity: r.similarity,
        });
        
        return {
          entityName: r.entityName,
          entityCode: r.entityCode,
          description: r.description,
          price: r.price,
          page: r.pageNumber,
          document: r.documentName,
          similarity: r.similarity,
        };
      });
      
      if (formattedResults.length === 0) {
        return {
          results: [],
          message: searchResults.message || "No similar products found in the indexed documents.",
        };
      }
      
      return {
        results: formattedResults,
        message: `Found ${formattedResults.length} visually similar products.`,
      };
    } catch (error) {
      console.error(`[Tool:searchByImage] ❌ Error:`, error);
      return {
        results: [],
        message: `Image search error: ${error instanceof Error ? error.message : "Unknown error"}`,
      };
    }
  },
});
