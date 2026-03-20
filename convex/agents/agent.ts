// convex/agent.ts
// Agente principal para recolección de Brief
import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { google } from "@ai-sdk/google";
import { createTaskTool, reviewBriefTool, editTaskTool, getTaskTool, nowTool, getTaskFromCORTool, searchClientInCORTool } from "../data/tasks";
import { agentConfig, getBriefAgentInstructions } from "../lib/serverConfig";
import { isProjectManagementEnabled } from "../integrations/registry";
import { searchDocumentsTool, searchEntitiesTool, getRAGStatisticsTool, searchByImageTool } from "../rag/ragTools";

// Gemini model (thinking config is passed in providerOptions)
const languageModel = google("gemini-3.1-pro-preview");

// ==================== MAIN AGENT: Brief Collector ====================

// Build tools object — conditionally include integration-specific tools
const agentTools: Record<string, any> = {
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
};

// Conditionally add integration-specific tools
if (isProjectManagementEnabled()) {
  agentTools.searchClientInCOR = searchClientInCORTool;
}

export const briefAgent = new Agent(components.agent, {
  name: agentConfig.brief.name,
  instructions: getBriefAgentInstructions(),
  
  languageModel,
  
  tools: agentTools,
  
  maxSteps: 15,
});
