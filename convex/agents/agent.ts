// convex/agent.ts
// Agente principal para recolección de Brief
import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { google } from "@ai-sdk/google";
import { createTaskTool, reviewBriefTool, editTaskTool, getTaskTool, nowTool, getTaskFromCORTool } from "../data/tasks";
import { agentConfig, getBriefAgentInstructions } from "../lib/serverConfig";
import { searchDocumentsTool, searchEntitiesTool, getRAGStatisticsTool, searchByImageTool } from "../rag/ragTools";

// Gemini model (thinking config is passed in providerOptions)
const languageModel = google("gemini-3-pro-preview");

// ==================== MAIN AGENT: Brief Collector ====================

export const briefAgent = new Agent(components.agent, {
  name: agentConfig.brief.name,
  instructions: getBriefAgentInstructions(),
  
  languageModel,
  
  tools: {
    createTask: createTaskTool,
    reviewBrief: reviewBriefTool,
    editTask: editTaskTool,
    getTask: getTaskTool,
    getTaskFromCOR: getTaskFromCORTool,
    now: nowTool,
    // RAG tools for document search
    searchDocuments: searchDocumentsTool,
    searchEntities: searchEntitiesTool,
    getRAGStatistics: getRAGStatisticsTool,
    // Image search tool - uses visual similarity
    searchByImage: searchByImageTool,
  },
  
  maxSteps: 15,
});
