// convex/integrations/cor.ts
// Integración con COR API para sincronizar tareas
import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "../_generated/server";

// ==================== TIPOS ====================

interface CORTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
}

interface CORTaskInput {
  title: string;
  project_id: number;
  description?: string;
  deadline?: string;
  priority?: number; // 0 = Low, 1 = Medium, 2 = High, 3 = Urgent
}

interface CORTaskUpdateInput {
  title?: string;
  description?: string;
  deadline?: string;
  priority?: number;
  status?: string;
}

interface CORTaskResponse {
  id: number;
  title: string;
  project_id: number;
  description?: string;
  deadline?: string;
  status: string;
  priority: number;
  archived: boolean;
}

// ==================== CONFIGURACIÓN ====================

// IDs de proyecto y cliente por defecto - DEBES CONFIGURAR ESTOS VALORES
// Puedes cambiarlos según tu estructura en COR
const DEFAULT_COR_PROJECT_ID = 888287; // TODO: Cambiar por tu project_id real de COR
const DEFAULT_COR_CLIENT_ID = 178768;   // TODO: Cambiar por tu client_id real de COR

// Base URL de la API de COR
const COR_API_BASE_URL = "https://api.projectcor.com/v1";

// ==================== HELPER: OBTENER TOKEN ====================

/**
 * Obtiene un access token de COR usando Client Credentials flow
 * Las credenciales deben estar configuradas en el dashboard de Convex como:
 * - COR_API_KEY
 * - COR_CLIENT_SECRET
 */
async function getCORAccessToken(): Promise<string> {
  const apiKey = process.env.COR_API_KEY;
  const clientSecret = process.env.COR_CLIENT_SECRET;

  if (!apiKey || !clientSecret) {
    throw new Error(
      "COR credentials not configured. Please set COR_API_KEY and COR_CLIENT_SECRET in Convex dashboard."
    );
  }

  // Encode credentials para Basic Auth (usando btoa en lugar de Buffer para compatibilidad con Convex)
  const credentials = btoa(`${apiKey}:${clientSecret}`);

  const response = await fetch(
    `${COR_API_BASE_URL}/oauth/token?grant_type=client_credentials`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
      },
    }
  );

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[COR] Error obteniendo token:", errorText);
    throw new Error(`COR authentication failed: ${response.status} ${response.statusText}`);
  }

  const tokenData: CORTokenResponse = await response.json();
  return tokenData.access_token;
}

// ==================== MAPEO DE PRIORIDADES ====================

/**
 * Mapea prioridades del formato interno al formato de COR
 * Interno: "baja" | "media" | "alta" | "urgente"
 * COR: 0 = Low, 1 = Medium, 2 = High, 3 = Urgent
 */
function mapPriorityToCOR(priority: string | undefined): number {
  switch (priority?.toLowerCase()) {
    case "baja":
    case "low":
      return 0;
    case "media":
    case "medium":
    default:
      return 1;
    case "alta":
    case "high":
      return 2;
    case "urgente":
    case "urgent":
      return 3;
  }
}

// ==================== ACCIÓN: CREAR TASK EN COR ====================

/**
 * Crea una task en COR
 * Esta acción es llamada desde el workflow de creación de tasks
 */
