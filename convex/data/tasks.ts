// convex/tasks.ts
// Funciones para manejar tasks/requerimientos
import { v } from "convex/values";
import { mutation, query, internalMutation, internalQuery, internalAction } from "../_generated/server";
import { createTool, createThread, saveMessage, listMessages } from "@convex-dev/agent";
import { z } from "zod";
import { internal, components } from "../_generated/api";
import { reviewerAgent } from "../agents/reviewerAgent";

// ==================== TOOL PARA OBTENER FECHA ACTUAL ====================

// Tool que devuelve la fecha y hora actual
export const nowTool = createTool({
  description: `Obtener la fecha y hora actual. Usar esta herramienta cuando necesites saber que dia es hoy, 
  por ejemplo para calcular deadlines, verificar timings, o dar contexto temporal al usuario.`,
  args: z.object({}),
  handler: async (): Promise<string> => {
    const now = new Date();
    
    // Formato legible en español
    const options: Intl.DateTimeFormatOptions = {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'America/Guayaquil', // Ecuador timezone
    };
    
    const fechaLegible = now.toLocaleDateString('es-EC', options);
    const fechaISO = now.toISOString();
    
    console.log(`[NowTool] Fecha actual: ${fechaLegible}`);
    
    return `Fecha y hora actual: ${fechaLegible} (${fechaISO})`;
  },
});

// ==================== ACTION INTERNA PARA GENERAR RESPUESTA DEL REVIEWER ====================

// Esta action es llamada desde el tool para generar la respuesta del supervisor
export const generateReviewerResponse = reviewerAgent.asTextAction({});

// ==================== TOOL PARA REVISAR BRIEF (SUPERVISOR) ====================

// Tool que el briefAgent usa para validar si la información recolectada es suficiente
// OPTIMIZADO: Validación rápida en línea sin llamar a otro agente
export const reviewBriefTool = createTool({
  description: `Validar rapidamente si la informacion recolectada es suficiente para crear el brief.
  Usar esta herramienta ANTES de mostrar el resumen final al usuario.
  Verifica que los campos obligatorios esten completos.`,
  args: z.object({
    requestType: z.string().describe("Tipo de requerimiento recolectado"),
    brand: z.string().describe("Marca o empresa recolectada"),
    objective: z.string().optional().describe("Objetivo del proyecto (si se proporciono)"),
    keyMessage: z.string().optional().describe("Mensaje clave (si se proporciono)"),
    kpis: z.string().optional().describe("KPIs (si se proporcionaron)"),
    deadline: z.string().optional().describe("Timing o fecha limite (si se proporciono)"),
    budget: z.string().optional().describe("Presupuesto (si se proporciono)"),
    approvers: z.string().optional().describe("Aprobadores (si se proporcionaron)"),
    hasFiles: z.boolean().optional().describe("Si el usuario adjunto archivos"),
  }),
  handler: async (ctx, args): Promise<string> => {
    console.log("[ReviewTool] Validando brief (modo rapido)...");
    
    // OPTIMIZACIÓN: Validación simple en línea sin llamar a otro agente
    const observaciones: string[] = [];
    const sugerencias: string[] = [];
    let confianza = 100;
    
    // Verificar campos obligatorios
    const camposObligatoriosCompletos = !!(args.requestType && args.brand);
    
    if (!camposObligatoriosCompletos) {
      observaciones.push("Faltan campos obligatorios");
      if (!args.requestType) sugerencias.push("Falta el tipo de requerimiento");
      if (!args.brand) sugerencias.push("Falta la marca");
      confianza = 0;
    } else {
      observaciones.push("Campos obligatorios completos");
    }
    
    // Evaluar calidad de la información
    let camposOpcionales = 0;
    if (args.objective) camposOpcionales++;
    if (args.keyMessage) camposOpcionales++;
    if (args.kpis) camposOpcionales++;
    if (args.deadline) camposOpcionales++;
    if (args.budget) camposOpcionales++;
    if (args.approvers) camposOpcionales++;
    if (args.hasFiles) camposOpcionales++;
    
    if (camposOpcionales >= 4) {
      observaciones.push("Informacion muy completa");
      confianza = Math.min(confianza, 95);
    } else if (camposOpcionales >= 2) {
      observaciones.push("Informacion adecuada");
      confianza = Math.min(confianza, 85);
    } else if (camposObligatoriosCompletos) {
      observaciones.push("Informacion basica, podria mejorarse");
      sugerencias.push("Considera solicitar mas detalles como objetivo, timing o presupuesto");
      confianza = Math.min(confianza, 70);
    }
    
    const resultado = {
      aprobado: camposObligatoriosCompletos,
      campos_obligatorios_completos: camposObligatoriosCompletos,
      observaciones,
      sugerencias,
      confianza,
    };
    
    console.log("[ReviewTool] ✅ Validacion completada:", JSON.stringify(resultado));
    
    return `EVALUACION DEL SUPERVISOR:\n\n${JSON.stringify(resultado, null, 2)}`;
  },
});

