// convex/integrations/corProvider.ts
// =====================================================
// Provider de COR (ProjectCOR) para el sistema de integraciones.
// Implementa la interface ProjectManagementProvider con llamadas
// a la API REST de COR v1.
//
// Este archivo contiene funciones puras (no Convex primitives).
// Se invocan desde dentro de Convex actions.
//
// NOTA: El archivo cor.ts original se mantiene para backward compatibility
// con las internalActions existentes. Este provider es la nueva abstracción
// que se usará para las nuevas funcionalidades (searchClient, createProject).
// =====================================================

import type {
  ProjectManagementProvider,
  ExternalClient,
  ExternalProject,
  ExternalTask,
  CreateProjectInput,
  CreateTaskInput,
  UpdateTaskInput,
} from "./types";

// ==================== CONFIGURACIÓN ====================

const COR_API_BASE_URL = "https://api.projectcor.com/v1";

// ==================== TIPOS INTERNOS COR ====================

interface CORTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
}

// ==================== HELPERS HTTP ====================

/**
 * Obtiene un access token de COR usando Client Credentials flow.
 * Las credenciales deben estar en env vars: COR_API_KEY y COR_CLIENT_SECRET
 */
async function getCORAccessToken(): Promise<string> {
  const apiKey = process.env.COR_API_KEY;
  const clientSecret = process.env.COR_CLIENT_SECRET;

  if (!apiKey || !clientSecret) {
    throw new Error(
      "COR credentials not configured. Set COR_API_KEY and COR_CLIENT_SECRET in Convex dashboard."
    );
  }

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
    throw new Error(`COR auth failed: ${response.status} - ${errorText}`);
  }

  const tokenData: CORTokenResponse = await response.json();
  return tokenData.access_token;
}

/**
 * Mapea prioridades internas al formato numérico de COR.
 * Interno: "baja" | "media" | "alta" | "urgente"
 * COR: 0 = Low, 1 = Medium, 2 = High, 3 = Urgent
 */
function mapPriorityToCOR(priority: string | undefined): number {
  switch (priority?.toLowerCase()) {
    case "baja":
    case "low":
      return 0;
    case "alta":
    case "high":
      return 2;
    case "urgente":
    case "urgent":
      return 3;
    case "media":
    case "medium":
    default:
      return 1;
  }
}

/**
 * Wrapper genérico para llamadas autenticadas a la API de COR.
 * Obtiene el token automáticamente y agrega headers de auth.
 */
async function corApiFetch(
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const accessToken = await getCORAccessToken();

  return fetch(`${COR_API_BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string> || {}),
    },
  });
}

// ==================== HELPERS: FEES ====================

/**
 * Obtiene el primer fee activo de un cliente en COR.
 * COR requiere fee_id al crear un proyecto.
 * Endpoint: GET /clients/{client_id}/fees
 */
async function getFirstActiveFeeForClient(clientId: number): Promise<number | null> {
  try {
    const response = await corApiFetch(`/clients/${clientId}/fees`);

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[COR Provider] ❌ Error obteniendo fees del cliente ${clientId}: ${response.status} - ${errorText}`);
      return null;
    }

    const fees = await response.json();
    
    // fees puede ser un array directo o un objeto con propiedad "data"
    const feeList = Array.isArray(fees) ? fees : (fees.data || []);
    
    if (feeList.length === 0) {
      console.log(`[COR Provider] ⚠️ El cliente ${clientId} no tiene fees`);
      return null;
    }

    // Preferir fee activo, si no tomar el primero
    const activeFee = feeList.find((f: any) => f.status === "active") || feeList[0];
    console.log(`[COR Provider] ✅ Fee encontrado: ${activeFee.id} (${activeFee.name || "sin nombre"}, status: ${activeFee.status || "unknown"})`);
    
    return activeFee.id;
  } catch (error) {
    console.error(`[COR Provider] ❌ Error en getFirstActiveFeeForClient:`, error);
    return null;
  }
}

// ==================== FACTORY DEL PROVIDER ====================

/**
 * Crea una instancia del provider de COR.
 * 
 * Uso:
 * ```
 * const provider = createCORProvider();
 * const client = await provider.searchClient("Coca Cola");
 * const project = await provider.createProject({ name: "Campaña Q1", clientId: client.id });
 * const task = await provider.createTask({ projectId: project.id, title: "Diseño banner" });
 * ```
 */
