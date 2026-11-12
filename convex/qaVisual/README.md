# QA Visual

Configurá `QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON` en el despliegue de Convex. Compartí cada carpeta de campaña con la cuenta de servicio como lectora. En **QA Visual → Agregar campaña**, pegá el enlace y elegí **Verificar carpeta**. La verificación es de solo lectura: muestra las fuentes, permite elegir entre matrices o CSV candidatos y señala las carpetas faltantes. **Agregar campaña** se habilita cuando la verificación es válida; al confirmar se vuelve a comprobar la carpeta y se fijan las fuentes elegidas. Cada campaña queda registrada en `qaVisualCampaigns`. Convex lee la matriz XLSX de `RECURSOS`, el CSV de producción de `EDITABLES` y las imágenes PNG o JPEG de `DESPLIEGUE`.

La pantalla **Campañas** separa activas y archivadas y carga las tarjetas por páginas. Cada tarjeta muestra las etapas reales de importación y el resumen de las versiones actuales: piezas, validaciones vigentes, hallazgos y aprobaciones internas correspondientes al pedido actual. Si la actualización falla, conserva el acceso a la última revisión publicada y ofrece **Reintentar** o **Elegir fuentes**, según el problema.

Al agregar una campaña, Convex importa en segundo plano los originales del Excel y el CSV y guarda el inventario, los campos de producción y los requisitos por pieza. El editor lee la última importación lista. **Actualizar desde Drive** comprueba si las fuentes cambiaron y publica una importación nueva solo cuando termina correctamente.

**Analizar piezas** toma las imágenes en el orden del inventario. La corrida usa los requisitos de la importación que estaba abierta. Convex prepara las imágenes para análisis y ejecuta el workflow existente. **Reintentar fallidas** vuelve a tomar las piezas con error de la última ejecución.

Las reglas parten de las hojas `PRODUCCION`, `LEYENDA` y `REGLAS`. Para agregar referencias aprobadas por pieza, el despliegue también admite un JSON opcional en `QA_VISUAL_RULES_JSON`, limitado a la carpeta que se indique en `QA_VISUAL_GOOGLE_FOLDER_ID` con la estructura `{"rules":[{"id":"cta","criterion":"Criterio de revisión","source":"REGLAS!B12","severity":"warning","expectedByPiece":{"pieza.png":"Texto esperado"}}]}`. Usá el nombre completo del archivo o el nombre sin extensión como clave. Al cambiar las fuentes o reglas, usá **Actualizar desde Drive** para aplicar los cambios.

La acción interna `qaVisual/mediaHttp:probe` verifica la lectura y el procesamiento de una campaña. Ejecutala en Convex Dev con `{"folderUrl":"https://drive.google.com/drive/folders/ID"}` para comprobar la conexión.

## Vinculación, cobertura y revisión guardada

La interpretación del pedido vive en `model/`. Cada control guarda su estado, base (cliente o producción), procedencia y avisos. Se aceptan coincidencias exactas, equivalencias por conectores y coincidencias parciales sin cambiar cantidades; las ambigüedades requieren confirmación. Los vínculos manuales se reprocesan desde los originales en Storage.

El modelo lee precio y vigencia y el código compara esos valores. El dictamen se calcula con la cobertura: fuentes en conflicto, controles sin verificar, referencias solo de producción y revisiones solo técnicas nunca se muestran como validadas. Si falla la localización de un hallazgo, se conserva como comentario general.

La política `qa-visual-4` exige que todos los controles visuales solicitados tengan evidencia del modelo. Los avisos `warning` o `blocking` que afectan a un control solicitado impiden la validación; los informativos no. Una coincidencia parcial se puede confirmar desde su aviso, y la confirmación resuelve ese bloqueo al reprocesar. El resumen muestra el motivo principal y Detalles enumera todos los pendientes. Los resultados de políticas anteriores se muestran como desactualizados, también antes de actualizar la importación, y requieren excepción para una aprobación humana.

`qaVisualPieces` y `qaVisualPieceVersions` identifican la pieza y el contenido de cada entrega. Las importaciones publican esas identidades en una sola transacción, junto con el cambio de la importación visible. Renombrar conserva la versión; una imagen corregida empieza sin aprobación. `qaVisualThreads`, `qaVisualComments` y `qaVisualDecisions` guardan anotaciones, respuestas, resolución y decisiones con autor. El backend controla permisos y conflictos entre decisiones; aprobar sin una validación vigente exige motivo y nota.

## Etapa 2: datos e importación

`qaVisualSourceFiles` conserva los originales y la interpretación en Storage. `qaVisualImports` registra cada intento, su progreso, huella y manifiesto; `qaVisualImportPieces` guarda el pedido por imagen. `qaVisualImportPool` es un componente exclusivo de QA: procesa hasta dos importaciones y reintenta los fallos transitorios hasta tres intentos totales. Las imágenes y los análisis siguen con sus ejecutores anteriores; sus pools nuevos corresponden a las etapas 3 y 4.

