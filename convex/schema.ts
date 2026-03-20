// convex/schema.ts
import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  ...authTables,

  // Workspaces - uno por usuario
  workspaces: defineTable({
    ownerId: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"]),

  // Preferencias de usuario (theme, etc.)
  preferences: defineTable({
    userId: v.id("users"),
    theme: v.optional(v.union(v.literal("light"), v.literal("dark"), v.literal("system"))),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"]),

  // Registro de threads de chat del usuario (para diferenciar de threads de evaluación)
  // Esta tabla complementa la tabla threads del agent component para lógica de negocio
  chatThreads: defineTable({
    threadId: v.string(),
    userId: v.id("users"),
    workspaceId: v.id("workspaces"),
    title: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_user", ["userId"])
    .index("by_workspace", ["workspaceId"])
    .index("by_user_and_updated", ["userId", "updatedAt"]),

  tasks: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    requestType: v.string(),
    brand: v.string(),
    objective: v.optional(v.string()),
    keyMessage: v.optional(v.string()),
    kpis: v.optional(v.string()),
    deadline: v.optional(v.string()),
    budget: v.optional(v.string()),
    approvers: v.optional(v.string()),
    status: v.string(),
    priority: v.optional(v.string()),
    threadId: v.string(),
    fileIds: v.optional(v.array(v.string())),
    createdBy: v.optional(v.string()),
    // Campos para sincronización con herramienta externa (COR, Trello, etc.)
    corTaskId: v.optional(v.string()), // ID de la task en el sistema externo
    corProjectId: v.optional(v.number()), // ID del proyecto en el sistema externo donde se creó
    corSyncStatus: v.optional(v.string()), // "pending" | "syncing" | "synced" | "error"
    corSyncError: v.optional(v.string()), // Mensaje de error si falló la sincronización
    corSyncedAt: v.optional(v.number()), // Timestamp de la última sincronización exitosa
    // Campos para identificar el cliente en el sistema externo
    corClientId: v.optional(v.number()), // ID del cliente encontrado en COR/externo
    corClientName: v.optional(v.string()), // Nombre del cliente tal como está en COR/externo
  })
    .index("by_thread", ["threadId"])
    .index("by_status", ["status"])
    .index("by_createdBy", ["createdBy"])
    .index("by_corTaskId", ["corTaskId"])
    .index("by_corSyncStatus", ["corSyncStatus"]),

  evaluationThreads: defineTable({
    taskId: v.id("tasks"),
    originalThreadId: v.string(),
    evaluationThreadId: v.string(),
    status: v.string(), // "pending" | "in_progress" | "completed"
    createdAt: v.number(),
  })
    .index("by_task", ["taskId"])
    .index("by_evaluation_thread", ["evaluationThreadId"]),

  // Registro de errores de LLM para monitoreo y debugging
  llmErrors: defineTable({
    provider: v.string(), // "gemini" | "openai"
    model: v.string(), // "gemini-3.1-pro-preview" | "gpt-5.2"
    agentName: v.string(), // "briefAgent" | "reviewerAgent" | "evaluatorAgent"
    errorType: v.string(), // "rate_limit" | "high_demand" | "timeout" | "unknown"
    errorMessage: v.string(),
    threadId: v.optional(v.string()),
    timestamp: v.number(),
    resolved: v.boolean(), // Si se resolvió con fallback
    fallbackUsed: v.optional(v.string()), // El modelo fallback que se usó
  })
    .index("by_provider", ["provider"])
    .index("by_timestamp", ["timestamp"])
    .index("by_agent", ["agentName"]),

  // Configuración de LLM para testing de fallback
  // Permite desactivar proveedores manualmente para testing
  llmConfig: defineTable({
    provider: v.string(), // "gemini" | "openai"
    enabled: v.boolean(), // true = activo, false = simular caída
    updatedAt: v.number(),
    updatedBy: v.optional(v.string()),
  })
    .index("by_provider", ["provider"]),

  // =====================================================
  // RAG - Tablas para búsqueda en documentos
  // =====================================================

  // RAG Documents - Revistas y documentos indexados
  ragDocuments: defineTable({
    filename: v.string(),
    pageCount: v.number(),
    processedAt: v.number(),
    status: v.union(
      v.literal("pending"),
      v.literal("processing"),
      v.literal("completed"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_filename", ["filename"]),

  // RAG Pages - Páginas de documentos con embeddings
  ragPages: defineTable({
    documentId: v.id("ragDocuments"),
    pageNumber: v.number(),
    text: v.string(),
    imageStorageId: v.optional(v.id("_storage")),
    imageEmbedding: v.optional(v.array(v.float64())),
    ragEntryId: v.optional(v.string()), // Referencia al RAG component
  })
    .index("by_document", ["documentId"])
    .index("by_document_page", ["documentId", "pageNumber"])
    .index("by_rag_entry", ["ragEntryId"])
    .vectorIndex("by_image_embedding", {
      vectorField: "imageEmbedding",
      dimensions: 1536,
      filterFields: ["documentId"],
    }),

  // RAG Entity Images - Imágenes de entidades (productos, personas, etc.) extraídas
  // Para búsqueda visual multimodal con Cohere embed-v-4-0
  entityImages: defineTable({
    documentId: v.id("ragDocuments"),
    pageNumber: v.number(),
    imageStorageId: v.id("_storage"),
    imageEmbedding: v.optional(v.array(v.float64())),
    // Información de la entidad (extraída o manual)
    entityName: v.optional(v.string()),
    entityCode: v.optional(v.string()),
    description: v.optional(v.string()),
    price: v.optional(v.number()),
    // Metadatos
    createdAt: v.number(),
    ragEntryId: v.optional(v.string()),
  })
    .index("by_document", ["documentId"])
    .index("by_page", ["documentId", "pageNumber"])
    .index("by_entity_code", ["entityCode"])
    .vectorIndex("by_image_embedding", {
      vectorField: "imageEmbedding",
      dimensions: 1536,
      filterFields: ["documentId", "pageNumber"],
    }),
});