// ==================== TOOL PARA CONSULTAR TASK EN COR ====================

// Tool que el agente puede usar para consultar una task directamente desde COR
export const getTaskFromCORTool = createTool({
  description: `Consultar los detalles de una task directamente desde el sistema COR.
  Usar esta herramienta cuando:
  - El usuario quiere ver los detalles de una task usando su COR ID
  - El usuario quiere verificar el estado actual de una task en COR
  - Antes de editar una task, para ver su contenido actual
  
  Recibe el ID numerico de la task en COR (ej: 11301144).`,
  args: z.object({
    corTaskId: z.string().describe("ID de la task en COR (ej: 11301144)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    console.log(`[GetTaskFromCOR] 🔍 Consultando task COR ID: ${args.corTaskId}`);
    
    try {
      const result = await ctx.runAction(internal.integrations.cor.getTaskFromCOR, {
        corTaskId: parseInt(args.corTaskId),
      });
      
      if (!result.success || !result.task) {
        console.log(`[GetTaskFromCOR] ❌ Task no encontrada: ${result.error}`);
        return `No se encontró ninguna task con el COR ID: ${args.corTaskId}

Posibles causas:
- El ID no existe o fue eliminado
- No tienes permisos para ver esta task
- Error de conexión con COR

Por favor verifica el ID e intenta de nuevo.`;
      }
      
      const task = result.task;
      console.log(`[GetTaskFromCOR] ✅ Task encontrada:`, task.title);
      
      // Mapear prioridad a texto legible
      const prioridadTexto = ["Baja", "Media", "Alta", "Urgente"][task.priority] || "Media";
      
      // Formatear fecha si existe
      let deadlineTexto = "Sin fecha límite";
      if (task.deadline) {
        const fecha = new Date(task.deadline);
        deadlineTexto = fecha.toLocaleDateString('es-ES', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }
      
      return `📋 **Task en COR (ID: ${task.id})**

**Título:** ${task.title}
**Descripción:** ${task.description || "Sin descripción"}
**Estado:** ${task.status}
**Prioridad:** ${prioridadTexto}
**Deadline:** ${deadlineTexto}
**Proyecto ID:** ${task.project_id}
**Archivada:** ${task.archived ? "Sí" : "No"}

¿Qué te gustaría hacer con esta task?`;
    } catch (error) {
      console.error(`[GetTaskFromCOR] ❌ Error:`, error);
      return `Error al consultar la task en COR: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// ==================== TOOL PARA CREAR TASK ====================

// Tool que el agente puede usar para crear una task
// AHORA USA WORKFLOW para garantizar durabilidad, reintentos e idempotencia
// También sincroniza automáticamente con COR
export const createTaskTool = createTool({
  description: `Crear una nueva task/requerimiento en la base de datos y sincronizarla con COR. 
  SOLO usar esta herramienta cuando el usuario haya CONFIRMADO explicitamente que toda la informacion esta correcta.
  El usuario debe decir algo como "si", "correcto", "todo esta bien", "conforme", "ok, guardalo", etc.
  NO usar esta herramienta si el usuario quiere modificar algo.
  
  La task se creará localmente Y se sincronizará automáticamente con el sistema COR de gestión de proyectos.`,
  args: z.object({
    title: z.string().describe("Titulo breve del requerimiento"),
    description: z.string().optional().describe("Descripcion detallada del requerimiento"),
    requestType: z.string().describe("Tipo de requerimiento - OBLIGATORIO"),
    brand: z.string().describe("Marca o empresa - OBLIGATORIO"),
    objective: z.string().optional().describe("Objetivo principal del proyecto"),
    keyMessage: z.string().optional().describe("Mensaje clave a comunicar"),
    kpis: z.string().optional().describe("KPIs o metricas de exito"),
    deadline: z.string().optional().describe("Fecha limite o timeline del proyecto"),
    budget: z.string().optional().describe("Presupuesto disponible"),
    approvers: z.string().optional().describe("Personas que deben aprobar el proyecto"),
    priority: z.string().optional().describe("Prioridad: baja, media, alta, urgente"),
  }),
  handler: async (ctx, args): Promise<string> => {
    console.log("\n========================================");
    console.log("[CreateTask] 🚀 CREANDO TASK CON WORKFLOW + COR");
    console.log("========================================");
    
    const threadId = ctx.threadId;
    
    if (!threadId) {
      console.error("[CreateTask] ERROR: No se encontro threadId");
      return "Error: No se pudo identificar el thread de la conversacion.";
    }

    console.log(`[CreateTask] ThreadId: ${threadId}`);

    // Verificar IDEMPOTENCIA: Si ya existe una task para este thread, no crear otra
    const existingTask = await ctx.runQuery(internal.data.tasks.getTaskByThreadInternal, { threadId });
    
    if (existingTask) {
      console.log(`[CreateTask] ⚠️ Ya existe task para este thread: ${existingTask._id}`);
      
      // Verificar si está sincronizada con COR
      const corStatus = existingTask.corSyncStatus === "synced" 
        ? `✅ Sincronizada con COR (ID: ${existingTask.corTaskId})`
        : existingTask.corSyncStatus === "error"
        ? "⚠️ Pendiente de sincronizar con COR"
        : "⏳ Sincronización en progreso";
      
      return `Ya existe un requerimiento para esta conversación.

ID del requerimiento: ${existingTask._id}
Estado COR: ${corStatus}

Si necesitas crear un nuevo requerimiento, por favor inicia una nueva conversación.`;
    }

    // Obtener el userId del thread para el campo createdBy
    const userId = await ctx.runQuery(internal.data.tasks.getUserIdFromThread, { threadId });
    console.log(`[CreateTask] UserId: ${userId || "no encontrado"}`);

    // WORKFLOW: Iniciar el workflow de creación de task
    // Esto proporciona:
    // - Durabilidad (sobrevive reinicios)
    // - Reintentos automáticos
    // - Idempotencia
    // - Sincronización con COR
    console.log("[CreateTask] ⏳ Iniciando creación de task con sincronización COR...");
    
    // Crear task y sincronizar con COR de forma síncrona
    // Esto devuelve el COR ID real inmediatamente al usuario
    const result = await ctx.runAction(internal.workflows.taskCreation.createTaskAndSyncWithCOR, {
      threadId,
      taskData: {
        title: args.title,
        description: args.description,
        requestType: args.requestType,
        brand: args.brand,
        objective: args.objective,
        keyMessage: args.keyMessage,
        kpis: args.kpis,
        deadline: args.deadline,
        budget: args.budget,
        approvers: args.approvers,
        priority: args.priority,
      },
      userId: userId || undefined,
      // El corProjectId se puede configurar en convex/integrations/cor.ts
      // o pasarlo dinámicamente si lo tienes disponible
    });
    
    console.log(`[CreateTask] ✅ Workflow completado`);
    console.log(`[CreateTask] 📋 Task ID local: ${result.taskId}`);
    console.log(`[CreateTask] 📋 COR Task ID: ${result.corTaskId || "N/A"}`);
    console.log(`[CreateTask] 📋 Estado: ${result.status}`);
    console.log("========================================\n");

    // Construir respuesta con el COR ID REAL
    if (result.status === "already_exists") {
      const corInfo = result.corTaskId 
        ? `✅ Sincronizado con COR (ID: **${result.corTaskId}**)`
        : "⚠️ Pendiente de sincronizar con COR";
      
      return `Ya existe un requerimiento para esta conversación.

**ID de tarea COR:** ${result.corTaskId || "Pendiente de sincronización"}
Estado COR: ${corInfo}

Si necesitas crear un nuevo requerimiento, por favor inicia una nueva conversación.`;
    }

    if (result.corSyncStatus === "synced" && result.corTaskId) {
      // ✅ Caso exitoso: Task creada y sincronizada con COR
      return `¡Requerimiento creado exitosamente!

📋 **ID de tu tarea en COR: ${result.corTaskId}**

✅ Tu requerimiento ha sido guardado y sincronizado con el sistema de gestión de proyectos COR.

El equipo ya puede ver y gestionar tu solicitud en COR con el ID **${result.corTaskId}**.

¿Hay algo más en lo que pueda ayudarte?`;
    } else {
      // ⚠️ Task creada localmente pero no sincronizada con COR
      return `⚠️ Requerimiento guardado con observaciones

Tu requerimiento ha sido guardado en el sistema local pero hubo un problema al sincronizarlo con COR.

📋 **Estado:**
- ✅ Guardado en el sistema local (ID interno: ${result.taskId})
- ❌ No se pudo sincronizar con COR: ${result.error || "Error desconocido"}

El equipo técnico será notificado para resolver la sincronización.

¿Hay algo más en lo que pueda ayudarte?`;
    }
  },
});

// ==================== TOOL PARA VER TASK ====================

// Tool que el agente puede usar para ver los detalles de una task existente
export const getTaskTool = createTool({
  description: `Ver los detalles completos de una task/requerimiento existente en la base de datos.
  Usar esta herramienta cuando el usuario quiera ver, consultar o revisar la informacion de un requerimiento.
  El usuario puede proporcionar el ID de la task o, si acaba de crear una task en esta conversacion, 
  el agente puede encontrarla automaticamente por el threadId.
  
  IMPORTANTE: Usar esta herramienta ANTES de editar para conocer los valores actuales.`,
  args: z.object({
    taskId: z.string().optional().describe("ID de la task a consultar (opcional si se busca por thread)"),
  }),
  handler: async (ctx, args): Promise<string> => {
    console.log("\n========================================");
    console.log("[GetTask] CONSULTANDO TASK");
    console.log("========================================");
    
    try {
      const threadId = ctx.threadId;
      let task = null;
      
      // Obtener el userId del thread actual para verificar permisos
      let currentUserId = null;
      if (threadId) {
        currentUserId = await ctx.runQuery(internal.data.tasks.getUserIdFromThread, { threadId });
        console.log(`[GetTask] Usuario actual: ${currentUserId}`);
      }
      
      // Si se proporciona taskId, buscar directamente por ID
      if (args.taskId) {
        console.log(`[GetTask] Buscando task por ID: ${args.taskId}`);
        task = await ctx.runQuery(internal.data.tasks.getTaskByIdInternal, { taskId: args.taskId });
        
        if (!task) {
          console.log(`[GetTask] Task no encontrada con ID: ${args.taskId}`);
          return `No se encontró ninguna task con el ID: ${args.taskId}. Verifica que el ID sea correcto.`;
        }
        
        // Verificar permisos: el usuario solo puede ver tasks creadas por él
        if (currentUserId && task.createdBy && task.createdBy !== currentUserId) {
          console.log(`[GetTask] Permiso denegado: usuario ${currentUserId} intentó acceder a task de ${task.createdBy}`);
          return "No tienes permiso para ver esta task. Solo puedes consultar requerimientos creados por ti.";
        }
      } else if (threadId) {
        // Si no hay taskId, buscar por threadId
        console.log(`[GetTask] Buscando task por threadId: ${threadId}`);
        task = await ctx.runQuery(internal.data.tasks.getTaskByThreadInternal, { threadId });
        
        if (!task) {
          console.log(`[GetTask] No hay task asociada al thread: ${threadId}`);
          return "No se encontró ninguna task asociada a esta conversación. ¿Deseas crear un nuevo requerimiento?";
        }
      } else {
        return "Error: No se pudo identificar la task a consultar. Por favor proporciona el ID de la task o asegúrate de estar en la conversación correcta.";
      }
      
      // Formatear la respuesta con todos los campos
      const corInfo = task.corTaskId 
        ? `**ID de tarea COR:** ${task.corTaskId} ✅`
        : "**Estado COR:** Pendiente de sincronización";
      
      const taskInfo = `
📋 **Detalles del Requerimiento**

${corInfo}

**Título:** ${task.title || "Sin título"}
**Estado:** ${task.status || "Sin estado"}
**Prioridad:** ${task.priority || "media"}

**Marca/Empresa:** ${task.brand || "No especificada"}
**Tipo de Requerimiento:** ${task.requestType || "No especificado"}

**Descripción:** ${task.description || "Sin descripción"}

**Objetivo:** ${task.objective || "No especificado"}
**Mensaje Clave:** ${task.keyMessage || "No especificado"}
**KPIs:** ${task.kpis || "No especificados"}

**Fecha Límite:** ${task.deadline || "No especificada"}
**Presupuesto:** ${task.budget || "No especificado"}
**Aprobadores:** ${task.approvers || "No especificados"}

**Archivos adjuntos:** ${task.fileIds?.length || 0}
`;
      console.log("[GetTask] Task encontrada y formateada exitosamente");
      console.log("========================================\n");
      return taskInfo;
      
    } catch (error) {
      console.error("[GetTask] Error al consultar task:", error);
      return `Error al consultar la task: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// ==================== TOOL PARA EDITAR TASK ====================

// Tool que el agente puede usar para editar una task existente
export const editTaskTool = createTool({
  description: `Editar una task/requerimiento existente en COR y en la base de datos local.
  Usar esta herramienta cuando el usuario quiera modificar informacion de un requerimiento que ya fue creado.
  
  El usuario puede proporcionar:
  - El COR ID de la task (ej: 11301144) - RECOMENDADO, busca directamente en COR
  - El ID local de la task
  - O si acaba de crear una task en esta conversacion, se encuentra automaticamente por el threadId
  
  FLUJO:
  1. Si se proporciona corTaskId, primero consulta COR para ver el estado actual de la task
  2. Aplica los cambios solicitados
  3. Actualiza tanto en COR como en la base de datos local
  
  IMPORTANTE: Solo actualiza los campos que el usuario quiere cambiar, no modifiques los demas.`,
  args: z.object({
    corTaskId: z.string().optional().describe("ID de la task en COR (ej: 11301144) - PREFERIDO"),
    taskId: z.string().optional().describe("ID local de la task (opcional si se usa corTaskId o thread)"),
    title: z.string().optional().describe("Nuevo titulo del requerimiento"),
    description: z.string().optional().describe("Nueva descripcion detallada"),
    requestType: z.string().optional().describe("Nuevo tipo de requerimiento"),
    brand: z.string().optional().describe("Nueva marca o empresa"),
    objective: z.string().optional().describe("Nuevo objetivo principal"),
    keyMessage: z.string().optional().describe("Nuevo mensaje clave"),
    kpis: z.string().optional().describe("Nuevos KPIs"),
    deadline: z.string().optional().describe("Nueva fecha limite"),
    budget: z.string().optional().describe("Nuevo presupuesto"),
    approvers: z.string().optional().describe("Nuevos aprobadores"),
    priority: z.string().optional().describe("Nueva prioridad: baja, media, alta, urgente"),
  }),
  handler: async (ctx, args): Promise<string> => {
    console.log("\n========================================");
    console.log("[EditTask] EDITANDO TASK");
    console.log("========================================");
    console.log("[EditTask] Datos recibidos:", JSON.stringify(args, null, 2));
    
    try {
      const threadId = ctx.threadId;
      let taskIdToEdit = args.taskId;
      let task = null;
      let corTaskData = null;
      
      // Obtener el userId del thread actual para verificar permisos
      let currentUserId = null;
      if (threadId) {
        currentUserId = await ctx.runQuery(internal.data.tasks.getUserIdFromThread, { threadId });
        console.log(`[EditTask] Usuario actual: ${currentUserId}`);
      }
      
      // PRIORIDAD 1: Si se proporciona corTaskId, buscar por COR ID
      if (args.corTaskId) {
        console.log(`[EditTask] 🔍 Buscando task por COR ID: ${args.corTaskId}`);
        
        // Primero, obtener la task desde COR para ver su estado actual
        const corResult = await ctx.runAction(internal.integrations.cor.getTaskFromCOR, {
          corTaskId: parseInt(args.corTaskId),
        });
        
        if (!corResult.success || !corResult.task) {
          console.log(`[EditTask] ❌ Task no encontrada en COR: ${corResult.error}`);
          return `No se encontró ninguna task con el COR ID: ${args.corTaskId} en el sistema COR.

Posibles causas:
- El ID no existe o fue eliminado
- No tienes permisos para ver esta task
- Error de conexión con COR

Por favor verifica el ID e intenta de nuevo.`;
        }
        
        corTaskData = corResult.task;
        console.log(`[EditTask] ✅ Task encontrada en COR:`, JSON.stringify(corTaskData, null, 2));
        
        // Buscar la task local por el COR ID
        task = await ctx.runQuery(internal.data.tasks.getTaskByCORIdInternal, { 
          corTaskId: args.corTaskId 
        });
        
        if (task) {
          taskIdToEdit = task._id;
          console.log(`[EditTask] 📋 Task local encontrada: ${taskIdToEdit}`);
        } else {
          console.log(`[EditTask] ⚠️ Task existe en COR pero no hay registro local`);
          // La task existe en COR pero no localmente - igual podemos editarla en COR
        }
      }
      // PRIORIDAD 2: Si se proporciona taskId local, buscar por ID
      else if (taskIdToEdit) {
        console.log(`[EditTask] Buscando task por ID local: ${taskIdToEdit}`);
        task = await ctx.runQuery(internal.data.tasks.getTaskByIdInternal, { taskId: taskIdToEdit });
        
        if (!task) {
          return `No se encontró ninguna task con el ID local: ${taskIdToEdit}. Verifica que el ID sea correcto.`;
        }
        
        // Verificar permisos
        if (currentUserId && task.createdBy && task.createdBy !== currentUserId) {
          console.log(`[EditTask] Permiso denegado: usuario ${currentUserId} intentó editar task de ${task.createdBy}`);
          return "No tienes permiso para editar esta task. Solo puedes modificar requerimientos creados por ti.";
        }
        
        // Si la task tiene COR ID, obtener datos de COR
        if (task.corTaskId) {
          const corResult = await ctx.runAction(internal.integrations.cor.getTaskFromCOR, {
            corTaskId: parseInt(task.corTaskId),
          });
          if (corResult.success && corResult.task) {
            corTaskData = corResult.task;
          }
        }
      } 
      // PRIORIDAD 3: Buscar por threadId
      else if (threadId) {
        console.log(`[EditTask] Buscando task por threadId: ${threadId}`);
        task = await ctx.runQuery(internal.data.tasks.getTaskByThreadInternal, { threadId });
        if (task) {
          taskIdToEdit = task._id;
          console.log(`[EditTask] Task encontrada: ${taskIdToEdit}`);
          
          // Si la task tiene COR ID, obtener datos de COR
          if (task.corTaskId) {
            const corResult = await ctx.runAction(internal.integrations.cor.getTaskFromCOR, {
              corTaskId: parseInt(task.corTaskId),
            });
            if (corResult.success && corResult.task) {
              corTaskData = corResult.task;
            }
          }
        }
      }
      
      // Si no encontramos ninguna task
      if (!taskIdToEdit && !args.corTaskId) {
        return "Error: No se pudo identificar la task a editar. Por favor proporciona el COR ID de la task (ej: 11301144), el ID local, o asegurate de estar en la conversacion correcta.";
      }
      
      // Construir objeto con solo los campos a actualizar
      const updates: Record<string, string | undefined> = {};
      if (args.title !== undefined) updates.title = args.title;
      if (args.description !== undefined) updates.description = args.description;
      if (args.requestType !== undefined) updates.requestType = args.requestType;
      if (args.brand !== undefined) updates.brand = args.brand;
      if (args.objective !== undefined) updates.objective = args.objective;
      if (args.keyMessage !== undefined) updates.keyMessage = args.keyMessage;
      if (args.kpis !== undefined) updates.kpis = args.kpis;
      if (args.deadline !== undefined) updates.deadline = args.deadline;
      if (args.budget !== undefined) updates.budget = args.budget;
      if (args.approvers !== undefined) updates.approvers = args.approvers;
      if (args.priority !== undefined) updates.priority = args.priority;
      
      if (Object.keys(updates).length === 0) {
        // Si no hay campos para actualizar pero tenemos datos de COR, mostrar la task actual
        if (corTaskData) {
          return `📋 **Task actual en COR (ID: ${corTaskData.id})**

**Título:** ${corTaskData.title}
**Descripción:** ${corTaskData.description || "Sin descripción"}
**Estado:** ${corTaskData.status}
**Prioridad:** ${corTaskData.priority}
**Deadline:** ${corTaskData.deadline || "Sin fecha límite"}

¿Qué cambios quieres hacer?`;
        }
        return "No se proporcionaron campos para actualizar.";
      }
      
      console.log(`[EditTask] Campos a actualizar:`, JSON.stringify(updates, null, 2));
      
      // ACTUALIZAR EN COR PRIMERO (si tenemos COR ID)
      let corUpdateResult = null;
      const corIdToUpdate = args.corTaskId || task?.corTaskId;
      
      if (corIdToUpdate) {
        console.log(`[EditTask] 🔄 Actualizando en COR (Task ID: ${corIdToUpdate})...`);
        
        try {
          corUpdateResult = await ctx.runAction(internal.integrations.cor.updateTaskInCOR, {
            corTaskId: parseInt(corIdToUpdate),
            title: args.title,
            description: args.description,
            deadline: args.deadline,
            priority: args.priority,
          });
          
          if (corUpdateResult.success) {
            console.log("[EditTask] ✅ Task actualizada en COR");
          } else {
            console.error("[EditTask] ⚠️ Error al actualizar en COR:", corUpdateResult.error);
          }
        } catch (corError) {
          console.error("[EditTask] ⚠️ Error al actualizar en COR:", corError);
        }
      }
      
      // ACTUALIZAR EN BASE DE DATOS LOCAL (si existe registro local)
      if (taskIdToEdit) {
        await ctx.runMutation(internal.data.tasks.updateTaskInternal, {
          taskId: taskIdToEdit,
          updates,
        });
        console.log(`[EditTask] ✅ Task ${taskIdToEdit} actualizada localmente`);
      }
      
      console.log("========================================\n");
      
      const updatedFields = Object.keys(updates).join(", ");
      
      // Construir respuesta según el resultado
      let corStatus = "";
      if (corIdToUpdate) {
        if (corUpdateResult?.success) {
          corStatus = `\n✅ Cambios aplicados en COR (ID: ${corIdToUpdate})`;
        } else if (corUpdateResult) {
          corStatus = `\n⚠️ No se pudieron aplicar los cambios en COR: ${corUpdateResult.error}`;
        }
      }
      
      return `✅ Task actualizada exitosamente!

**ID de tarea COR:** ${corIdToUpdate || "No sincronizada"}
**Campos actualizados:** ${updatedFields}${corStatus}

¿Hay algo más que quieras modificar?`;
    } catch (error) {
      console.error("[EditTask] Error actualizando task:", error);
      return `Error al actualizar la task: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

// ==================== MUTATIONS ====================

// Mutation interna para crear task (llamada desde el tool o workflow)
export const createTaskInternal = internalMutation({
  args: {
    title: v.string(),
    description: v.optional(v.string()),
    requestType: v.string(),
    brand: v.string(),
    objective: v.optional(v.string()),
    keyMessage: v.optional(v.string()),
    kpis: v.optional(v.string()),
    deadline: v.optional(v.string()),
    budget: v.optional(v.string()),
    approvers: v.optional(v.string()),
    priority: v.optional(v.string()),
    threadId: v.string(),
    status: v.string(),
    fileIds: v.optional(v.array(v.string())),
    createdBy: v.optional(v.string()),
    // Campos para sincronización con COR
    corTaskId: v.optional(v.string()),
    corProjectId: v.optional(v.number()),
    corSyncStatus: v.optional(v.string()),
    corSyncError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    console.log("[Tasks.createTaskInternal] Insertando en base de datos...");
    
    const taskId = await ctx.db.insert("tasks", {
      title: args.title,
      description: args.description,
      requestType: args.requestType,
      brand: args.brand,
      objective: args.objective,
      keyMessage: args.keyMessage,
      kpis: args.kpis,
      deadline: args.deadline,
      budget: args.budget,
      approvers: args.approvers,
      priority: args.priority || "media",
      threadId: args.threadId,
      status: args.status,
      fileIds: args.fileIds,
      createdBy: args.createdBy,
      // Campos COR
      corTaskId: args.corTaskId,
      corProjectId: args.corProjectId,
      corSyncStatus: args.corSyncStatus,
      corSyncError: args.corSyncError,
    });
    
    console.log(`[Tasks.createTaskInternal] Task insertada con ID: ${taskId}`);
    console.log(`[Tasks.createTaskInternal] Detalles: Marca=${args.brand}, Tipo=${args.requestType}`);
    
    return taskId;
  },
});

// Mutation interna para actualizar task (llamada desde el editTaskTool)
export const updateTaskInternal = internalMutation({
  args: {
    taskId: v.string(),
    updates: v.object({
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      requestType: v.optional(v.string()),
      brand: v.optional(v.string()),
      objective: v.optional(v.string()),
      keyMessage: v.optional(v.string()),
      kpis: v.optional(v.string()),
      deadline: v.optional(v.string()),
      budget: v.optional(v.string()),
      approvers: v.optional(v.string()),
      priority: v.optional(v.string()),
    }),
  },
  handler: async (ctx, args) => {
    console.log(`[Tasks.updateTaskInternal] Actualizando task ${args.taskId}...`);
    
    // Filtrar campos undefined
    const updateData: any = {};
    for (const [key, value] of Object.entries(args.updates)) {
      if (value !== undefined) {
        updateData[key] = value;
      }
    }
    
    await ctx.db.patch(args.taskId as any, updateData);
    
    console.log(`[Tasks.updateTaskInternal] Task actualizada`);
    return args.taskId;
  },
});

// Query interna para obtener task por threadId
export const getTaskByThreadInternal = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    return task;
  },
});

// Query interna para obtener task por ID
export const getTaskByIdInternal = internalQuery({
  args: {
    taskId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Buscar la task usando query en lugar de get para asegurar el tipo correcto
      const tasks = await ctx.db
        .query("tasks")
        .filter((q) => q.eq(q.field("_id"), args.taskId))
        .collect();
      return tasks[0] || null;
    } catch {
      return null;
    }
  },
});

// Query interna para obtener task por COR ID
export const getTaskByCORIdInternal = internalQuery({
  args: {
    corTaskId: v.string(),
  },
  handler: async (ctx, args) => {
    // Buscar la task que tenga este COR ID
    const task = await ctx.db
      .query("tasks")
      .filter((q) => q.eq(q.field("corTaskId"), args.corTaskId))
      .first();
    return task;
  },
});

// Query interna para obtener el userId del thread
export const getUserIdFromThread = internalQuery({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const chatThread = await ctx.db
      .query("chatThreads")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    return chatThread?.userId || null;
  },
});

// Mutation para actualizar el estado de una task
export const updateTaskStatus = mutation({
  args: {
    taskId: v.id("tasks"),
    status: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: args.status,
    });
    return args.taskId;
  },
});

// Mutation para agregar fileIds a una task existente
export const addFilesToTask = mutation({
  args: {
    taskId: v.id("tasks"),
    fileIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task no encontrada");
    
    const currentFileIds = task.fileIds || [];
    const newFileIds = [...currentFileIds, ...args.fileIds];
    
    await ctx.db.patch(args.taskId, {
      fileIds: newFileIds,
    });
    return args.taskId;
  },
});

// ==================== BACKGROUND JOB: Asociar archivos a task ====================
// Esta acción se ejecuta en background después de crear una task
// para buscar y asociar los archivos del thread sin bloquear la respuesta
// TAMBIÉN envía los archivos a COR como attachments si la task está sincronizada
export const associateFilesToTask = internalAction({
  args: {
    taskId: v.string(),
    threadId: v.string(),
    corTaskId: v.optional(v.number()), // ID de la task en COR para enviar attachments
  },
  handler: async (ctx, args): Promise<void> => {
    console.log(`[AssociateFiles] Buscando archivos para task ${args.taskId}...`);
    
    try {
      // Obtener todos los mensajes del thread
      const messagesResult = await listMessages(ctx, components.agent, {
        threadId: args.threadId,
        paginationOpts: { cursor: null, numItems: 20 },
      });
      
      const allFileIds: string[] = [];
      
      // Buscar fileIds en cada mensaje
      for (const msg of messagesResult.page) {
        const msgAny = msg as any;
        
        // Verificar si el mensaje tiene fileIds (guardados como metadata)
        if (msgAny.fileIds && Array.isArray(msgAny.fileIds)) {
          console.log(`[AssociateFiles] FileIds encontrados: ${msgAny.fileIds}`);
          allFileIds.push(...msgAny.fileIds);
        }
      }
      
      if (allFileIds.length > 0) {
        console.log(`[AssociateFiles] Asociando ${allFileIds.length} archivos a task ${args.taskId}`);
        
        // Actualizar la task con los fileIds encontrados
        await ctx.runMutation(internal.data.tasks.updateTaskFileIds, {
          taskId: args.taskId,
          fileIds: allFileIds,
        });
        
        console.log(`[AssociateFiles] ✅ Archivos asociados exitosamente a task local`);
        
        // Si la task está sincronizada con COR, enviar los archivos como mensaje con attachments
        if (args.corTaskId) {
          console.log(`[AssociateFiles] 📎 Enviando archivos a COR (Task ID: ${args.corTaskId})...`);
          
          try {
            // Obtener información y URLs de cada archivo
            const attachments: { name: string; url: string; type: string; source: string }[] = [];
            
            for (const fileId of allFileIds) {
              try {
                // Obtener info del archivo desde el agente
                const fileInfo = await ctx.runQuery(internal.data.tasks.getFileInfoInternal, { fileId });
                
                if (fileInfo && fileInfo.url) {
                  attachments.push({
                    name: fileInfo.filename || `archivo_${fileId}`,
                    url: fileInfo.url,
                    type: fileInfo.mimeType || "application/octet-stream",
                    source: "convex",
                  });
                  console.log(`[AssociateFiles] 📎 Archivo preparado: ${fileInfo.filename}`);
                }
              } catch (fileError) {
                console.error(`[AssociateFiles] ⚠️ Error obteniendo archivo ${fileId}:`, fileError);
              }
            }
            
            // Si hay attachments, enviar mensaje a COR
            if (attachments.length > 0) {
              await ctx.runAction(internal.integrations.cor.postTaskMessage, {
                corTaskId: args.corTaskId,
                message: `📎 Archivos adjuntos del brief (${attachments.length} archivo${attachments.length > 1 ? 's' : ''})`,
                attachments,
              });
              console.log(`[AssociateFiles] ✅ ${attachments.length} archivos enviados a COR`);
            }
          } catch (corError) {
            console.error(`[AssociateFiles] ⚠️ Error enviando archivos a COR:`, corError);
            // No fallar si COR tiene problemas, los archivos ya están asociados localmente
          }
        }
      } else {
        console.log(`[AssociateFiles] No se encontraron archivos en el thread`);
      }
    } catch (error) {
      console.error(`[AssociateFiles] Error:`, error);
    }
  },
});

// Query interna para obtener información de un archivo
export const getFileInfoInternal = internalQuery({
  args: {
    fileId: v.string(),
  },
  handler: async (ctx, args) => {
    try {
      // Obtener el documento file del componente agent
      const fileDoc = await ctx.runQuery(
        components.agent.files.get,
        { fileId: args.fileId }
      );
      
      if (!fileDoc) {
        console.error(`[Files] No se encontró el archivo con fileId: ${args.fileId}`);
        return null;
      }
      
      // Obtener la URL desde el storageId
      const url = await ctx.storage.getUrl(fileDoc.storageId);
      
      return {
        fileId: args.fileId,
        filename: fileDoc.filename || `archivo_${args.fileId}`,
        mimeType: fileDoc.mimeType,
        url,
      };
    } catch (error) {
      console.error(`[Files] Error obteniendo info para fileId ${args.fileId}:`, error);
      return null;
    }
  },
});

// Mutation interna para actualizar fileIds de una task
export const updateTaskFileIds = internalMutation({
  args: {
    taskId: v.string(),
    fileIds: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId as any, {
      fileIds: args.fileIds,
    });
    return args.taskId;
  },
});

// ==================== QUERIES ====================

// Obtener task por threadId
export const getTaskByThread = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .first();
    
    return task;
  },
});

// Obtener una task por ID
export const getTask = query({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.taskId);
  },
});

// Listar todas las tasks
export const listTasks = query({
  args: {
    status: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    if (args.status) {
      return await ctx.db
        .query("tasks")
        .withIndex("by_status", (q) => q.eq("status", args.status!))
        .collect();
    }
    return await ctx.db.query("tasks").collect();
  },
});

// Listar tasks por threadId
export const listByThread = query({
  args: {
    threadId: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_thread", (q) => q.eq("threadId", args.threadId))
      .collect();
  },
});
