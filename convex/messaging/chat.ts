// convex/chat.ts
// Funciones para manejar conversaciones con el agente de Brief
import { v } from "convex/values";
import { mutation, query, internalAction } from "../_generated/server";
import { briefAgent } from "../agents/agent";
import { components, internal } from "../_generated/api";
import { saveMessage, listUIMessages, getFile } from "@convex-dev/agent";
import { paginationOptsValidator } from "convex/server";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { 
  classifyError, 
  extractErrorMessage, 
  isRecoverableError,
  logLLMAttempt 
} from "../lib/llmFallback";

// NOTA: La creación de threads ahora se hace a través de convex/threads.ts
// que usa autenticación y crea correctamente el thread del Agent + chatThreads

// Obtener el último thread de CHAT del usuario (no incluye threads de evaluación)
export const getLatestThread = query({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    // Buscar en nuestra tabla chatThreads (excluye evaluaciones automáticamente)
    let chatThread;
    
    if (args.userId) {
      chatThread = await ctx.db
        .query("chatThreads")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .first();
    } else {
      chatThread = await ctx.db
        .query("chatThreads")
        .order("desc")
        .first();
    }
    
    if (chatThread) {
      return chatThread.threadId;
    }
    
    return null;
  },
});

// Enviar un mensaje y generar respuesta asíncrona
export const sendMessage = mutation({
  args: {
    threadId: v.string(),
    prompt: v.string(),
    fileId: v.optional(v.string()), // Mantener para compatibilidad
    fileIds: v.optional(v.array(v.string())), // Nuevo: múltiples archivos
  },
  handler: async (ctx, { threadId, prompt, fileId, fileIds }) => {
    console.log(`[Chat] 📤 Guardando mensaje en thread ${threadId}`);
    
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
        // Verificar si es un archivo Word (Gemini no lo soporta)
        // Usamos la extensión del filename para detectar archivos Word
        const filename = file?.filename || '';
        const isWordDocument = filename.toLowerCase().endsWith('.docx') || 
          filename.toLowerCase().endsWith('.doc');
        
        // Preferir imagePart si es una imagen
        if (imagePart) {
          // LOG: Estimar tamaño de la imagen si tiene data inline
          if ((imagePart as any).image?.source?.data) {
            const dataLength = (imagePart as any).image.source.data.length;
            console.log(`[Chat] 🖼️ Agregando imagePart - tamaño data: ${(dataLength / 1024).toFixed(1)}KB`);
          } else {
            console.log(`[Chat] 🖼️ Agregando imagePart (referencia URL)`);
          }
          content.push(imagePart);
        } else if (filePart && !isWordDocument) {
          // Solo agregar filePart si NO es Word (Gemini no soporta Word)
          console.log(`[Chat] 📄 Agregando filePart`);
          content.push(filePart);
        } else if (isWordDocument) {
          // Para Word, el contenido ya fue extraído y las imágenes guardadas por separado
          // No enviamos el archivo original porque Gemini no lo soporta
          console.log(`[Chat] 📝 Archivo Word detectado - omitiendo (contenido extraído en frontend)`);
        }
      } catch (error) {
        console.error(`[Chat] Error obteniendo archivo ${fId}:`, error);
      }
    }
    
    // Agregar texto si existe
    if (prompt.trim()) {
      content.push({ type: "text", text: prompt });
    }
    
    // Si no hay contenido, lanzar error
    if (content.length === 0) {
      throw new Error("El mensaje debe contener texto o archivo");
    }
    
    // Guardar el mensaje del usuario
    const { messageId } = await saveMessage(ctx, components.agent, {
      threadId,
      message: { 
        role: "user", 
        content
      },
      metadata: allFileIds.length > 0 ? { fileIds: allFileIds } : undefined,
    });
    
    console.log(`[Chat] ✅ Mensaje guardado: ${messageId}`);
    
    // Disparar generación de respuesta asíncrona
    await ctx.scheduler.runAfter(0, internal.messaging.chat.generateResponseAsync, {
      threadId,
      promptMessageId: messageId,
    });
    
    return { messageId };
  },
});