Los lotes tienen hasta 50 piezas y 650 KB. Solo crean filas privadas de la importación y piezas/versiones `staged`; no cambian las revisiones visibles. Un plan congelado en Storage y los comprobantes de cada lote permiten reintentar sin duplicar filas. `publish` activa las identidades, actualiza los datos de presentación, retira las piezas ausentes y cambia `currentImportId` en una sola transacción. El límite sigue siendo 1000 imágenes; se controla también el tamaño completo del documento del manifiesto, con un margen por debajo de 1 MiB.

La identidad se resuelve por ID de Drive y después por clave. Si el archivo anterior desapareció, otro con la misma clave es una versión nueva. Si ambos están presentes, son duplicados independientes y llevan un aviso. En **Detalles** se puede elegir la entrega definitiva o unir entregas como versiones, con una nota obligatoria. Las confirmaciones se guardan en `qaVisualLinkOverrides`; al revocar una fusión se recuperan las identidades originales y sus decisiones. No se modifica ningún archivo de Drive.

**Actualizar desde Drive** lista la carpeta y descarga solo las fuentes sin caché vigente. Si la huella coincide con una importación lista, la reutiliza sin crear piezas ni versiones. **Reprocesar**, también al confirmar o revocar vínculos, interpreta Excel y CSV desde Storage y lista únicamente DESPLIEGUE para conocer los archivos presentes. Recursos muestra los archivos ignorados y las filas del CSV sin imagen. La inspección acepta accesos directos a carpetas, distingue formatos de matriz no admitidos y selecciona el CSV `_CONVERTED_vN` más alto únicamente dentro del mismo nombre base.

Los intentos llevan un número de ejecución que invalida a trabajadores anteriores. Ante un fallo se mantiene la importación visible y se marca el intento fallido antes de limpiar sus filas privadas. El cron de QA revisa cada diez minutos los trabajos sin avances durante treinta minutos; no borra importaciones activas por su antigüedad total. La limpieza puede repetirse y no toca datos de otra importación ni originales compartidos.

### Activación posterior

Estos cambios requieren publicar el esquema, las funciones y el componente nuevo de Convex juntos. Este trabajo no ejecuta ese despliegue. Después se puede usar **Actualizar desde Drive** para migrar cada campaña, o ejecutar la mutación interna `qaVisual/imports:reprocessActive` con `{}`. Esta última recorre campañas activas por páginas y encola `parserUpgrade` desde Storage si la versión de interpretación cambió o la campaña todavía usa snapshots antiguos. Omite campañas con una importación en curso; se puede repetir cuando terminen. No vuelve a encolar campañas ya actualizadas.

Los snapshots antiguos siguen siendo legibles durante la transición. Los adaptadores permiten que el editor, la preparación de imágenes y el análisis existentes lean las nuevas importaciones. La eliminación de tablas antiguas y la migración final quedan para la etapa 7.

Verificación local: `npm run test:qa-visual` y `npx tsc --noEmit`. Las pruebas incluyen vinculación, precios, cobertura, importación XLSX/CSV y colaboración en `convex-test`; no requieren acceso a Drive ni llamadas a los modelos. La campaña de 61 piezas de las pruebas es sintética: no sustituye una prueba posterior con Semana de Locura en el entorno desplegado. Se prueban también 1000 piezas, lotes repetidos, fallo entre lotes, trabajadores vencidos, reemplazos, confirmaciones/revocaciones de duplicados, reprocesamiento desde Storage y registro en el componente Workpool real.

El detalle carga hasta 200 hilos, 200 entradas por hilo, 200 versiones y las 100 últimas decisiones y revisiones. Si hay más, lo indica en pantalla; los registros se conservan. La paginación del historial y la separación de consultas del §11 quedan para la siguiente etapa de UI.


## Etapas 3 a 11 (segunda tanda)

- Imágenes: `qaVisualImagePool` prepara una imagen por trabajo (miniatura, vista previa de 640 px e imagen de análisis) sin espera activa. Los errores definitivos quedan visibles en la pieza.
- Análisis: `qaVisualAnalysisPool` con concurrencia global `QA_VISUAL_ANALYSIS_CONCURRENCY` (por defecto 24, ajustable con mediciones) y 4 piezas por corrida. La máquina de estados está en `runner.ts`, la política de reintentos en `model/retryPolicy.ts` y los modelos exclusivos de QA en `qaModels.ts` (`QA_VISUAL_GEMINI_MODEL`, `QA_VISUAL_OPENAI_MODEL`).
- Revisión del cliente: `clientReview.ts` (configuración y rondas), `clientPortal.ts` (portal con validadores de retorno), `audio.ts` y `voice.ts` (voz y transcripción). El portal está en `/workspace/reviews`.
- Para publicar hace falta desplegar juntos el esquema, las funciones y los componentes `qaVisualImagePool` y `qaVisualAnalysisPool`, registrados en `convex/convex.config.ts`.
