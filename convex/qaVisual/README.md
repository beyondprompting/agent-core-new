# Piloto de QA Visual

La página local utiliza `QA_VISUAL_LOCAL_ROOT`. **Analizar piezas** analiza las imágenes de la campaña en el orden del inventario. **Reintentar fallidas** vuelve a tomar las piezas con error de la última ejecución.

Sincronizá el esquema y las funciones con el despliegue de desarrollo mediante `npx convex dev`. El análisis usa los proveedores configurados en `convex/lib/llmFallback.ts` y sus claves en el entorno de Convex. Next.js calcula el hash y las dimensiones del original y prepara una copia JPEG para que el workflow la analice.

Las reglas iniciales comparan dimensiones, producto y precio con el CSV. Para evaluar vigencia, CTA u otros criterios, agregá referencias aprobadas a un archivo JSON e indicá su ruta en `QA_VISUAL_RULES_FILE` en `.env.local`. Por ejemplo:

```json
{
  "rules": [
    {
      "id": "cta",
      "criterion": "Verificar que la pieza invite explícitamente a descargar la aplicación.",
      "source": "Matriz aprobada · hoja REGLAS, celda B12",
      "severity": "warning",
      "expectedByPiece": {
        "nombre-de-la-pieza.png": "Llamado explícito a descargar la aplicación"
      }
    }
  ]
}
```

Usá el nombre completo del archivo o el nombre sin extensión como clave. Los controles sin referencia quedan **No verificables**. Al cambiar reglas o insumos, recargá la página para ver qué resultados quedaron desactualizados.