// Generar respuesta del agente (interna, llamada async)
// CON SISTEMA DE FALLBACK: Gemini -> OpenAI GPT-5.2
export const generateResponseAsync = internalAction({
  args: {
    threadId: v.string(),
    promptMessageId: v.string(),
  },
  handler: async (ctx, { threadId, promptMessageId }) => {
    const startTime = Date.now();
    console.log("\n========================================");
    console.log("[GenerateResponse] 🚀 INICIO DE GENERACIÓN");
    console.log(`[GenerateResponse] ThreadId: ${threadId}`);
    console.log(`[GenerateResponse] Timestamp: ${new Date().toISOString()}`);
    console.log("========================================\n");

    // Importación dinámica del AI SDK
    const { generateText } = await import("ai");

    // PASO 1: Preparar el contexto
    const prepareStart = Date.now();
    console.log("[GenerateResponse] 📍 PASO 1: Preparando contexto...");
    
    const { args: preparedArgs, save } = await briefAgent.start(
      ctx,
      { promptMessageId },
      { threadId }
    );
    
    const prepareTime = Date.now() - prepareStart;
    console.log(`[GenerateResponse] ✅ Contexto preparado en ${prepareTime}ms`);
    console.log(`[GenerateResponse] 📊 Mensajes: ${preparedArgs.messages?.length || 0}`);

    // Verificar si proveedores están habilitados (para testing)
    const geminiEnabled = await ctx.runQuery(internal.data.llmConfig.isProviderEnabled, { provider: "gemini" });
    const openaiEnabled = await ctx.runQuery(internal.data.llmConfig.isProviderEnabled, { provider: "openai" });
    
    console.log(`[GenerateResponse] 🔧 Gemini habilitado: ${geminiEnabled}, OpenAI habilitado: ${openaiEnabled}`);

    let result: Awaited<ReturnType<typeof generateText>> | null = null;
    let usedProvider: "gemini" | "openai" | null = null;
    let geminiError: Error | null = null;
    let openaiError: Error | null = null;

    // PASO 2: Intentar con Gemini primero (si está habilitado)
    if (geminiEnabled) {
      const geminiStart = Date.now();
      console.log("[GenerateResponse] 📍 PASO 2A: Intentando con Gemini...");
      
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
        console.log(`[GenerateResponse] ✅ Gemini respondió en ${Date.now() - geminiStart}ms`);
        
      } catch (error) {
        geminiError = error instanceof Error ? error : new Error(String(error));
        logLLMAttempt("gemini", "gemini-3-pro-preview", false, Date.now() - geminiStart);
        console.error(`[GenerateResponse] ❌ Gemini falló: ${extractErrorMessage(error)}`);
        
        // Registrar error en la base de datos
        await ctx.runMutation(internal.data.llmConfig.logLLMError, {
          provider: "gemini",
          model: "gemini-3-pro-preview",
          agentName: "briefAgent",
          errorType: classifyError(error),
          errorMessage: extractErrorMessage(error),
          threadId,
          resolved: false, // Se actualizará si el fallback funciona
          fallbackUsed: undefined,
        });
      }
    } else {
      console.log("[GenerateResponse] ⏭️ Gemini deshabilitado, saltando...");
    }

    // PASO 3: Si Gemini falló o está deshabilitado, intentar con OpenAI
    if (!result && openaiEnabled) {
      const openaiStart = Date.now();
      console.log("[GenerateResponse] 📍 PASO 2B: Intentando con OpenAI GPT-5.2 (fallback)...");
      
      try {
        result = await generateText({
          ...preparedArgs,
          model: openai("gpt-5.2"),
        });
        
        usedProvider = "openai";
        logLLMAttempt("openai", "gpt-5.2", true, Date.now() - openaiStart);
        console.log(`[GenerateResponse] ✅ OpenAI respondió en ${Date.now() - openaiStart}ms`);
        
        // Si llegamos aquí por fallback, actualizar el error de Gemini como resuelto
        if (geminiError) {
          await ctx.runMutation(internal.data.llmConfig.logLLMError, {
            provider: "gemini",
            model: "gemini-3-pro-preview",
            agentName: "briefAgent",
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
        console.error(`[GenerateResponse] ❌ OpenAI también falló: ${extractErrorMessage(error)}`);
        
        // Registrar error de OpenAI
        await ctx.runMutation(internal.data.llmConfig.logLLMError, {
          provider: "openai",
          model: "gpt-5.2",
          agentName: "briefAgent",
          errorType: classifyError(error),
          errorMessage: extractErrorMessage(error),
          threadId,
          resolved: false,
          fallbackUsed: undefined,
        });
      }
    } else if (!result && !openaiEnabled) {
      console.log("[GenerateResponse] ⏭️ OpenAI deshabilitado, saltando...");
    }

    // PASO 4: Si ambos fallaron, lanzar error amigable
    if (!result) {
      const totalTime = Date.now() - startTime;
      const errorMessage = geminiError && openaiError
        ? "Ambos proveedores de IA están temporalmente no disponibles. Por favor, intenta de nuevo en unos minutos."
        : !geminiEnabled && !openaiEnabled
        ? "Los servicios de IA están deshabilitados para mantenimiento. Por favor, intenta de nuevo más tarde."
        : "Error al generar respuesta. Por favor, intenta de nuevo.";
      
      console.error("\n========================================");
      console.error(`[GenerateResponse] ❌ TODOS LOS PROVEEDORES FALLARON después de ${totalTime}ms`);
      console.error(`[GenerateResponse] Gemini error: ${geminiError?.message || "deshabilitado"}`);
      console.error(`[GenerateResponse] OpenAI error: ${openaiError?.message || "deshabilitado"}`);
      console.error("========================================\n");
      
      // Guardar mensaje de error para el usuario
      await saveMessage(ctx, components.agent, {
        threadId,
        message: {
          role: "assistant",
          content: [{ type: "text", text: `⚠️ ${errorMessage}` }],
        },
      });
      
      throw new Error(errorMessage);
    }

    // PASO 5: Guardar el resultado exitoso
    const saveStart = Date.now();
    console.log("[GenerateResponse] 📍 PASO 3: Guardando resultado...");
    
    for (const step of result.steps) {
      await save({ step });
    }
    
    const saveTime = Date.now() - saveStart;
    const totalTime = Date.now() - startTime;
    
    console.log("\n========================================");
    console.log(`[GenerateResponse] 🏁 RESUMEN:`);
    console.log(`[GenerateResponse]    - Proveedor usado: ${usedProvider}`);
    console.log(`[GenerateResponse]    - Preparación: ${prepareTime}ms`);
    console.log(`[GenerateResponse]    - Guardado: ${saveTime}ms`);
    console.log(`[GenerateResponse]    - TOTAL: ${totalTime}ms (${(totalTime/1000).toFixed(1)}s)`);
    console.log(`[GenerateResponse] 📝 Respuesta: ${result.text?.substring(0, 100)}...`);
    console.log("========================================\n");

    return {
      text: result.text,
      promptMessageId,
      provider: usedProvider,
    };
  },
});

// Listar mensajes de un thread
export const listThreadMessages = query({
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

// Listar todos los threads de chat del usuario (para historial)
export const listChatThreads = query({
  args: {
    userId: v.optional(v.id("users")),
  },
  handler: async (ctx, args) => {
    let threads;
    
    if (args.userId) {
      threads = await ctx.db
        .query("chatThreads")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .order("desc")
        .collect();
    } else {
      threads = await ctx.db
        .query("chatThreads")
        .order("desc")
        .collect();
    }
    
    return threads;
  },
});

// Obtener el thread de chat asociado a un threadId específico
export const getChatThreadInfo = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const chatThread = await ctx.db
      .query("chatThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    
    return chatThread;
  },
});
