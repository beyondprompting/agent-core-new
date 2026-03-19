# PTO99 Brief Assistant

Asistente inteligente para recolectar información de Brief de proyectos.

## Configuración

1. Instalar dependencias:

```bash
npm install
```

2. Configurar Convex:

```bash
npx convex dev
```

3. Agregar las variables de entorno en el archivo `.env.local`:

```
NEXT_PUBLIC_CONVEX_URL=<tu-url-de-convex>
```

4. Configurar la API key de Google AI en Convex Dashboard:

- Ve a tu proyecto en [Convex Dashboard](https://dashboard.convex.dev)
- Settings → Environment Variables
- Agrega: `GOOGLE_API_KEY=<tu-api-key>`

## Desarrollo

```bash
npm run dev
```

## Funcionalidad

El asistente recolecta la siguiente información del brief:

### Obligatorio:

- Tipo de requerimiento
- Marca
- Objetivo
- Mensaje clave
- Timing
- Aprobadores involucrados

### Opcional:

- KPIs
- Presupuesto
- Archivos adjuntos

Una vez recopilada toda la información obligatoria, el asistente presenta un resumen completo del brief.

## Sistema de Fallback LLM

El sistema implementa fallback automático entre proveedores de IA:

- **Primario**: Google Gemini 3 Pro Preview
- **Fallback**: OpenAI GPT-5.2

### Configuración de API Keys

En el Convex Dashboard (Settings → Environment Variables), agregar:

```
GOOGLE_API_KEY=<tu-api-key-de-google>
OPENAI_API_KEY=<tu-api-key-de-openai>
```

### Testing del Fallback

El sistema permite simular caídas de proveedores para testing:

```javascript
// En la consola del navegador o desde código:

// Deshabilitar Gemini (forzar uso de OpenAI)
await convex.mutation(api.llmConfig.setProviderEnabled, {
  provider: "gemini",
  enabled: false,
});

// Deshabilitar OpenAI
await convex.mutation(api.llmConfig.setProviderEnabled, {
  provider: "openai",
  enabled: false,
});

// Deshabilitar ambos (simular error total)
await convex.mutation(api.llmConfig.setProviderEnabled, {
  provider: "gemini",
  enabled: false,
});
await convex.mutation(api.llmConfig.setProviderEnabled, {
  provider: "openai",
  enabled: false,
});

// Restaurar un proveedor
await convex.mutation(api.llmConfig.restoreProvider, { provider: "gemini" });

// Resetear toda la configuración (ambos habilitados)
await convex.mutation(api.llmConfig.resetAllConfigs, {});
```

### Monitoreo de Errores

```javascript
// Ver errores recientes
const errors = await convex.query(api.llmConfig.getRecentErrors, { limit: 20 });

// Ver estadísticas de errores por proveedor
const stats = await convex.query(api.llmConfig.getErrorStats, {});

// Limpiar errores antiguos (más de 7 días)
await convex.mutation(api.llmConfig.cleanupOldErrors, {});
```

### Comportamiento del Fallback

1. **Gemini disponible**: Se usa Gemini (primario)
2. **Gemini falla**: Automáticamente cambia a OpenAI
3. **OpenAI falla también**: Muestra mensaje de error amigable al usuario
4. **Ambos deshabilitados**: Muestra mensaje de mantenimiento

Los errores se registran en la tabla `llmErrors` para análisis posterior.