export const createTaskInCOR = internalAction({
  args: {
    localTaskId: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    deadline: v.optional(v.string()),
    priority: v.optional(v.string()),
    projectId: v.optional(v.number()), // ID del proyecto en COR
  },
  handler: async (ctx, args): Promise<{ corTaskId: number; success: boolean }> => {
    console.log("\n========================================");
    console.log("[COR] 🚀 CREANDO TASK EN COR");
    console.log(`[COR] Task local: ${args.localTaskId}`);
    console.log(`[COR] Título: ${args.title}`);
    console.log("========================================\n");

    try {
      // 1. Obtener access token
      const accessToken = await getCORAccessToken();
      console.log("[COR] ✅ Token obtenido");

      // 2. Preparar datos de la task
      const taskData: CORTaskInput = {
        title: args.title,
        project_id: args.projectId || DEFAULT_COR_PROJECT_ID,
        description: args.description,
        priority: mapPriorityToCOR(args.priority),
      };

      // Formatear deadline si existe (COR espera ISO 8601)
      if (args.deadline) {
        // Intentar parsear fecha flexible
        const deadlineDate = new Date(args.deadline);
        if (!isNaN(deadlineDate.getTime())) {
          taskData.deadline = deadlineDate.toISOString();
        }
      }

      console.log("[COR] 📤 Enviando a COR:", JSON.stringify(taskData, null, 2));

      // 3. Crear task en COR
      const response = await fetch(`${COR_API_BASE_URL}/tasks`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(taskData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[COR] ❌ Error creando task:", errorText);
        throw new Error(`COR API error: ${response.status} - ${errorText}`);
      }

      const corTask: CORTaskResponse = await response.json();
      
      console.log("\n========================================");
      console.log("[COR] ✅ TASK CREADA EXITOSAMENTE EN COR");
      console.log(`[COR] COR Task ID: ${corTask.id}`);
      console.log(`[COR] Status: ${corTask.status}`);
      console.log("========================================\n");

      return {
        corTaskId: corTask.id,
        success: true,
      };
    } catch (error) {
      console.error("[COR] ❌ Error en createTaskInCOR:", error);
      throw error;
    }
  },
});

// ==================== QUERY: OBTENER CONFIGURACIÓN COR ====================

/**
 * Obtiene la configuración de COR (project_id y client_id por defecto)
 * Útil para mostrar en el frontend o para debugging
 */
export const getCORConfig = internalQuery({
  args: {},
  handler: async () => {
    return {
      defaultProjectId: DEFAULT_COR_PROJECT_ID,
      defaultClientId: DEFAULT_COR_CLIENT_ID,
      apiBaseUrl: COR_API_BASE_URL,
      isConfigured: !!(process.env.COR_API_KEY && process.env.COR_CLIENT_SECRET),
    };
  },
});

// ==================== MUTATION: ACTUALIZAR SYNC STATUS ====================

/**
 * Actualiza el estado de sincronización de una task con COR
 */
export const updateCORSyncStatus = internalMutation({
  args: {
    taskId: v.string(),
    corTaskId: v.optional(v.number()),
    syncStatus: v.string(), // "pending" | "synced" | "error"
    syncError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log(`[COR] Actualizando sync status de task ${args.taskId} a ${args.syncStatus}`);
    
    await ctx.db.patch(args.taskId as any, {
      corTaskId: args.corTaskId ? String(args.corTaskId) : undefined,
      corSyncStatus: args.syncStatus,
      corSyncError: args.syncError,
    });
    
    return args.taskId;
  },
});

// ==================== ACCIÓN: VERIFICAR CONEXIÓN COR ====================

/**
 * Verifica que las credenciales de COR están configuradas y funcionan
 * Útil para testing y debugging
 */
export const verifyCORConnection = internalAction({
  args: {},
  handler: async (): Promise<{ connected: boolean; user?: any; error?: string }> => {
    try {
      const accessToken = await getCORAccessToken();
      
      // Verificar token obteniendo el usuario autenticado
      const response = await fetch(`${COR_API_BASE_URL}/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        return {
          connected: false,
          error: `COR API returned ${response.status}`,
        };
      }

      const user = await response.json();
      console.log("[COR] ✅ Conexión verificada. Usuario:", user.email);
      
      return {
        connected: true,
        user: {
          id: user.id,
          name: `${user.first_name} ${user.last_name}`,
          email: user.email,
          role_id: user.role_id,
        },
      };
    } catch (error) {
      return {
        connected: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
});

// ==================== ACCIÓN: ACTUALIZAR TASK EN COR ====================

/**
 * Actualiza una task existente en COR de forma SEGURA.
 * 
 * IMPORTANTE: Esta función hace GET primero para obtener los valores actuales,
 * luego hace merge SOLO de los campos que se quieren cambiar, y finalmente
 * envía el objeto completo al PUT para evitar borrar datos accidentalmente.
 * 
 * NUNCA se debe borrar un campo que el usuario no pidió explícitamente cambiar.
 */
export const updateTaskInCOR = internalAction({
  args: {
    corTaskId: v.number(),
    title: v.optional(v.string()),
    description: v.optional(v.string()),
    deadline: v.optional(v.string()),
    priority: v.optional(v.string()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    console.log("\n========================================");
    console.log("[COR] 🔄 ACTUALIZANDO TASK EN COR (MODO SEGURO)");
    console.log(`[COR] COR Task ID: ${args.corTaskId}`);
    console.log("========================================\n");

    try {
      // 1. Obtener access token
      const accessToken = await getCORAccessToken();
      console.log("[COR] ✅ Token obtenido");

      // 2. CRÍTICO: Primero obtener el estado ACTUAL de la task en COR
      console.log("[COR] 📥 Obteniendo estado actual de la task...");
      const getResponse = await fetch(`${COR_API_BASE_URL}/tasks/${args.corTaskId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!getResponse.ok) {
        const errorText = await getResponse.text();
        console.error("[COR] ❌ Error obteniendo task actual:", errorText);
        return { 
          success: false, 
          error: `No se pudo obtener la task actual: ${getResponse.status} - ${errorText}` 
        };
      }

      const currentTask: CORTaskResponse = await getResponse.json();
      console.log("[COR] 📋 Task actual obtenida:");
      console.log(`[COR]   - Título: ${currentTask.title}`);
      console.log(`[COR]   - Descripción: ${currentTask.description?.substring(0, 50)}...`);
      console.log(`[COR]   - Estado: ${currentTask.status}`);
      console.log(`[COR]   - Prioridad: ${currentTask.priority}`);

      // 3. CRÍTICO: Construir objeto de actualización preservando TODOS los valores actuales
      // Solo sobrescribimos los campos que el usuario EXPLÍCITAMENTE quiere cambiar
      const updateData: CORTaskUpdateInput = {
        // Preservar valores actuales por defecto
        title: currentTask.title,
        description: currentTask.description,
        priority: currentTask.priority,
        status: currentTask.status,
        deadline: currentTask.deadline,
      };
      
      // Solo sobrescribir si el usuario proporcionó un nuevo valor (no undefined, no null, no empty string)
      if (args.title !== undefined && args.title !== null && args.title.trim() !== "") {
        console.log(`[COR] 📝 Cambiando título: "${currentTask.title}" → "${args.title}"`);
        updateData.title = args.title;
      }
      
      if (args.description !== undefined && args.description !== null) {
        // Para descripción, permitimos string vacío si el usuario lo quiere explícitamente
        // Pero si es undefined, mantenemos el valor actual
        console.log(`[COR] 📝 Cambiando descripción`);
        updateData.description = args.description;
      }
      
      if (args.priority !== undefined && args.priority !== null) {
        const newPriority = mapPriorityToCOR(args.priority);
        console.log(`[COR] 📝 Cambiando prioridad: ${currentTask.priority} → ${newPriority}`);
        updateData.priority = newPriority;
      }
      
      if (args.status !== undefined && args.status !== null && args.status.trim() !== "") {
        console.log(`[COR] 📝 Cambiando estado: "${currentTask.status}" → "${args.status}"`);
        updateData.status = args.status;
      }
      
      if (args.deadline !== undefined && args.deadline !== null) {
        const deadlineDate = new Date(args.deadline);
        if (!isNaN(deadlineDate.getTime())) {
          console.log(`[COR] 📝 Cambiando deadline: "${currentTask.deadline}" → "${deadlineDate.toISOString()}"`);
          updateData.deadline = deadlineDate.toISOString();
        }
      }

      console.log("[COR] 📤 Enviando actualización SEGURA a COR:");
      console.log("[COR]   Objeto completo (preservando datos existentes):", JSON.stringify(updateData, null, 2));

      // 4. Actualizar task en COR (PUT /tasks/{id}) con objeto COMPLETO
      const response = await fetch(`${COR_API_BASE_URL}/tasks/${args.corTaskId}`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updateData),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[COR] ❌ Error actualizando task:", errorText);
        return { 
          success: false, 
          error: `COR API error: ${response.status} - ${errorText}` 
        };
      }

      const updatedTask: CORTaskResponse = await response.json();
      
      console.log("\n========================================");
      console.log("[COR] ✅ TASK ACTUALIZADA EXITOSAMENTE EN COR");
      console.log(`[COR] COR Task ID: ${updatedTask.id}`);
      console.log(`[COR] Título final: ${updatedTask.title}`);
      console.log(`[COR] Descripción final: ${updatedTask.description?.substring(0, 50)}...`);
      console.log("========================================\n");

      return { success: true };
    } catch (error) {
      console.error("[COR] ❌ Error en updateTaskInCOR:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  },
});

// ==================== ACCIÓN: ENVIAR MENSAJE CON ATTACHMENTS A TASK ====================

interface CORAttachment {
  id?: number;
  name: string;
  url: string;
  type: string;
  source: string;
}

interface CORTaskMessageInput {
  message: string;
  attachments?: CORAttachment[];
}

/**
 * Envía un mensaje con attachments a una task en COR.
 * Útil para adjuntar archivos que el usuario subió durante el brief.
 * 
 * Endpoint: POST /tasks/{task_id}/messages
 */
export const postTaskMessage = internalAction({
  args: {
    corTaskId: v.number(),
    message: v.string(),
    attachments: v.optional(v.array(v.object({
      name: v.string(),
      url: v.string(),
      type: v.string(),
      source: v.optional(v.string()),
    }))),
  },
  handler: async (ctx, args): Promise<{ success: boolean; error?: string }> => {
    console.log("\n========================================");
    console.log("[COR] 📎 ENVIANDO MENSAJE CON ATTACHMENTS");
    console.log(`[COR] COR Task ID: ${args.corTaskId}`);
    console.log(`[COR] Mensaje: ${args.message}`);
    console.log(`[COR] Attachments: ${args.attachments?.length || 0}`);
    console.log("========================================\n");

    try {
      const accessToken = await getCORAccessToken();
      console.log("[COR] ✅ Token obtenido");

      // Preparar el body del mensaje
      const messageBody: CORTaskMessageInput = {
        message: args.message,
      };

      // Agregar attachments si existen
      if (args.attachments && args.attachments.length > 0) {
        messageBody.attachments = args.attachments.map((att, index) => ({
          id: index + 1, // ID secuencial temporal
          name: att.name,
          url: att.url,
          type: att.type,
          source: att.source || "convex", // Origen del archivo
        }));
        
        console.log("[COR] 📎 Attachments a enviar:");
        messageBody.attachments.forEach(att => {
          console.log(`[COR]   - ${att.name} (${att.type})`);
        });
      }

      console.log("[COR] 📤 Enviando mensaje a COR...");

      const response = await fetch(`${COR_API_BASE_URL}/tasks/${args.corTaskId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(messageBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[COR] ❌ Error enviando mensaje:", errorText);
        return { 
          success: false, 
          error: `COR API error: ${response.status} - ${errorText}` 
        };
      }

      const result = await response.json();
      
      console.log("\n========================================");
      console.log("[COR] ✅ MENSAJE ENVIADO EXITOSAMENTE");
      console.log("[COR] Respuesta:", JSON.stringify(result, null, 2));
      console.log("========================================\n");

      return { success: true };
    } catch (error) {
      console.error("[COR] ❌ Error en postTaskMessage:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  },
});
// ==================== ACCIÓN: OBTENER TASK DE COR ====================

/**
 * Obtiene los detalles de una task desde COR
 */
export const getTaskFromCOR = internalAction({
  args: {
    corTaskId: v.number(),
  },
  handler: async (ctx, args): Promise<{ success: boolean; task?: CORTaskResponse; error?: string }> => {
    console.log(`[COR] 🔍 Obteniendo task ${args.corTaskId} de COR...`);

    try {
      const accessToken = await getCORAccessToken();

      const response = await fetch(`${COR_API_BASE_URL}/tasks/${args.corTaskId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[COR] ❌ Error obteniendo task:", errorText);
        return { 
          success: false, 
          error: `COR API error: ${response.status} - ${errorText}` 
        };
      }

      const task: CORTaskResponse = await response.json();
      console.log(`[COR] ✅ Task obtenida: ${task.title}`);

      return { success: true, task };
    } catch (error) {
      console.error("[COR] ❌ Error en getTaskFromCOR:", error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error) 
      };
    }
  },
});