export function createCORProvider(): ProjectManagementProvider {
  return {
    name: "cor",

    // ==================== SEARCH CLIENT ====================

    async searchClient(name: string): Promise<ExternalClient | null> {
      console.log(`[COR Provider] 🔍 Buscando cliente: "${name}"`);

      try {
        const encodedName = encodeURIComponent(name);
        const response = await corApiFetch(`/clients/search-by-name/${encodedName}`);

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[COR Provider] ❌ Error buscando cliente: ${response.status} - ${errorText}`);
          return null;
        }

        const result = await response.json();
        
        // La API puede retornar un array directo o un objeto con propiedad "data"
        const clients = Array.isArray(result) ? result : (result.data || []);

        if (clients.length === 0) {
          console.log(`[COR Provider] ⚠️ No se encontró cliente con nombre "${name}"`);
          return null;
        }

        // Tomar el primer resultado (más relevante)
        const client = clients[0];
        console.log(`[COR Provider] ✅ Cliente encontrado: ${client.name} (ID: ${client.id})`);

        return {
          id: client.id,
          name: client.name,
          businessName: client.business_name,
          email: client.email_contact,
        };
      } catch (error) {
        console.error(`[COR Provider] ❌ Error en searchClient:`, error);
        return null;
      }
    },

    // ==================== CREATE PROJECT ====================

    async createProject(data: CreateProjectInput): Promise<ExternalProject> {
      console.log(`[COR Provider] 🚀 Creando proyecto: "${data.name}" (client_id: ${data.clientId})`);

      // 1. Resolver fee_id — COR lo requiere para crear un proyecto
      let feeId = data.feeId;
      if (!feeId) {
        console.log(`[COR Provider] 🔍 Buscando fees para cliente ${data.clientId}...`);
        const resolvedFeeId = await getFirstActiveFeeForClient(data.clientId);
        if (!resolvedFeeId) {
          throw new Error(
            `No se encontró un fee activo para el cliente ${data.clientId}. ` +
            `Asegúrate de que el cliente tenga al menos un fee/tarifa activa en COR.`
          );
        }
        feeId = resolvedFeeId;
        console.log(`[COR Provider] ✅ Fee encontrado: ${feeId}`);
      }

      // 2. Construir body del request
      const body: Record<string, unknown> = {
        name: data.name,
        client_id: data.clientId,
        fee_id: feeId,
      };

      if (data.description) {
        body.brief = data.description;
      }

      if (data.deadline) {
        const deadlineDate = new Date(data.deadline);
        if (!isNaN(deadlineDate.getTime())) {
          // COR espera formato YYYY-MM-DD para start/end
          body.end = deadlineDate.toISOString().split("T")[0];
        }
      }

      // 3. Crear proyecto en COR
      const response = await corApiFetch("/projects", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[COR Provider] ❌ Error creando proyecto: ${response.status} - ${errorText}`);
        throw new Error(`Error creando proyecto en COR: ${response.status} - ${errorText}`);
      }

      const project = await response.json();
      console.log(`[COR Provider] ✅ Proyecto creado: ID ${project.id}, nombre: "${project.name}"`);

      return {
        id: project.id,
        name: project.name,
        clientId: data.clientId,
      };
    },

    // ==================== CREATE TASK ====================

    async createTask(data: CreateTaskInput): Promise<ExternalTask> {
      console.log(`[COR Provider] 🚀 Creando task: "${data.title}" (project_id: ${data.projectId})`);

      const body: Record<string, unknown> = {
        title: data.title,
        project_id: data.projectId,
        priority: mapPriorityToCOR(data.priority),
      };

      if (data.description) {
        body.description = data.description;
      }

      if (data.deadline) {
        const deadlineDate = new Date(data.deadline);
        if (!isNaN(deadlineDate.getTime())) {
          body.deadline = deadlineDate.toISOString();
        }
      }

      const response = await corApiFetch("/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`[COR Provider] ❌ Error creando task: ${response.status} - ${errorText}`);
        throw new Error(`Error creando task en COR: ${response.status} - ${errorText}`);
      }

      const task = await response.json();
      console.log(`[COR Provider] ✅ Task creada: ID ${task.id}`);

      return {
        id: task.id,
        title: task.title,
        projectId: task.project_id,
        description: task.description,
        deadline: task.deadline,
        status: task.status,
        priority: task.priority,
      };
    },

    // ==================== GET TASK ====================

    async getTask(taskId: number): Promise<ExternalTask | null> {
      console.log(`[COR Provider] 🔍 Obteniendo task: ${taskId}`);

      try {
        const response = await corApiFetch(`/tasks/${taskId}`);

        if (!response.ok) {
          console.error(`[COR Provider] ❌ Error obteniendo task: ${response.status}`);
          return null;
        }

        const task = await response.json();

        return {
          id: task.id,
          title: task.title,
          projectId: task.project_id,
          description: task.description,
          deadline: task.deadline,
          status: task.status,
          priority: task.priority,
        };
      } catch (error) {
        console.error(`[COR Provider] ❌ Error en getTask:`, error);
        return null;
      }
    },

    // ==================== UPDATE TASK ====================

    async updateTask(
      taskId: number,
      data: UpdateTaskInput
    ): Promise<{ success: boolean; error?: string }> {
      console.log(`[COR Provider] 🔄 Actualizando task: ${taskId}`);

      try {
        // 1. GET actual para preservar campos no modificados
        const getResponse = await corApiFetch(`/tasks/${taskId}`);

        if (!getResponse.ok) {
          return {
            success: false,
            error: `No se pudo obtener la task actual: ${getResponse.status}`,
          };
        }

        const currentTask = await getResponse.json();

        // 2. Merge seguro: solo sobrescribir campos explícitamente proporcionados
        const updateBody: Record<string, unknown> = {
          title: data.title ?? currentTask.title,
          description: data.description ?? currentTask.description,
          priority: data.priority
            ? mapPriorityToCOR(data.priority)
            : currentTask.priority,
          status: data.status ?? currentTask.status,
          deadline: currentTask.deadline,
        };

        if (data.deadline) {
          const d = new Date(data.deadline);
          if (!isNaN(d.getTime())) {
            updateBody.deadline = d.toISOString();
          }
        }

        // 3. PUT con objeto completo
        const putResponse = await corApiFetch(`/tasks/${taskId}`, {
          method: "PUT",
          body: JSON.stringify(updateBody),
        });

        if (!putResponse.ok) {
          const errorText = await putResponse.text();
          return {
            success: false,
            error: `COR API error: ${putResponse.status} - ${errorText}`,
          };
        }

        console.log(`[COR Provider] ✅ Task ${taskId} actualizada correctamente`);
        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
