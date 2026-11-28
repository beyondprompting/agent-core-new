import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import type { LLMConfig, LLMProvider } from "../lib/llmFallback";

/**
 * Models used only by QA Visual (§9.7). The brief agent keeps its own shared configuration in
 * convex/lib/llmFallback.ts; changing these values never affects it. Both IDs can be adjusted
 * per environment once the quotas of the chosen models are confirmed.
 */
const geminiModelId = process.env.QA_VISUAL_GEMINI_MODEL?.trim() || "gemini-3.7-flash";
const openaiModelId = process.env.QA_VISUAL_OPENAI_MODEL?.trim() || "gpt-6-luna";
const google = createGoogleGenerativeAI();

export const qaGemini: LLMConfig = {
  provider: "gemini",
  model: google(geminiModelId),
  modelId: geminiModelId,
  providerOptions: { google: { thinkingConfig: { thinkingLevel: "low" } } },
};

export const qaOpenAI: LLMConfig = {
  provider: "openai",
  model: openai(openaiModelId),
  modelId: openaiModelId,
  providerOptions: { openai: { store: false } },
};

export const qaModel = (provider: LLMProvider) =>
  provider === "gemini" ? qaGemini : qaOpenAI;

/**
 * Model that proposes fixes of the production CSV (§5.5). Separate from the analysis models so
 * changing one never affects the other. It only ever receives the CSV rows and the file names.
 */
const csvFixModelId =
  process.env.QA_VISUAL_CSV_FIX_MODEL?.trim() || "gemini-3.8-flash";

export const qaCsvFixer: LLMConfig = {
  provider: "gemini",
  model: google(csvFixModelId),
  modelId: csvFixModelId,
};
