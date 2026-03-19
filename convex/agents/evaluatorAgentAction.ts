"use node";

// convex/evaluatorAgentAction.ts
// Agente evaluador para comparar producto final con requerimiento original
// IMPORTANTE: Este archivo usa Node.js runtime (512MB) en vez de Convex runtime (64MB)
import { Agent, createTool, listMessages } from "@convex-dev/agent";
import { components, internal } from "../_generated/api";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { z } from "zod";
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { agentConfig, getEvaluatorAgentInstructions } from "../lib/serverConfig";
import { 
  classifyError, 
  extractErrorMessage,
  logLLMAttempt 
} from "../lib/llmFallback";

// Usar modelo flash que es más eficiente en memoria
const languageModel = google("gemini-3-pro-preview");

// Tool para obtener la información de la task del thread
const getTaskInfoTool = createTool({
  description: `Obtener la información del requerimiento original (task/brief) asociado a este thread.
  Usar esta herramienta para conocer qué solicitó el usuario originalmente.`,
  args: z.object({
    taskId: z.string().optional().describe("ID de la task (opcional, se busca en el contexto si no se proporciona)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const threadId = ctx.threadId;
    
    console.log(`[EvaluatorTool] Buscando task. ThreadId: ${threadId}, TaskId arg: ${args.taskId}`);
    
    // Primero intentar obtener el taskId de los mensajes recientes
    // OPTIMIZACIÓN: Solo cargar 10 mensajes en vez de 20 para reducir memoria
    const messagesResult = await listMessages(ctx, components.agent, {
      threadId: threadId || "",
      paginationOpts: { cursor: null, numItems: 10 },
    });
    
    let taskIdToUse = args.taskId;
    
    // Buscar el taskId en el texto de los mensajes (formato: "Task ID: xxx")
    if (!taskIdToUse) {
      for (const msg of messagesResult.page) {
        const msgAny = msg as any;
        // Buscar en el contenido del mensaje
        if (msgAny.message?.content && Array.isArray(msgAny.message.content)) {
          for (const part of msgAny.message.content) {
            if (part.type === "text" && part.text) {
              const match = part.text.match(/Task ID:\s*([a-z0-9]+)/i);
              if (match) {
                taskIdToUse = match[1];
                console.log(`[EvaluatorTool] TaskId encontrado en texto: ${taskIdToUse}`);
                break;
              }
            }
          }
        }
        if (taskIdToUse) break;
      }
    }
    
    if (!taskIdToUse) {
      return "Error: No se pudo identificar el taskId. Por favor verifica que el mensaje incluya la información de la task.";
    }
    
    // Buscar la task por ID usando la query en el otro archivo
    const task = await ctx.runQuery(internal.data.evaluatorQueries.getTaskByIdInternal, {
      taskId: taskIdToUse,
    });
    
    if (!task) {
      return "No se encontró ningún requerimiento/task con ese ID.";
    }
    
    console.log(`[EvaluatorTool] Task encontrada: ${task._id}`);
    
    return `INFORMACIÓN DEL REQUERIMIENTO ORIGINAL:

ID: ${task._id}
Título: ${task.title}
Tipo de Requerimiento: ${task.requestType}
Marca: ${task.brand}
Objetivo: ${task.objective || "No especificado"}
Mensaje Clave: ${task.keyMessage || "No especificado"}
KPIs: ${task.kpis || "No especificado"}
Fecha límite: ${task.deadline || "No especificado"}
Presupuesto: ${task.budget || "No especificado"}
Aprobadores: ${task.approvers || "No especificado"}
Descripción detallada: ${task.description || "No especificado"}
Archivos de referencia adjuntos: ${task.fileIds && task.fileIds.length > 0 ? `Sí (${task.fileIds.length} archivo(s))` : "No"}
Estado actual: ${task.status}
Prioridad: ${task.priority || "media"}
Thread ID original: ${task.threadId}`;
  },
});

// Tool para obtener las imágenes de referencia del requerimiento original
const getOriginalReferenceImagesTool = createTool({
  description: `Obtener información sobre las imágenes de referencia del requerimiento original.
  Esta herramienta solo cuenta las imágenes, no las carga en memoria.`,
  args: z.object({
    briefThreadId: z.string().optional().describe("ID del thread del brief original (opcional)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    const threadId = ctx.threadId;
    
    console.log(`[EvaluatorTool] Buscando imágenes de referencia`);
    
    // Primero obtener el briefThreadId de los mensajes del thread actual
    // OPTIMIZACIÓN: Solo cargar 5 mensajes para buscar el ID
    const currentMessages = await listMessages(ctx, components.agent, {
      threadId: threadId || "",
      paginationOpts: { cursor: null, numItems: 5 },
    });
    
    let briefThreadId = args.briefThreadId;
    
    // Buscar el briefThreadId en el texto de los mensajes
    if (!briefThreadId) {
      for (const msg of currentMessages.page) {
        const msgAny = msg as any;
        if (msgAny.message?.content && Array.isArray(msgAny.message.content)) {
          for (const part of msgAny.message.content) {
            if (part.type === "text" && part.text) {
              const match = part.text.match(/Brief Thread ID:\s*([a-z0-9]+)/i);
              if (match) {
                briefThreadId = match[1];
                console.log(`[EvaluatorTool] BriefThreadId encontrado: ${briefThreadId}`);
                break;
              }
            }
          }
        }
        if (briefThreadId) break;
      }
    }
    
    if (!briefThreadId) {
      return "Error: No se pudo identificar el thread del brief original.";
    }
    
    // OPTIMIZACIÓN: Obtener solo los primeros 10 mensajes del thread original
    // para contar imágenes sin cargar todo en memoria
    const messagesResult = await listMessages(ctx, components.agent, {
      threadId: briefThreadId,
      paginationOpts: { cursor: null, numItems: 10 },
    });
    
    let imageCount = 0;
    
    for (const msg of messagesResult.page) {
      const msgAny = msg as any;
      // Contar imágenes sin almacenar su contenido
      if (msgAny.message?.content && Array.isArray(msgAny.message.content)) {
        for (const part of msgAny.message.content) {
          if (part.type === "image" || part.type === "file") {
            imageCount++;
          }
        }
      }
    }
    
    if (imageCount === 0) {
      return "No se encontraron imágenes de referencia en el requerimiento original.";
    }
    
    return `Se encontraron ${imageCount} archivo(s) de referencia del requerimiento original.
Nota: Las imágenes del producto final a evaluar deben ser enviadas directamente en el mensaje.`;
  },
});

// ==================== AGENTE EVALUADOR ====================

export const evaluatorAgent = new Agent(components.agent, {
  name: agentConfig.evaluator.name,
  instructions: getEvaluatorAgentInstructions(),
  
  languageModel,
  
  tools: {
    getTaskInfo: getTaskInfoTool,
    getOriginalReferenceImages: getOriginalReferenceImagesTool,
  },
  
  maxSteps: 8,
});

// Action para generar evaluación - CON FALLBACK: Gemini -> OpenAI
export const generateEvaluationAsync = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { threadId, promptMessageId }) => {
    const startTime = Date.now();
    console.log("\n========================================");
    console.log("[Evaluator] 🚀 INICIO DE EVALUACIÓN");
    console.log(`[Evaluator] ThreadId: ${threadId}`);
    console.log("========================================\n");

    const { generateText } = await import("ai");

    // Preparar contexto
    const { args: preparedArgs, save } = await evaluatorAgent.start(
      ctx,
      { promptMessageId },
      { threadId }
    );

    // Verificar configuración de proveedores
    const geminiEnabled = await ctx.runQuery(internal.data.llmConfig.isProviderEnabled, { provider: "gemini" });
    const openaiEnabled = await ctx.runQuery(internal.data.llmConfig.isProviderEnabled, { provider: "openai" });

    let result: Awaited<ReturnType<typeof generateText>> | null = null;
    let usedProvider: "gemini" | "openai" | null = null;
    let geminiError: Error | null = null;
    let openaiError: Error | null = null;

    // Intentar con Gemini primero
    if (geminiEnabled) {
      const geminiStart = Date.now();
      console.log("[Evaluator] 📍 Intentando con Gemini...");
      
      try {
        result = await generateText({
          ...preparedArgs,
          model: google("gemini-3-pro-preview"),
          providerOptions: {
            google: {
              thinkingConfig: {
                thinkingLevel: "low",
              },
            },
          },
        });
        
        usedProvider = "gemini";
        logLLMAttempt("gemini", "gemini-3-pro-preview", true, Date.now() - geminiStart);
        
      } catch (error) {
        geminiError = error instanceof Error ? error : new Error(String(error));
        logLLMAttempt("gemini", "gemini-3-pro-preview", false, Date.now() - geminiStart);
        console.error(`[Evaluator] ❌ Gemini falló: ${extractErrorMessage(error)}`);
        
        await ctx.runMutation(internal.data.llmConfig.logLLMError, {
          provider: "gemini",
          model: "gemini-3-pro-preview",
          agentName: "evaluatorAgent",
          errorType: classifyError(error),
          errorMessage: extractErrorMessage(error),
          threadId,
          resolved: false,
          fallbackUsed: undefined,
        });
      }
    }

    // Fallback a OpenAI
    if (!result && openaiEnabled) {
      const openaiStart = Date.now();
      console.log("[Evaluator] 📍 Fallback a OpenAI GPT-5.2...");
      
      try {
        result = await generateText({
          ...preparedArgs,
          model: openai("gpt-5.2"),
        });
        
        usedProvider = "openai";
        logLLMAttempt("openai", "gpt-5.2", true, Date.now() - openaiStart);
        
        if (geminiError) {
          await ctx.runMutation(internal.data.llmConfig.logLLMError, {
            provider: "gemini",
            model: "gemini-3-pro-preview",
            agentName: "evaluatorAgent",
            errorType: classifyError(geminiError),
            errorMessage: extractErrorMessage(geminiError),
            threadId,
            resolved: true,
            fallbackUsed: "gpt-5.2",
          });
        }
        
      } catch (error) {
        openaiError = error instanceof Error ? error : new Error(String(error));
        logLLMAttempt("openai", "gpt-5.2", false, Date.now() - openaiStart);
        
        await ctx.runMutation(internal.data.llmConfig.logLLMError, {
          provider: "openai",
          model: "gpt-5.2",
          agentName: "evaluatorAgent",
          errorType: classifyError(error),
          errorMessage: extractErrorMessage(error),
          threadId,
          resolved: false,
          fallbackUsed: undefined,
        });
      }
    }

    // Si ambos fallan
    if (!result) {
      const errorMessage = "Los servicios de evaluación están temporalmente no disponibles. Por favor, intenta de nuevo más tarde.";
      console.error(`[Evaluator] ❌ TODOS LOS PROVEEDORES FALLARON`);
      throw new Error(errorMessage);
    }

    // Guardar resultado
    for (const step of result.steps) {
      await save({ step });
    }

    const totalTime = Date.now() - startTime;
    console.log(`[Evaluator] ✅ Evaluación completada con ${usedProvider} en ${totalTime}ms`);

    return {
      text: result.text,
      promptMessageId,
      provider: usedProvider,
    };
  },
});
