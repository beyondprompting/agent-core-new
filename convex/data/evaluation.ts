// convex/evaluation.ts
// Funciones para manejar la evaluación de resultados
import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import { components, internal } from "../_generated/api";
import { createThread, saveMessage, listUIMessages, getFile } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";

// Crear un thread de evaluación para un thread de brief existente
export const createEvaluationThread = mutation({
  args: {
    briefThreadId: v.string(),
    taskId: v.id("tasks"),
    userId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Verificar si ya existe un thread de evaluación para esta task
    const existing = await ctx.db
      .query("evaluationThreads")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .first();
    
    if (existing) {
      console.log(`[Evaluation] Thread de evaluación ya existe: ${existing.evaluationThreadId}`);
      return {
        evaluationThreadId: existing.evaluationThreadId,
        briefThreadId: args.briefThreadId,
        isNew: false,
      };
    }
    
    // Crear un nuevo thread para la evaluación
    const evaluationThreadId = await createThread(ctx, components.agent, {
      userId: args.userId,
      title: `Evaluación de Brief`,
      summary: `Thread de evaluación para el brief ${args.briefThreadId}`,
    });
    
    // Guardar la relación en la tabla evaluationThreads
    await ctx.db.insert("evaluationThreads", {
      taskId: args.taskId,
      originalThreadId: args.briefThreadId,
      evaluationThreadId,
      status: "pending",
      createdAt: Date.now(),
    });
    
    console.log(`[Evaluation] ✅ Thread de evaluación creado: ${evaluationThreadId}`);
    
    return {
      evaluationThreadId,
      briefThreadId: args.briefThreadId,
      isNew: true,
    };
  },
});

// Enviar archivo para evaluación
export const sendEvaluationFile = mutation({
  args: {
    evaluationThreadId: v.string(),
    briefThreadId: v.string(),
    taskId: v.id("tasks"),
    prompt: v.string(),
    fileId: v.optional(v.string()), // Mantener para compatibilidad
    fileIds: v.optional(v.array(v.string())), // Nuevo: múltiples archivos
  },
  handler: async (ctx, { evaluationThreadId, briefThreadId, taskId, prompt, fileId, fileIds }) => {
    console.log(`[Evaluation] 📤 Enviando archivo(s) para evaluación`);
    
    // Crear contenido del mensaje
    const content: any[] = [];
    
    // Combinar fileId y fileIds para compatibilidad
    const allFileIds: string[] = [];
    if (fileId) allFileIds.push(fileId);
    if (fileIds) allFileIds.push(...fileIds);
    
    // Procesar todos los archivos
    for (const fId of allFileIds) {
      try {
        const fileData = await getFile(ctx, components.agent, fId);
        const { imagePart, filePart, file } = fileData;

        // Verificar si es Word (no soportado por Gemini)
        const filename = file?.filename || '';
        const isWordDocument = filename.toLowerCase().endsWith('.docx') || 
          filename.toLowerCase().endsWith('.doc');
        
        if (imagePart) {
          // LOG: Estimar tamaño de la imagen
          if ((imagePart as any).image?.source?.data) {
            const dataLength = (imagePart as any).image.source.data.length;
            console.log(`[Evaluation] 🖼️ imagePart tamaño data: ${(dataLength / 1024).toFixed(1)}KB`);
          } else {
            console.log(`[Evaluation] 🖼️ imagePart es referencia URL`);
          }
          content.push(imagePart);
        } else if (filePart && !isWordDocument) {
          content.push(filePart);
        } else if (isWordDocument) {
          console.log(`[Evaluation] 📝 Archivo Word detectado - omitiendo (contenido no soportado)`);
        }
      } catch (error) {
        console.error(`[Evaluation] Error obteniendo archivo ${fId}:`, error);
      }
    }
    
    // Agregar contexto del brief thread con el taskId para que el tool pueda encontrarlo
    // Los IDs se incluyen en el texto ya que metadata tiene esquema fijo
    const contextPrompt = `📋 INFORMACIÓN DEL CONTEXTO

Se adjuntaron los siguientes elementos para evaluación:
${allFileIds.length > 0 ? `✅ ${allFileIds.length} archivo(s) adjunto(s)` : '❌ Sin archivos adjuntos'}

Referencias del requerimiento original:
• Brief Thread ID: ${briefThreadId}
• Task ID: ${taskId}`;
    
    content.push({ type: "text", text: contextPrompt });
    
    if (content.length === 0) {
      throw new Error("Debes adjuntar al menos un archivo o escribir un mensaje");
    }
    
    // Guardar el mensaje del usuario (sin metadata personalizado)
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId: evaluationThreadId,
      message: { 
        role: "user", 
        content
      },
      metadata: allFileIds.length > 0 ? { fileIds: allFileIds } : undefined,
    });
    
    console.log(`[Evaluation] ✅ Mensaje de evaluación guardado: ${messageId}`);
    
    // Actualizar status del thread de evaluación
    const evalThread = await ctx.db
      .query("evaluationThreads")
      .withIndex("by_evaluation_thread", (q) => q.eq("evaluationThreadId", evaluationThreadId))
      .first();
    
    if (evalThread) {
      await ctx.db.patch(evalThread._id, { status: "in_progress" });
    }
    
    // Disparar generación de evaluación asíncrona
    await ctx.scheduler.runAfter(0, internal.agents.evaluatorAgentAction.generateEvaluationAsync, {
      threadId: evaluationThreadId,
      promptMessageId: messageId,
    });
    
    return { messageId };
  },
});

// Listar mensajes del thread de evaluación
export const listEvaluationMessages = query({
  args: {
    threadId: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, { threadId, paginationOpts }) => {
    const messages = await listUIMessages(ctx, components.agent, {
      threadId,
      paginationOpts,
    });
    
    return messages;
  },
});

// Obtener thread de evaluación por taskId
export const getEvaluationThreadByTask = query({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const evalThread = await ctx.db
      .query("evaluationThreads")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId))
      .first();
    
    return evalThread;
  },
});
