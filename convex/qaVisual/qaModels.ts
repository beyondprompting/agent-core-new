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
