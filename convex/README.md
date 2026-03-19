# Convex Backend - Estructura del Proyecto PTO99 Agent

## Organización de Archivos

Este directorio contiene el backend de Convex para el sistema de Brief Collection con agentes de IA.

### 🔑 Archivos de Configuración

| Archivo            | Descripción                                              |
| ------------------ | -------------------------------------------------------- |
| `schema.ts`        | Esquema de la base de datos (tablas y tipos)             |
| `convex.config.ts` | Configuración del componente Agent de Convex             |
| `serverConfig.ts`  | Configuración compartida para agentes (prompts, nombres) |
| `auth.config.ts`   | Configuración de proveedores de autenticación            |

### 🤖 Agentes de IA

| Archivo                   | Descripción                                                                      |
| ------------------------- | -------------------------------------------------------------------------------- |
| `agent.ts`                | **Brief Agent** - Agente principal para recolección de briefs                    |
| `evaluatorAgentAction.ts` | **Evaluator Agent** - Evalúa entregables vs requerimientos (usa Node.js runtime) |
| `reviewerAgent.ts`        | **Reviewer Agent** - Revisa y valida briefs antes de crear tasks                 |
| `evaluatorAgent.ts`       | ⚠️ DEPRECATED - Versión anterior del evaluador                                   |

### 📡 API y Endpoints

| Archivo               | Descripción                                |
| --------------------- | ------------------------------------------ |
| `chat.ts`             | Mutations y queries para el chat principal |
| `threads.ts`          | CRUD de threads/conversaciones             |
| `tasks.ts`            | Herramientas y CRUD para tareas/briefs     |
| `evaluation.ts`       | Mutations para evaluación de entregables   |
| `evaluatorQueries.ts` | Queries para la UI de evaluación           |
| `files.ts`            | Gestión de archivos subidos (Storage)      |
| `speechToText.ts`     | Transcripción de audio a texto             |

### 👥 Usuarios y Preferencias

| Archivo          | Descripción                                |
| ---------------- | ------------------------------------------ |
| `auth.ts`        | Funciones de autenticación (getUser, etc.) |
| `users.ts`       | Queries y mutations de usuarios            |
| `preferences.ts` | Preferencias de usuario (tema, etc.)       |
| `workspaces.ts`  | Gestión de espacios de trabajo             |

### 🌐 HTTP

| Archivo   | Descripción             |
| --------- | ----------------------- |
| `http.ts` | Endpoints HTTP públicos |

## Convenciones

1. **Agentes**: Archivos que definen instancias de `Agent` de `@convex-dev/agent`
2. **Tools**: Se definen en el mismo archivo del agente o en archivos separados con suffix `Tools`
3. **Node.js Runtime**: Archivos que necesitan más memoria usan `"use node"` al inicio
4. **Deprecation**: Archivos deprecated mantienen comentario al inicio

## Dependencias entre Archivos

```
serverConfig.ts
    ↓
agent.ts ←── chat.ts
evaluatorAgentAction.ts ←── evaluation.ts
reviewerAgent.ts ←── agent.ts (via tool)
    ↓
tasks.ts (define tools usados por agents)
```

## Notas

- El esquema está en `schema.ts` - todas las tablas se definen ahí
- Los archivos `_generated/` son auto-generados por Convex - NO modificar
- Para agregar un nuevo agente, seguir el patrón de `agent.ts`
