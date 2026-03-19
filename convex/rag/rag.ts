// convex/rag.ts
// Configuración del componente RAG con Cohere embed-v-4-0 en Azure AI Foundry
// Modelo multimodal con 1536 dimensiones
// 
// ENDPOINTS CORRECTOS:
// - Texto: POST {base}/models/embeddings?api-version=2024-05-01-preview
// - Imagen: POST {base}/models/images/embeddings?api-version=2024-05-01-preview
//
// 3 TIPOS DE EMBEDDINGS:
// 1. Texto de páginas → namespace "rag-documents"
// 2. Imágenes de páginas → almacenados en tabla ragPages.imageEmbedding
// 3. Entidades → namespace "entities" + tabla entityImages.imageEmbedding

import { components } from "../_generated/api";
import { RAG } from "@convex-dev/rag";

console.log("[RAG:config] 🔧 Inicializando configuración RAG...");

// Azure AI Foundry - Cohere Embed v4
const AZURE_EMBED_ENDPOINT = process.env.AZURE_EMBED_ENDPOINT || "";
const AZURE_EMBED_API_KEY = process.env.AZURE_EMBED_API_KEY || "";
const EMBED_MODEL = "embed-v-4-0";
const EMBED_DIMENSION = 1536;
const API_VERSION = "2024-05-01-preview";

console.log(`[RAG:config] 🔑 Azure Embed API Key: ${AZURE_EMBED_API_KEY ? "✅ configurada" : "❌ NO CONFIGURADA"}`);
console.log(`[RAG:config] 🌐 Azure Embed Endpoint: ${AZURE_EMBED_ENDPOINT || "NO CONFIGURADO"}`);
console.log(`[RAG:config] 🤖 Modelo: ${EMBED_MODEL} (${EMBED_DIMENSION} dimensiones)`);

// ============================================================
// FUNCIONES DE EMBEDDING
// ============================================================

/**
 * Genera embeddings de TEXTO usando Cohere embed-v-4-0
 * Endpoint: /models/embeddings
 */
export async function generateTextEmbeddings(
  texts: string[], 
  inputType: "document" | "query" = "document"
): Promise<number[][]> {
  if (!AZURE_EMBED_ENDPOINT || !AZURE_EMBED_API_KEY) {
    throw new Error("Azure Embed endpoint o API key no configurados. Configura AZURE_EMBED_ENDPOINT y AZURE_EMBED_API_KEY en las variables de entorno de Convex.");
  }

  const url = `${AZURE_EMBED_ENDPOINT}/models/embeddings?api-version=${API_VERSION}`;
  
  console.log(`[RAG:textEmbed] 📤 POST ${url}`);
  console.log(`[RAG:textEmbed] 📝 ${texts.length} texto(s), input_type: ${inputType}`);
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AZURE_EMBED_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: texts,
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[RAG:textEmbed] ❌ Error: ${response.status} - ${errorText}`);
    throw new Error(`Azure text embeddings error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const embeddings = data.data
    .sort((a: any, b: any) => a.index - b.index)
    .map((item: any) => item.embedding);
  
  console.log(`[RAG:textEmbed] ✅ ${embeddings.length} embeddings (${embeddings[0]?.length} dims)`);
  return embeddings;
}

/**
 * Genera embeddings de IMAGEN usando Cohere embed-v-4-0
 * Endpoint: /models/images/embeddings
 * @param imageBase64 - Imagen en base64 con formato data:image/png;base64,...
 */
export async function generateImageEmbedding(
  imageBase64: string,
  inputType: "document" | "query" = "document"
): Promise<number[]> {
  if (!AZURE_EMBED_ENDPOINT || !AZURE_EMBED_API_KEY) {
    throw new Error("Azure Embed endpoint o API key no configurados.");
  }

  const url = `${AZURE_EMBED_ENDPOINT}/models/images/embeddings?api-version=${API_VERSION}`;
  
  console.log(`[RAG:imageEmbed] 📤 POST ${url}`);
  console.log(`[RAG:imageEmbed] 🖼️ input_type: ${inputType}`);
  
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AZURE_EMBED_API_KEY}`,
    },
    body: JSON.stringify({
      model: EMBED_MODEL,
      input: [{ image: imageBase64 }],
      input_type: inputType,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[RAG:imageEmbed] ❌ Error: ${response.status} - ${errorText}`);
    throw new Error(`Azure image embeddings error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  const embedding = data.data[0].embedding;
  
  console.log(`[RAG:imageEmbed] ✅ Embedding generado (${embedding.length} dims)`);
  return embedding;
}

// ============================================================
// MODELO DE EMBEDDINGS PARA RAG COMPONENT
// ============================================================

// Modelo para indexar documentos (input_type: "document")
const cohereEmbeddingModel = {
  specificationVersion: "v2" as const,
  modelId: `azure:${EMBED_MODEL}`,
  provider: "azure.cohere.embeddings",
  maxEmbeddingsPerCall: 96,
  supportsParallelCalls: true,
  
  async doEmbed({ values }: { values: string[] }) {
    console.log(`[RAG:model] 🔄 Generando embeddings para ${values.length} texto(s)...`);
    const embeddings = await generateTextEmbeddings(values, "document");
    return {
      embeddings,
      usage: { tokens: values.reduce((sum, t) => sum + t.length / 4, 0) },
    };
  },
};

// Modelo para queries de búsqueda (input_type: "query")
export const cohereQueryEmbeddingModel = {
  ...cohereEmbeddingModel,
  modelId: `azure:${EMBED_MODEL}:query`,
  
  async doEmbed({ values }: { values: string[] }) {
    console.log(`[RAG:query] 🔍 Generando embedding para query...`);
    const embeddings = await generateTextEmbeddings(values, "query");
    return {
      embeddings,
      usage: { tokens: values.reduce((sum, t) => sum + t.length / 4, 0) },
    };
  },
};

// ============================================================
// INSTANCIA RAG
// ============================================================

export const rag = new RAG(components.rag, {
  textEmbeddingModel: cohereEmbeddingModel as any,
  embeddingDimension: EMBED_DIMENSION,
  filterNames: ["documentId", "pageNumber"],
});

console.log(`[RAG:config] ✅ RAG configurado con Cohere ${EMBED_MODEL} (${EMBED_DIMENSION} dims)`);

export default rag;
