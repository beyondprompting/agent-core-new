# QA Visual

Configurá `QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON` en el despliegue de Convex. Compartí cada carpeta de campaña con la cuenta de servicio como lectora. En **QA Visual → Agregar campaña**, pegá el enlace de la carpeta. Cada campaña queda registrada en `qaVisualCampaigns`. Convex lee la matriz XLSX de `RECURSOS`, el CSV de producción de `EDITABLES` y las imágenes PNG o JPEG de `DESPLIEGUE`.

Al agregar una campaña, Convex importa en segundo plano los originales del Excel y el CSV y guarda el inventario, los campos de producción y los requisitos por pieza. El editor lee la última importación lista. **Actualizar desde Drive** comprueba si las fuentes cambiaron y publica una importación nueva solo cuando termina correctamente.

**Analizar piezas** toma las imágenes en el orden del inventario. La corrida usa los requisitos de la importación que estaba abierta. Convex prepara las imágenes para análisis y ejecuta el workflow existente. **Reintentar fallidas** vuelve a tomar las piezas con error de la última ejecución.

Las reglas parten de las hojas `PRODUCCION`, `LEYENDA` y `REGLAS`. Para agregar referencias aprobadas por pieza, el despliegue también admite un JSON opcional en `QA_VISUAL_RULES_JSON`, limitado a la carpeta que se indique en `QA_VISUAL_GOOGLE_FOLDER_ID` con la estructura `{"rules":[{"id":"cta","criterion":"Criterio de revisión","source":"REGLAS!B12","severity":"warning","expectedByPiece":{"pieza.png":"Texto esperado"}}]}`. Usá el nombre completo del archivo o el nombre sin extensión como clave. Al cambiar las fuentes o reglas, usá **Actualizar desde Drive** para aplicar los cambios.

La acción interna `qaVisual/mediaHttp:probe` verifica la lectura y el procesamiento de una campaña. Ejecutala en Convex Dev con `{"folderUrl":"https://drive.google.com/drive/folders/ID"}` para comprobar la conexión.

## Vinculación, cobertura y revisión guardada

La interpretación del pedido vive en `model/`. Cada control guarda su estado, base (cliente o producción), procedencia y avisos. Se aceptan coincidencias exactas, equivalencias por conectores y coincidencias parciales sin cambiar cantidades; las ambigüedades requieren confirmación. Los vínculos manuales se reprocesan desde los originales en Storage.

El modelo lee precio y vigencia y el código compara esos valores. El dictamen se calcula con la cobertura: fuentes en conflicto, controles sin verificar, referencias solo de producción y revisiones solo técnicas nunca se muestran como validadas. Si falla la localización de un hallazgo, se conserva como comentario general.

La política `qa-visual-4` exige que todos los controles visuales solicitados tengan evidencia del modelo. Los avisos `warning` o `blocking` que afectan a un control solicitado impiden la validación; los informativos no. Una coincidencia parcial se puede confirmar desde su aviso, y la confirmación resuelve ese bloqueo al reprocesar. El resumen muestra el motivo principal y Detalles enumera todos los pendientes. Los resultados de políticas anteriores se muestran como desactualizados, también antes de actualizar la importación, y requieren excepción para una aprobación humana.

`qaVisualPieces` y `qaVisualPieceVersions` identifican la pieza y el contenido de cada entrega. Las importaciones publican esas identidades dentro de la misma transacción que el snapshot. Renombrar conserva la versión; una imagen corregida empieza sin aprobación. `qaVisualThreads`, `qaVisualComments` y `qaVisualDecisions` guardan anotaciones, respuestas, resolución y decisiones con autor. El backend controla permisos y conflictos entre decisiones; aprobar sin una validación vigente exige motivo y nota.

Después de publicar estas funciones y el esquema, usar **Actualizar desde Drive** en las campañas existentes. Se necesita una nueva importación para generar identidades y requisitos estructurados; la interfaz lo indica y no permite analizar la interpretación antigua. No hace falta borrar datos antes: los campos antiguos se admiten para la transición y los resultados con la política anterior quedan fuera de la revisión vigente. La cola de workflows y las tablas de importación actuales se conservan en esta etapa; los pools separados, la importación por lotes y la migración final corresponden a las siguientes etapas de la arquitectura.

Verificación local: `npm run test:qa-visual` y `npx tsc --noEmit`. Las pruebas incluyen vinculación, precios, cobertura, importación XLSX/CSV y colaboración en `convex-test`; no requieren acceso a Drive ni llamadas a los modelos.

El detalle carga hasta 200 hilos, 200 entradas por hilo, 200 versiones y las 100 últimas decisiones y revisiones. Si hay más, lo indica en pantalla; los registros se conservan. La paginación del historial y la separación de consultas del §11 quedan para la siguiente etapa de UI.
