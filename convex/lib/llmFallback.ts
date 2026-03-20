// convex/lib/llmFallback.ts
// Sistema de fallback para LLMs: Gemini -> OpenAI GPT
// Si Gemini falla, automáticamente usa GPT-5.2 como respaldo

import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

// ==================== TIPOS ====================

export type LLMProvider = "gemini" | "openai";

export interface LLMConfig {
  provider: LLMProvider;
  model: LanguageModel;
  modelId: string;
  providerOptions?: Record<string, unknown>;
}

export interface LLMError {
  provider: LLMProvider;
  model: string;
  errorType: "rate_limit" | "high_demand" | "timeout" | "unknown";
  errorMessage: string;
  timestamp: number;
}

export interface LLMHealthCheckResult {
  provider: LLMProvider;
  available: boolean;
  reason?: string;
}

// ==================== CONFIGURACIÓN DE MODELOS ====================

// Modelo principal: Gemini 3 Pro Preview
export const geminiConfig: LLMConfig = {
  provider: "gemini",
  model: google("gemini-3.1-pro-preview"),
  modelId: "gemini-3.1-pro-preview",
  providerOptions: {
    google: {
      thinkingConfig: {
        thinkingLevel: "low", // Reducir latencia
      },
    },
  },
};

// Modelo fallback: OpenAI GPT-5.2
export const openaiConfig: LLMConfig = {
  provider: "openai",
  model: openai("gpt-5.2"),
  modelId: "gpt-5.2",
  providerOptions: undefined,
};

// ==================== UTILIDADES ====================

/**
 * Clasifica el tipo de error basándose en el mensaje
 */
export function classifyError(error: unknown): LLMError["errorType"] {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();
  
  if (lowerMessage.includes("high demand") || lowerMessage.includes("rate limit") || lowerMessage.includes("quota")) {
    return "rate_limit";
  }
  if (lowerMessage.includes("experiencing high demand") || lowerMessage.includes("overloaded")) {
    return "high_demand";
  }
  if (lowerMessage.includes("timeout") || lowerMessage.includes("timed out")) {
    return "timeout";
  }
  return "unknown";
}

/**
 * Extrae el mensaje de error de forma segura
 */
export function extractErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Determina si un error es recuperable (vale la pena hacer fallback)
 */
export function isRecoverableError(error: unknown): boolean {
  const errorType = classifyError(error);
  // Todos estos errores son recuperables con un fallback
  return ["rate_limit", "high_demand", "timeout"].includes(errorType);
}

// ==================== OBTENER CONFIGURACIÓN ====================

/**
 * Obtiene la configuración del modelo primario (Gemini)
 */
export function getPrimaryConfig(): LLMConfig {
  return geminiConfig;
}

/**
 * Obtiene la configuración del modelo fallback (OpenAI)
 */
export function getFallbackConfig(): LLMConfig {
  return openaiConfig;
}

/**
 * Log helper para debugging
 */
export function logLLMAttempt(provider: LLMProvider, model: string, success: boolean, durationMs?: number) {
  const status = success ? "✅" : "❌";
  const duration = durationMs ? ` (${durationMs}ms)` : "";
  console.log(`[LLM] ${status} ${provider}/${model}${duration}`);
}
