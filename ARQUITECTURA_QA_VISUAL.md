# QA Visual: arquitectura objetivo y plan de implementación

Fecha: 12 de noviembre de 2026
Actualización de criterios de análisis: 13 de noviembre de 2026, política `qa-visual-5` (§9.2.1 y §24.5).
Base analizada: rama `feat/qa-visual`, commit `094b2da`, y `ESPECIFICACION_QA_VISUAL.md`.
Diseño propuesto: [`DISENO_QA_VISUAL.html`](./DISENO_QA_VISUAL.html), con temas claro y oscuro.

Este documento no modifica código. Explica qué conservar, qué está mal y por qué, cómo debería quedar la arquitectura y en qué orden implementarla. Cada decisión responde a dos criterios: que **la pieza se analice siempre que exista información suficiente** y que **cada resultado pueda rastrearse hasta su fuente**.

---

## 0 Resumen ejecutivo

Las diez decisiones que más cambian el sistema:

1. **Analizar siempre que haya algo verificable.** Un problema de vinculación ya no deja la pieza fuera. Los controles afectados se marcan con la causa y los demás se analizan igual. El caso `FESTIN LOCURA` / `FESTIN DE LOCURA` se resuelve con equivalencias controladas por niveles, con un aviso único y auditable.
2. **El estado de cada requisito se vuelve explícito** (`listo`, `no solicitado`, `en conflicto`, `sin resolver`, `inválido`), con procedencia exacta: archivo, hoja, celda, numeral y línea del CSV. Desaparecen `matrixLinked` y el fallback que copiaba la celda K completa en tres campos.
3. **Los avisos de fuente pasan a ser datos estructurados** (código, alcance y controles afectados). Se agrupan por causa y no por texto, y nunca se presentan como hallazgos visuales.
4. **Identidad estable de pieza y versión creativa.** `qaVisualPieces` y `qaVisualPieceVersions` reemplazan la identidad por nombre de archivo. Las aprobaciones humanas se asocian a la versión.
5. **El hash de entrada se calcula por pieza.** Hoy agregar una imagen a la campaña invalida los análisis de todas las demás. El nuevo `inputHash` depende solo de la imagen, de los requisitos de esa pieza y de la versión de política.
6. **Una sola cola de trabajo con `@convex-dev/workpool`** y una máquina de estados guardada en `qaVisualReviews`. Así se eliminan la cola propia con `activeBatch`, los workflows por pieza, la espera activa con `setTimeout`, el vencimiento a diez minutos y el código de compatibilidad. El límite es de cuatro piezas por corrida y además hay un límite global configurable para todas las campañas, dimensionado según cuotas y capacidad medidas (§10.1).
7. **El modelo observa y evalúa; el código verifica los formatos que reconoce.** Formato y dimensiones se comparan con código. Para precio y fecha se usan comparaciones deterministas cuando preservan toda la información requerida; si la sintaxis no está soportada se conserva la evaluación semántica del modelo. Una omisión legible o una ausencia confirmada de contenido requerido es un hallazgo. Un parser limitado nunca es motivo suficiente para una revisión incompleta. Si falla la localización, la conclusión se conserva y el comentario pasa a ser general.
8. **El dictamen y la cobertura se muestran por separado.** "Validada por IA" exige las ocho condiciones de §9.5: resultado vigente, todos los controles solicitados ejecutados y cumplidos contra el pedido del cliente, sin conflictos ni avisos de advertencia, y los controles visuales pasados por el modelo. Una revisión solo técnica, con conflictos o desactualizada nunca aparece en verde.
9. **La colaboración humana se guarda en Convex:** hilos, respuestas, anotaciones, resolución y decisiones por versión, con autor, fecha, control de concurrencia e historial derivado.
10. **Consultas reactivas pequeñas.** Hay una proyección liviana para la lista de tarjetas y una consulta de detalle para la pieza seleccionada. Las imágenes inmutables se cachean en el navegador.
11. **Revisión del cliente como tercera aprobación, la definitoria** (§23). Las versiones aprobadas internamente se envían al cliente en rondas. El cliente revisa en un portal que reutiliza los mismos componentes (galería, carrusel, comentarios con voz), sin ver nada interno, y aprueba pieza por pieza o pide una versión nueva.

---

## 1 Principios

| Principio | Consecuencia concreta |
| --- | --- |
| Separar capas de verdad | Fuente original (Storage) → dato interpretado (importación inmutable) → vínculo confirmado (equivalencias humanas) → resultado de IA (revisión) → decisión humana. Ninguna capa sobrescribe a otra. |
| Analizar con lo que haya | Cada requisito se evalúa por separado. Una ambigüedad bloquea solo los controles que afecta. |
| Diferenciar omisión e incertidumbre | Si se puede comprobar que falta algo pedido, es `fail`. `unverifiable` exige información o evidencia realmente insuficiente; no se usa por una sintaxis no reconocida por el código. |
| Trazabilidad total | Todo valor esperado lleva sus `sources[]`. Todo hallazgo informa qué método lo produjo (código o modelo) y en qué corrida. |
| Idempotencia en cada paso | Las importaciones, corridas, intentos, imágenes y decisiones toleran reintentos y callbacks repetidos sin duplicar resultados. |
| Simplicidad | Hay un solo mecanismo de cola (workpool), una sola fuente de identidad (pieza y versión) y lógica de dominio en TypeScript puro y testeable. No se usan workflows anidados ni leases manuales. |
| Drive en solo lectura | Alcance `drive.readonly`. Solo se usan `GET` de metadatos, listados y descargas. Una prueba automatizada lo verifica. |

---

## 2 Diagnóstico del código actual

Severidad: **Crítico** (produce resultados incorrectos o pérdida de datos), **Alto** (rompe un requisito o no escala), **Medio** (deuda que complica mantener o diagnosticar) y **Bajo**.

### 2.1 Vinculación e interpretación

| ID | Sev. | Dónde | Problema | Consecuencia | Corrección |
| --- | --- | --- | --- | --- | --- |
| A1 | Crítico | `convex/qaVisual/clientMatrix.node.ts:205` | El producto del CSV se busca como subcadena literal dentro de la oferta normalizada (`includes(" PRODUCTO ")`). | `FESTIN DE LOCURA` no coincide con `FESTIN LOCURA`, así que la pieza 16 no tiene oferta. | Coincidencia por niveles con normalización controlada (§8.3). |
| A2 | Crítico | `clientMatrix.node.ts:265-273` | Si no hay oferta única, se copia toda la celda K como valor esperado de `product`, `price` y `date`, y los tres se marcan como pendientes. | Detalles repite trece ofertas, el precio cita K6 en lugar de L6 y aparecen tres comentarios con el mismo texto. | Requisitos con estado `unresolved`, sin valor inventado, con un solo aviso estructurado que lista los controles afectados. |
| A3 | Crítico | `convex/qaVisual/worker.ts:96-109` | Sin controles visuales, el worker devuelve `success` con código `skipped_no_visual_rules` y duración cero. | La pieza parece revisada aunque no pasó por el modelo y el progreso la cuenta como terminada. | La cobertura (§9.5) indica "solo controles técnicos". Además, con la nueva vinculación casi siempre habrá controles visuales para enviar. |
| A4 | Alto | `analysisInput.node.ts` (`matrixLinked`), `worker.ts:55` | `matrixLinked` significa "se extrajo algún requisito" y el worker lo usa para decidir entre `notApplicable` y `unverifiable`. | Un CTA no detectado por el parser se informa como "no solicitado", aunque el pedido sí lo exija. | Estado explícito por requisito, con la diferencia entre `notRequested` y `unresolved`. |
| A5 | Alto | `app/lib/qa-visual/production-csv.ts:42,51` | El CSV no quita el BOM, no detecta `;` como separador, sobrescribe IDs duplicados con `Object.fromEntries` y no conserva el número de línea. | Un CSV exportado desde Excel en español falla con "Falta la columna ID_PIEZA", y un duplicado se pierde sin aviso. | Parser con detección de BOM, codificación y separador, validación de columnas obligatorias, filas con número de línea y aviso `csv_duplicate_id`. |
| A6 | Alto | `clientMatrix.node.ts:61` | Se lee `<v>` en crudo. Las fechas quedan como número serial (`45952`), las celdas combinadas no se propagan y una fórmula sin valor en caché queda vacía. | Si la columna A o B está combinada, la fila no coincide. Una vigencia escrita como fecha de Excel no se reconoce. | Lector de libro con estilos de fecha, `mergeCells` y aviso `formula_without_value` (§7.4). |
| A7 | Medio | `clientMatrix.node.ts:170` y similares | Depende de posiciones fijas como `LEYENDA!C11`, `B9`, `B12`, `C15` y de textos como `Post Estático:`. | Otra plantilla falla sin avisar o produce requisitos incompletos. | Contrato de plantilla versionado que, si no reconoce el libro, lo informa (§7.4). |
| A8 | Medio | `clientMatrix.node.ts:193-200` | Canal y fecha se extraen del nombre del archivo con listas fijas de canales y meses. | Se rompe ante otro canal, otro idioma o abreviaturas. | Tomar canal y temporalidad de CSV y Excel, y usar el nombre del archivo solo para corroborar. Si difieren, se emite un aviso. |
| A9 | Medio | `app/lib/qa-visual/analysis-feed.ts:8` | Los avisos son cadenas de texto. El frontend los agrupa comparando una frase exacta. | Cualquier cambio de redacción vuelve a duplicar avisos. | Avisos con `code` y `affects[]`, agrupados en backend (§8.6). |
| A10 | Medio | `driveClient.ts:130`, `driveSource.node.ts:89`, `campaignSync.ts:51` | Las subcarpetas se buscan por nombre exacto. Un nombre de imagen duplicado aborta toda la importación, y cualquier aviso de inventario también. | `Recursos` o `RECURSOS ` no se reconocen. Una sola imagen duplicada bloquea 60 piezas válidas. | Comparación sin distinguir mayúsculas, tildes ni espacios. Los problemas de una pieza se marcan en esa pieza y la importación continúa (§7.6). |
| A11 | Medio | `driveClient.ts:10` | El límite del Excel es de 500 KB y no se controla el tamaño descomprimido del ZIP. | Rechaza matrices con logos o imágenes incrustadas y no protege contra un ZIP malicioso que se expande sin control. | Límite de 15 MB comprimido y 60 MB descomprimido, comprobado antes de leer las entradas del ZIP. |

### 2.2 Identidad, versiones y modelo de datos

| ID | Sev. | Dónde | Problema | Consecuencia | Corrección |
| --- | --- | --- | --- | --- | --- |
| B1 | Crítico | `analysisInput.node.ts:107-108` | `ruleVersion` incluye la producción de **toda** la campaña y los nombres de **todas** las piezas, y entra en el `contextKey` de cada pieza. | Agregar una imagen o corregir una fila del CSV deja desactualizados los análisis de las 61 piezas, y la reutilización deja de funcionar. | `inputHash` por pieza, calculado con la imagen, los requisitos de esa pieza y la versión de política (§6). |
| B2 | Alto | `analysisInput.node.ts:146-155`, índices `by_piece` | `contextKey` incluye `name` y `updatedAt` (que es `modifiedTime`). Los resultados se buscan por `input.name`. | Renombrar un archivo o cambiar sus metadatos invalida el análisis y pierde el historial. | Identidad por `pieceId` y `pieceVersionId`, y versión por contenido (`md5Checksum`). |
| B3 | Alto | `tables.ts` | Algunas tablas usan `campaign` como string (`reviewKey`) y otras `campaignId` como ID. | Se mezclan referencias, hacen falta joins por hash y la integridad es débil. | Usar `campaignId: v.id("qaVisualCampaigns")` en todas las tablas. Eliminar `reviewKey`. |
| B4 | Alto | `documents.ts:48` | Cada celda del Excel es un documento y todas se insertan en una sola mutación. La tabla se llama `qaVisualClientRequirements`, pero guarda celdas. | Una matriz grande supera los límites de escritura por transacción. El nombre confunde celdas con requisitos. | Guardar el libro interpretado como JSON en Storage. La procedencia que necesita la UI se copia en cada requisito. |
| B5 | Medio | `campaignSnapshots.ts:89` | `publish` recibe todas las piezas como argumento y las inserta en una sola mutación. | Con cientos de piezas se acerca a los límites de tamaño de argumentos y de escrituras. | Escritura por lotes en una importación en estado `building` y luego un cambio de puntero atómico (§7.2). |
| B6 | Medio | `tables.ts` (`qaVisualReviews.input`) | Cada revisión copia el `input` completo. | Hay datos duplicados y documentos grandes. | Referenciar `importPieceId`, que es inmutable. |
| B7 | Medio | Varias | Hay código heredado: `qaVisualAssetVersions`, `qaVisualRuleSets` (redundante con `snapshot.rules`), `activeBatch`, `rollingQueue`, `finishRun`, `hasStorage`, los campos opcionales `piece` y `requirement`, y `clearFullCampaignTest` con el número 61 fijo (`documents.ts:105`). | Aumenta la superficie que hay que mantener y crea caminos que no se prueban. | Eliminarlo en la migración (§17). |
| B8 | Medio | `app/lib/qa-visual/piece-inventory.ts:61` | `versions: 1` está fijo. | No existe la versión creativa. Una nueva entrega heredaría comentarios y decisiones. | `qaVisualPieceVersions` (§5, §6). |

### 2.3 Orquestación

| ID | Sev. | Dónde | Problema | Consecuencia | Corrección |
| --- | --- | --- | --- | --- | --- |
| C1 | Alto | `runDispatch.ts`, `pipeline.ts`, `convex/workflows/index.ts:23` | La cola propia usa un arreglo `activeBatch` en la corrida, lanza un workflow por pieza y comparte el `WorkflowManager` de toda la app (`maxParallelism: 10`). | QA compite con otras funcionalidades y otras funcionalidades compiten con QA. No hay límite global de QA. Conviven dos modelos de cola. | Workpools propios de QA (§10.1). |
| C2 | Alto | `imagePreparation.node.ts:22` | Mientras otra acción tiene la reserva, se espera activamente con `setTimeout(800)`. | Se paga tiempo de acción sin hacer trabajo y el código es frágil. | Un trabajo por versión de imagen, encolado una sola vez y con estado en la base de datos (§13). |
| C3 | Medio | `worker.ts:179`, `commentLocations.ts:61,72` | Si la localización falla o devuelve `uncertain`, se descarta toda la respuesta y se reintenta la pieza. | Se pierden conclusiones válidas, sube el costo y la pieza puede terminar en error. | La localización deja de bloquear: el comentario queda como `unlocated` y se muestra como general (§9.4). |
| C4 | Medio | `runs.ts` (`expirePreparation`) | Un vencimiento programado a diez minutos hace de parche de recuperación. | Puede marcar como fallida una pieza lenta pero sana. | Workpool garantiza el `onComplete`. Se agrega un cron de vigilancia como red de seguridad. |
| C5 | Medio | `runs.ts:59` | Si hay una corrida activa, `start` devuelve esa corrida sin avisar. | Pedir el análisis de una sola pieza no hace nada y la UI no lo explica. | La pieza se agrega al frente de la cola activa (§10.4). |
| C6 | Medio | `campaignSync.ts` | La importación no reintenta los errores transitorios de Drive y su mensaje es genérico. | Un error 503 momentáneo obliga a reintentar a mano. | Reintento con espera exponencial en el pool de importación y códigos de error claros. |
| C7 | Bajo | — | No hay forma de detener una corrida. | No se puede frenar un análisis costoso que se lanzó por error. | `runs.cancel` (§10.5). |
| C8 | Medio | `runs.start` | **Analizar piezas** reanaliza todo siempre. | Gasto innecesario y espera más larga. | Por defecto se analizan las pendientes, las desactualizadas y las fallidas. "Reanalizar todas" queda como acción explícita (§19). |

### 2.4 Consultas y rendimiento

| ID | Sev. | Dónde | Problema | Corrección |
| --- | --- | --- | --- | --- |
| D1 | Alto | `runs.ts:319,354` | `dashboard` recibe hasta 1000 entradas desde el cliente y hace hasta tres consultas por pieza. Se vuelve a ejecutar cada vez que cambia **cualquier** revisión. | Proyección de tarjeta en `qaVisualPieces` y consulta de detalle solo para la pieza seleccionada (§11). |
| D2 | Medio | `campaignSnapshots.ts:144` | `viewer` devuelve los requisitos de todas las piezas y busca su imagen una por una. Se invalida cada vez que una imagen queda lista. | Los requisitos se cargan solo en el detalle. El estado de imagen va en la tarjeta. |
| D3 | Medio | `mediaHttp.ts:7`, `media/route.ts:18,24` | Las imágenes se sirven con `Cache-Control: private, no-store` aunque son inmutables por versión. | `private, max-age=31536000, immutable` y `ETag` por hash (§13.3). |
| D4 | Bajo | `CampaignSnapshotViewer.tsx:19` | Abrir el editor dispara una mutación de preparación de imágenes. | La preparación la encola la publicación de la importación. Abrir el editor solo lee. |

### 2.5 Dictamen y presentación

| ID | Sev. | Dónde | Problema | Corrección |
| --- | --- | --- | --- | --- |
| E1 | Alto | `runs.ts:269` | `findings` oculta la cobertura. Una pieza con cero controles visuales puede quedar como `validated`. | Dictamen y cobertura separados (§9.5). |
| E2 | Alto | `QaViewer.tsx` | El 100 % de progreso no distingue aprobadas, con hallazgos, parciales y con error. | Barra segmentada con el desglose (§19). |
| E3 | Medio | `analysis-feed.ts:64` | Los marcadores se numeran con el índice de `findings`, que incluye los `pass`. | Numeración estable por hilo visible. |
| E4 | Medio | `analysis-feed.ts` | La UI solo diferencia `warning`. Un hallazgo `blocking` se ve igual que uno menor. | La severidad viaja como dato y la UI la distingue. |

### 2.6 Colaboración humana

| ID | Sev. | Dónde | Problema | Corrección |
| --- | --- | --- | --- | --- |
| F1 | Crítico (producto) | `use-review-session.ts:25`, `use-review-decisions.ts`, `use-canvas-annotations.ts` | Comentarios, respuestas, resoluciones, decisiones y anotaciones viven en `useState`. | Tablas `qaVisualThreads`, `qaVisualComments` y `qaVisualDecisions` (§12). |
| F2 | Alto | `PieceHistory` | El historial se arma con la actividad de la sesión. | Historial derivado de datos guardados (§12.6). |
| F3 | Medio | `ReviewDialogs` (Compartir) | Compartir copia la URL, pero esa URL no abre la pieza ni el comentario. | Enlace profundo `?pieza=…&v=…&hilo=…` (§19). |

### 2.7 Estructura del frontend

| ID | Sev. | Dónde | Problema | Corrección |
| --- | --- | --- | --- | --- |
| G1 | Medio | `use-review-session.ts` | Son 324 líneas que devuelven unos 75 campos, y todo se pasa como `session` a cada componente. | Hooks por responsabilidad. Cada componente se suscribe a lo que necesita (§11.4). |
| G2 | Medio | `driveSource.node.ts`, `clientMatrix.node.ts` | El backend importa de `app/lib`, lo que invierte la dependencia. | La lógica de dominio vive en `convex/qaVisual/model/`. El frontend usa tipos derivados de las funciones (`FunctionReturnType`). |
| G3 | Medio | `piece-inventory.ts` | El cliente vuelve a calcular dimensiones, formato y etiquetas con expresiones regulares sobre el nombre del archivo. | El backend entrega los datos de presentación ya resueltos. |
| G4 | Medio | `CampaignCard.tsx`, `campaigns.list` | La tarjeta de campaña solo muestra el nombre, sin estado de importación ni de análisis. | `campaigns.list` devuelve estado y resumen (§19.1). |

### 2.8 Seguridad y operación

| ID | Sev. | Dónde | Problema | Corrección |
| --- | --- | --- | --- | --- |
| H1 | Alto | `app/lib/qa-visual/server/access.ts`, `media/route.ts:4` | El acceso se habilita con `NODE_ENV === "development"`. | Usar una bandera explícita `QA_VISUAL_ENABLED` en Next y en Convex, sin quitar los controles de rol (§14). |
| H2 | Medio | `convex/lib/llmFallback.ts` | QA usa la configuración de modelos compartida. | Configuración propia en `model/llm.ts` que reutiliza solo las fábricas de proveedor. |
| H3 | Medio | `worker.ts` | No se guardan el prompt ni la respuesta cruda. | Versión de política más JSON de la respuesta en Storage por intento (§9.6). |
| H4 | Bajo | `campaignRegistration.ts` | La UI no muestra el correo de la cuenta de servicio. | Mostrarlo, con botón de copiar, en el diálogo de alta (§19.2). |

### 2.9 Qué se conserva

- Lectura de Drive con cuenta de servicio y `drive.readonly`, paginación, `supportsAllDrives` y verificación de MD5 y tamaño (`driveClient.ts`).
- Asociación de precios por **numeral explícito**, entradas vacías conservadas, detección de numerales duplicados y normalización de importes (`numbered`, `priceAmount`). Se trasladan tal cual a `model/offers.ts`, con sus pruebas.
- Aviso `stories-offer-filled`, con el comportamiento que pidió la usuaria.
- Preparación con Sharp: miniatura WebP de 192 px, imagen de análisis JPEG de 1800 px con un segundo intento más chico, corrección de orientación y metadatos del original.
- Conversión de `box_2d` de 0 a 1000 a una región normalizada y su validación geométrica (`commentLocations.ts`).
- Fingerprint para reutilizar importaciones y deduplicación de originales por versión de Drive.
- Idempotencia de `runs.start` por `requestId`.
- Diseño aprobado, `review.css`, navegación con flechas, popover de comentario sobre la imagen y realce al hacer clic en un marcador.

---

## 3 Visión general

```text
                   ┌────────────── Google Drive (solo lectura) ──────────────┐
                   │ RECURSOS/*.xlsx    EDITABLES/*.csv    DESPLIEGUE/*.png  │
                   └───────────────┬────────────────────────────┬────────────┘
                                   │ importPool (máx. 2)        │ imagePool (máx. 4)
                                   ▼                            ▼
 qaVisualSourceFiles ──► importJob: parsear → vincular → requisitos   imageJob: miniatura + análisis
 (originales + JSON        │                                     │
  interpretado)            ▼                                     ▼
                   qaVisualImports ──► qaVisualImportPieces      qaVisualPieceVersions.image
                   (building → ready)  (inmutable por pieza)     (pending → ready | failed)
                           │                │
                           │ publicar       │ identidad estable
                           ▼                ▼
                   qaVisualCampaigns.currentImportId   qaVisualPieces (+ proyección de tarjeta)
                                                            │
                     runs.start ──► qaVisualRuns ──► qaVisualReviews (máquina de estados)
                                                     │  analysisPool (global configurable, por corrida máx. 4; §10.1)
                                                     ▼
                                    analyzeJob: controles deterministas + modelo + localización
                                                     │
                                                     ▼
                     qaVisualThreads / qaVisualComments / qaVisualDecisions (personas)
                                                     │
                                                     ▼
                         Consultas reactivas: campaña · tarjetas · detalle de pieza
```

### 3.1 Organización de carpetas

Se respetan las condiciones de la usuaria: nada de carpeta `features`, componentes en `app/components/qa-visual`, hooks en `app/hooks/qa-visual` y utilidades en `app/lib/qa-visual`. En el backend, toda la lógica que no depende de `ctx` va en `convex/qaVisual/model/`, siguiendo la recomendación de Convex de mantener las funciones registradas delgadas y la lógica en TypeScript puro.

```text
convex/qaVisual/
  schema.ts               Tablas (reemplaza tables.ts)
  validators.ts           Validadores compartidos
  access.ts               requireQaUser(ctx), requireCampaign(ctx, campaignId)
  pools.ts                Instancias de Workpool de QA
  campaigns.ts            list, get, inspectFolder*, register*, chooseSource, archive, restore, rename
  imports.ts              request, writeChunk, publish, fail, onComplete
  importJob.ts            "use node": Drive → originales → parseo → vinculación → escritura por lotes
  images.ts               enqueue, save, onComplete, estado por versión
  imageJob.ts             "use node": descarga + Sharp + Storage
  runs.ts                 start, cancel, retryFailed, fillSlots, onAttemptComplete
  analyzeJob.ts           "use node": un intento de análisis de una pieza
  threads.ts              create, reply, resolve, reopen, edit, remove
  decisions.ts            decide, revoke
  overrides.ts            equivalencias y vínculos manuales confirmados
  editor.ts               Consultas de la UI: campaign, pieces, piece, history
  media.ts                httpAction de imágenes
  model/                  TypeScript puro, sin ctx, con pruebas unitarias
    drive.ts              Cliente de Drive solo lectura (fetch + firma JWT)
    workbook.ts           XLSX → celdas (fechas, celdas combinadas, fórmulas, límites)
    productionCsv.ts      CSV → filas con número de línea (BOM, separador, duplicados)
    template.ts           Contrato de plantilla v1: hojas, encabezados, columnas y referencias
    normalize.ts          Normalización y tokens
    offers.ts             Ofertas y precios numerados (lógica actual conservada)
    linking.ts            Archivo → fila CSV → fila Excel → oferta
    requirements.ts       Requisitos por control con estado y procedencia
    issues.ts             Catálogo de avisos de fuente
    controls.ts           Controles deterministas y comparación de valores
    prompt.ts             Contrato con el modelo y ANALYSIS_POLICY_VERSION
    verdict.ts            Dictamen y cobertura
    retryPolicy.ts        Siguiente intento, proveedor y espera
    hashing.ts            fingerprint, requirementsHash, inputHash
    llm.ts                Modelos de QA, aislados de convex/lib/llmFallback.ts
    labels.ts             Textos de avisos generados en el backend

app/workspace/qa-visual/   page.tsx · [campaignId]/page.tsx · layout.tsx · media/route.ts
app/components/qa-visual/
  campaigns/  CampaignsPage · CampaignCard · AddCampaignDialog · CampaignStatus
  campaign/   CampaignEditor · CampaignHeader · AnalyzeMenu · AnalysisProgress · ImportBanner
              FilesPanel · PieceCard · CampaignSummary · CampaignSources
  viewer/     ReviewCanvas · ViewerToolbar · CanvasMarkers · AnnotationLayer · PieceStatusBar
  piece/      PiecePanel · PieceDetails · RequirementCard · SourceChain · PieceVersions
              PieceHistory · DecisionDialog
  comments/   CommentsPanel · ThreadCard · Composer · ImageCommentPopover
  shared/     StatusPill · Avatar · EmptyState · pto99-logo
app/hooks/qa-visual/
  use-campaign-editor.ts · use-piece-selection.ts · use-piece-keyboard-navigation.ts
  use-piece-detail.ts · use-threads.ts · use-decision.ts · use-analysis-run.ts
  use-viewer-transform.ts · use-annotation-tool.ts
app/lib/qa-visual/
  labels.ts (códigos → textos de UI) · status.ts (tonos y presentación) · geometry.ts
  comment-navigation.ts · comment-position.ts (se conservan)
```

`*` Son acciones, porque llaman a Drive.

### 3.2 Componentes de Convex

Se registran en `convex/convex.config.ts` con nombre propio. Así QA no comparte su cola con el resto de la aplicación:

```ts
app.use(workpool, { name: "qaVisualImportPool" });   // maxParallelism: 2
app.use(workpool, { name: "qaVisualImagePool" });    // maxParallelism: 4
app.use(workpool, { name: "qaVisualAnalysisPool" }); // maxParallelism: configurable según capacidad medida (§10.1)
```

`@convex-dev/workpool` ya figura en `package.json`. QA deja de usar `@convex-dev/workflow`, aunque se mantiene para los otros agentes.

---

## 4 Buenas prácticas de Convex aplicadas

| Práctica | Aplicación en QA Visual |
| --- | --- |
| Validadores en `args` y `returns` | Todas las funciones públicas y todas las internas con argumentos. Los enums se definen como uniones de literales en `validators.ts`. |
| Control de acceso al inicio de cada función pública | `requireCampaign(ctx, campaignId)` devuelve el usuario y la campaña, o lanza `ConvexError` con un código. |
| Funciones internas para trabajos | Los trabajos y callbacks de Workpool son `internalAction` o `internalMutation`. El cliente nunca los llama. |
| Solo consultas con índice | Nunca `.filter()` sobre tablas sin límite. Listas acotadas con `.take(n)` y paginación (`paginationOptsValidator`) para historial, campañas y corridas. |
| Arreglos acotados dentro de documentos | `findings` ≤ 20, `attempts` ≤ 6, `issues` por pieza ≤ 30, `ignoredFiles` ≤ 200. Lo que puede crecer va en su propia tabla o en Storage. |
| Documentos chicos | Los originales y el JSON interpretado del libro van en Storage. Las tablas guardan referencias. |
| Acciones solo para E/S externa | Las acciones son las únicas que hablan con Drive, Sharp y los LLM. Escriben mediante mutaciones internas con pocas llamadas y por lotes. |
| Encolar desde mutaciones | Las corridas, importaciones e imágenes se encolan dentro de la misma transacción que crea el estado. Si la transacción falla, no queda trabajo huérfano. |
| Sin espera activa | Ningún `setTimeout` ni bucle de sondeo dentro de las acciones. Las esperas se hacen con `runAfter` de Workpool. |
| Mutaciones idempotentes | Cada mutación verifica el estado esperado (por ejemplo, `status === "running"` y `workId` coincidente) antes de escribir. |
| Consultas deterministas | Ninguna consulta usa `Date.now()`. Los vencimientos los decide una mutación o un cron. |
| Puntos calientes controlados | Los contadores de corrida se actualizan en la misma mutación que cierra cada pieza. Con cuatro escrituras concurrentes, los reintentos automáticos de concurrencia optimista de Convex son suficientes. |
| Consultas reactivas pequeñas | Hay tres consultas: la cabecera de campaña, las tarjetas (proyección liviana) y el detalle de la pieza seleccionada. |
| Limpieza de Storage | Toda subida que no termina asociada se borra en el mismo flujo. Un cron diario elimina huérfanos. |

---

## 5 Modelo de datos

Hay doce tablas. Cada una corresponde a una capa de verdad:

| Capa | Tablas |
| --- | --- |
| Registro | `qaVisualCampaigns` |
| Original | `qaVisualSourceFiles` (Excel y CSV en Storage) |
| Interpretado (inmutable) | `qaVisualImports`, `qaVisualImportPieces` |
| Identidad | `qaVisualPieces`, `qaVisualPieceVersions` |
| Confirmado por personas | `qaVisualLinkOverrides` |
| Revisión de IA | `qaVisualRuns`, `qaVisualReviews` |
| Revisión humana | `qaVisualThreads`, `qaVisualComments`, `qaVisualDecisions` |

### 5.1 `qaVisualCampaigns`

| Campo | Tipo | Nota |
| --- | --- | --- |
| `name` | string | Nombre visible. Puede editarse en la app y nunca cambia nada en Drive. |
| `driveFolderId`, `driveFolderName` | string | Carpeta raíz y nombre que tiene en Drive. |
| `status` | `active` \| `archived` | |
| `createdBy` | `Id<"users">` | |
| `sourceSelection?` | `{ excelFileId?, csvFileId? }` | Elección explícita cuando hay más de un candidato (§7.3). |
| `currentImportId?` | `Id<"qaVisualImports">` | Última importación lista. Es la que lee el editor. |
| `activeImportId?` | `Id<"qaVisualImports">` | Importación en curso. Si está presente, no se lanza otra. |
| `activeRunId?` | `Id<"qaVisualRuns">` | Corrida en curso. |
| `summary` | objeto | `{ pieces, aiValidated, aiFindings, aiPartial, aiFailed, aiPending, aiStale, approved, changesRequested }` para la tarjeta de campaña. |

Índices: `by_drive_folder [driveFolderId]` (único por lógica) y `by_status [status]`.

### 5.2 `qaVisualSourceFiles`

| Campo | Nota |
| --- | --- |
| `campaignId`, `kind: excel \| csv` | |
| `driveFileId`, `driveVersion`, `md5?`, `sha256` | El `sha256` se calcula al descargar. |
| `name`, `mimeType`, `bytes`, `modifiedAt` | |
| `storageId` | Original sin cambios. |
| `parsedId?` | JSON en Storage con las celdas del libro (incluidas las fechas convertidas y las celdas combinadas expandidas) o las filas del CSV con su número de línea. Se usa para reprocesar sin Drive y para auditar. |
| `parserVersion` | Versión con la que se generó `parsedId`. |

Índices: `by_campaign_drive [campaignId, driveFileId, driveVersion]` y `by_campaign_sha [campaignId, kind, sha256]`.

### 5.3 `qaVisualImports` (antes snapshot)

| Campo | Nota |
| --- | --- |
| `campaignId`, `requestedBy?`, `trigger` | `register` \| `manual` \| `reprocess` \| `parserUpgrade`. |
| `status` | `queued` → `running` → `building` → `ready` \| `failed` \| `superseded`. Una importación reutilizada no crea una fila nueva: solo actualiza el puntero y la fecha. |
| `stage?` | `listing` \| `downloading` \| `parsing` \| `linking` \| `writing`. Se usa en el banner de progreso. |
| `fingerprint?`, `parserVersion`, `templateVersion` | |
| `excelFileId?`, `csvFileId?`, `deploymentFolderId?` | |
| `rules` | Catálogo de controles de esta importación (≤ 20). Reemplaza a `qaVisualRuleSets`. |
| `issues` | Avisos de nivel campaña (≤ 50). |
| `counts` | `{ images, linked, linkedWithNotices, blocked, csvRowsWithoutImage, ignoredFiles }`. |
| `manifest` | `[{ pieceId, versionId, importPieceId, order, display }]` (≤ 1000). Lo completa `writeChunk` y lo consume `publish` (§7.2.1). |
| `ignoredFiles` | `[{ name, reason }]` (≤ 200). |
| `error?` | `{ code, message, retryable }`. |
| `workId?`, `startedAt`, `finishedAt?` | |

Índices: `by_campaign [campaignId]` y `by_campaign_fingerprint [campaignId, fingerprint]`.

### 5.4 `qaVisualImportPieces` (inmutable)

| Campo | Nota |
| --- | --- |
| `importId`, `pieceId`, `pieceVersionId`, `order` | |
| `file` | `{ name, path, driveFileId, driveVersion, md5, bytes, modifiedAt, mimeType }`. |
| `production?` | Campos del CSV más `csvLine`. |
| `link` | `{ csv: LinkStep, excelRow: LinkStep & { row? }, offer: LinkStep & { ordinal?, method?, originalText?, candidates[] } }`, con `LinkStep = { status: "linked" \| "missing" \| "ambiguous" \| "manual", note? }`. |
| `requirements` | `Requirement[]` (§8.5). |
| `issues` | `Issue[]` de la pieza (§8.6). |
| `requirementsHash`, `inputHash` | §6. |
| `display` | `{ title, subtitle, format, width, height, channel, phase }` ya calculado para la UI. |

Índices: `by_import_order [importId, order]` y `by_import_piece [importId, pieceId]`.

### 5.5 `qaVisualPieces` (identidad estable más proyección de tarjeta)

| Campo | Nota |
| --- | --- |
| `campaignId`, `baseKey`, `key` | `baseKey` es el nombre del archivo normalizado, sin extensión. `key` es único por campaña: es igual a `baseKey`, salvo en duplicados simultáneos, donde vale `baseKey#<driveFileId abreviado>` (§6.1). |
| `duplicateOf?` | `pieceId` de la pieza con la clave base cuando esta es un duplicado simultáneo. |
| `status` | `staged` (creada por una importación todavía no publicada, invisible) \| `active` \| `removed` (ya no está en DESPLIEGUE; se conserva para el historial) \| `excluded` (una persona la descartó como duplicado). |
| `stagedImportId?` | Importación que la creó mientras está en `staged`. |
| `order` | Orden de la lista. |
| `currentVersionId`, `currentImportPieceId` | Se modifican **solo** en `imports.publish` (§7.2). |
| `display` | `{ title, fileName, format, width, height, issues: { warning, blocking }, inputHash }`. Depende de la importación y lo escribe `publish`, tomándolo del manifiesto. |
| `card` | `{ thumbnailReady, ai: { state, verdict, fails, unverifiable, coverage, inputHash }, human: { decision, by, at }, client: { state, clientVersion, at }, openThreads, openClientThreads }`. Depende de revisiones, hilos y decisiones, y lo escribe `refreshPieceCard`. |

Índices: `by_campaign_order [campaignId, status, order]` y `by_campaign_key [campaignId, key]`.

`card` se recalcula con `refreshPieceCard(ctx, pieceId)`, un helper idempotente que lee las fuentes y vuelve a escribir la proyección. Se llama desde cada mutación que la afecta: cierre de revisión, decisión, cambio de hilo e imagen lista. Como recalcula todo en lugar de aplicar diferencias, no puede quedar desincronizada. La vigencia del análisis no se guarda: la consulta la calcula comparando `card.ai.inputHash` con `display.inputHash`. Así, publicar una importación no obliga a recalcular las tarjetas.

### 5.6 `qaVisualPieceVersions`

| Campo | Nota |
| --- | --- |
| `pieceId`, `campaignId`, `number` | Número interno: v1, v2… El cliente ve su propia numeración (§23.4). |
| `status` | `staged` \| `active`. Una versión `staged` pertenece a una importación no publicada y es invisible. |
| `stagedImportId?` | |
| `driveFileId`, `contentHash`, `driveCreatedAt` | `contentHash` es `md5Checksum` de Drive o el `sha256` calculado. `driveCreatedAt` se usa para desempatar duplicados. |
| `driveVersion`, `fileName` | Último valor visto. Un renombrado lo actualiza sin crear una versión nueva. |
| `bytes`, `width?`, `height?`, `format?`, `hasAlpha?` | Del original decodificado. |
| `image` | `{ status: pending \| processing \| ready \| failed, thumbnailId?, analysisId?, analysisWidth?, analysisHeight?, error?, workId?, attempts }`. Reemplaza a `qaVisualImageCopies` y `qaVisualAssetVersions`. |
| `currentDecisionId?` | Decisión humana vigente. |

Índices: `by_piece [pieceId, number]`, `by_campaign_drive_file [campaignId, driveFileId]`, `by_campaign_content [campaignId, contentHash]`, `by_campaign_image_status [campaignId, image.status]` y `by_staged_import [stagedImportId]`.

### 5.7 `qaVisualLinkOverrides` (confirmaciones humanas)

| Campo | Nota |
| --- | --- |
| `campaignId`, `kind` | `productAlias` \| `offerLink` \| `ignoreIssue` \| `keepDuplicate` \| `mergeAsVersion`. |
| `scope` | `campaign` o `{ pieceKey }`. |
| `data` | `productAlias`: `{ from, to }` normalizados. `offerLink`: `{ excelRow, ordinal }`. `ignoreIssue`: `{ code }`. `keepDuplicate`: `{ baseKey, keepDriveFileId }` (marcar como definitiva). `mergeAsVersion`: `{ baseKey, olderDriveFileId, newerDriveFileId }`. |
| `note`, `createdBy`, `revokedAt?`, `revokedBy?` | Nunca se borra; se revoca. |

Índice: `by_campaign [campaignId, kind]`. Las confirmaciones vigentes entran en el `fingerprint`, de modo que crear o revocar una dispara un reprocesamiento sin Drive (§7.7).

### 5.8 `qaVisualRuns`

| Campo | Nota |
| --- | --- |
| `campaignId`, `importId`, `requestedBy`, `requestId` | |
| `kind` | `batch` \| `piece` \| `retry`. |
| `scope` | `pending` \| `all` \| `selected`. |
| `status` | `running` \| `completed` \| `cancelled`. |
| `counts` | `{ total, queued, running, completed, failed, cancelled, validated, findings, partial }`. |
| `startedAt`, `finishedAt?`, `firstResultAt?` | |

Índices: `by_campaign [campaignId]` y `by_request [requestedBy, requestId]`.

### 5.9 `qaVisualReviews`

| Campo | Nota |
| --- | --- |
| `runId`, `campaignId`, `pieceId`, `pieceVersionId`, `importPieceId` | Referencia al input inmutable, sin copiarlo. |
| `inputHash`, `requirementsHash`, `policyVersion` | Sirven para explicar por qué un resultado quedó desactualizado. |
| `order` | Un valor negativo coloca la pieza al frente de la cola (§10.4). |
| `status` | `queued` \| `running` \| `completed` \| `failed` \| `cancelled`. |
| `phase?` | `image` \| `model` \| `locating` \| `waitingRetry`. |
| `workId?` | ID del trabajo en Workpool. |
| `attempts` | `[{ n, provider, model, code, queuedMs, elapsedMs, inputTokens?, outputTokens?, rawId? }]` (≤ 6). |
| `findings?` | `Finding[]` (≤ 20). |
| `result?` | `{ verdict, coverage }` (§9.5). |
| `error?` | `{ code, message }`. |
| `finishedAt?` | |

Índices: `by_run_status_order [runId, status, order]`, `by_piece [pieceId]` (el orden por `_creationTime` es implícito) y `by_version_input [pieceVersionId, inputHash, status]`.

`Finding`:

```ts
{
  ruleId, outcome: "pass" | "fail" | "unverifiable" | "notApplicable",
  basis: "client" | "production",          // contra qué se comparó
  method: "deterministic" | "model",
  evidenceStatus?: "readable" | "absent" | "unreadable" | "ambiguous",
  missingElements?: string[],                // omisiones confirmadas de contenido requerido
  severity: "info" | "warning" | "blocking",
  expected?: string, expectedAlternatives?: string[],   // conflicto Excel/CSV
  observed: string,                         // explicación
  observedValue?: string,                   // transcripción literal, sin completar desde el pedido
  sources: Source[],
  causeIssueId?: string,                    // si el resultado depende de un aviso de fuente
  region?: { x, y, width, height }, visibleAnchor?: string,
  locationStatus: "located" | "absent" | "unreadable" | "unlocated" | "notApplicable",
}
```

### 5.10 `qaVisualThreads` y `qaVisualComments`

`qaVisualThreads`: `campaignId`, `pieceId`, `pieceVersionId`, `origin` (`{ kind: "human" }` o `{ kind: "finding", reviewId, ruleId }`), `anchor` (`general`, `point {x,y}`, `rect {x,y,w,h}` o `path {points ≤ 500}`), `status: open | resolved`, `resolvedBy?`, `resolvedAt?`, `createdBy?`, `lastActivityAt` y `commentCount`.
Índices: `by_version [pieceVersionId, status]` y `by_finding [reviewId, ruleId]` (único por lógica).

`qaVisualComments`: `threadId`, `pieceVersionId`, `authorId`, `body` (≤ 4000), `editedAt?` y `deletedAt?` (borrado lógico).
Índice: `by_thread [threadId]`.

Los hilos de un hallazgo de IA se crean **solo cuando alguien responde o lo resuelve**, con un upsert sobre `by_finding`. Mientras tanto, el hallazgo se muestra a partir de `qaVisualReviews.findings`.

### 5.11 `qaVisualDecisions` (registro de solo agregado)

`campaignId`, `pieceId`, `pieceVersionId`, `decision: approved | changesRequested | revoked`, `exception?: { reason, note }`, `aiSeen: { reviewId?, verdict?, inputHash?, stale }`, `decidedBy` y `supersedesId?`.
Índice: `by_version [pieceVersionId]`.

### 5.12 Qué desaparece

`qaVisualClientRequirements` (las celdas pasan a Storage), `qaVisualRuleSets` (las reglas pasan a la importación), `qaVisualImageCopies` y `qaVisualAssetVersions` (pasan a la versión), `qaVisualCampaignSnapshots` (pasa a `qaVisualImports`), `qaVisualCampaignPieces` (pasa a `qaVisualImportPieces`), y los campos `reviewKey`, `campaign: string`, `activeBatch`, `rollingQueue`, `sync`, `imageWarmup*`, `matrixLinked` y `expected`.

---

## 6 Identidad y versiones

| Concepto | Identidad | Cambia cuando |
| --- | --- | --- |
| Campaña | `driveFolderId` | Nunca. Si cambia el nombre en Drive, se actualiza `driveFolderName`. |
| Fuente | `(driveFileId, driveVersion)` y `sha256` | Cambia el contenido del Excel o del CSV. |
| Importación | `fingerprint` = hash de `PARSER_VERSION`, `TEMPLATE_VERSION`, `sha256` del Excel y del CSV, `[(driveFileId, contentHash, nombre)]` de las imágenes, `overridesVersion` y `sourceSelection` | Cambia cualquier fuente, el código de interpretación o una confirmación humana. |
| Pieza | `(campaignId, key)`, donde `key` es único por campaña (§6.1) | Nunca. Un nombre nuevo sin coincidencias crea una pieza nueva. |
| Versión creativa | `(pieceId, contentHash)` | Cambia el contenido de la imagen. Un renombrado o un cambio de metadatos no cuenta. |
| Requisitos de la pieza | `requirementsHash` = hash de los requisitos y avisos de **esa** pieza y de las definiciones de reglas que usa | Cambia el pedido aplicable a esa pieza. |
| Entrada de análisis | `inputHash` = hash de `contentHash`, `requirementsHash` y `ANALYSIS_POLICY_VERSION` | Cambia la imagen, su pedido o la política de análisis (prompt y criterios). |

### 6.1 Resolución de identidad al importar

La diferencia entre **versión nueva** y **duplicado** está en el tiempo:

- **Versión nueva:** el archivo anterior de la pieza **ya no está** en DESPLIEGUE y en su lugar aparece otro con la misma `baseKey`. Es un reemplazo.
- **Duplicado:** dos archivos con la misma `baseKey` **están presentes a la vez** en el mismo listado.

`model/identity.ts` resuelve cada archivo presente con una función pura. Recibe el listado actual de Drive y las piezas y versiones activas, y aplica las reglas en este orden:

1. **Por `driveFileId`.** Si el archivo ya pertenece a una versión activa, se queda en esa pieza:
   - Con el mismo `contentHash`, es la misma versión. Si cambió el nombre, se actualiza `fileName`, pero la `key` de la pieza no cambia.
   - Con otro `contentHash`, es una versión nueva de la misma pieza: el archivo se reemplazó en Drive.
2. **Por `baseKey`, solo para los archivos que quedaron sin resolver en el paso 1.** Se busca una pieza activa con esa `key`:
   - Si la pieza existe y **ninguno** de sus archivos sigue presente en el listado, el archivo es una versión nueva de esa pieza. La nueva entrega se subió con el mismo nombre.
   - Si la pieza existe y su archivo **sigue presente**, el archivo es un **duplicado simultáneo**. Pasa al paso 3.
3. **Duplicados simultáneos.** Dentro del grupo con la misma `baseKey`:
   - Conserva la `key` base el archivo que ya pertenecía a la pieza. Si es la primera importación, la conserva el de `driveCreatedAt` más antiguo y, si coinciden, el de menor `driveFileId`. El desempate es determinista.
   - Los demás forman piezas propias con `key = baseKey#<6 primeros caracteres del driveFileId>` y `duplicateOf` apuntando a la pieza base.
   - Todas llevan el aviso `file_duplicate_name` y se analizan contra la misma fila de CSV y Excel.
4. **Resolución humana de duplicados.** Se guarda en `qaVisualLinkOverrides` y entra en el `fingerprint`:
   - "Marcar como definitiva" (`keepDuplicate`): la otra pieza pasa a `excluded` y no se analiza ni se envía al cliente.
   - "Es una versión nueva de…" (`mergeAsVersion`): los dos archivos se convierten en versiones sucesivas de la misma pieza, ordenadas por `driveCreatedAt`.
5. **Reutilización de imágenes.** Si un `driveFileId` nuevo tiene un `contentHash` idéntico al de una versión existente de la campaña, se reutilizan sus imágenes preparadas. Esto no cambia su identidad.
6. **Pieza nueva.** Si ningún caso anterior aplica, se crea una pieza nueva.
7. **Pieza retirada.** Una pieza activa sin ningún archivo presente pasa a `removed`, sin borrarse. Si después reaparece un archivo con su `key`, la regla 2 la reactiva como versión nueva.

Un renombrado conserva la pieza porque la regla 1 tiene prioridad. Si después se sube otro archivo con el nombre viejo mientras el renombrado sigue presente, la regla 2 no aplica, porque la pieza todavía tiene un archivo presente. El archivo nuevo se trata como duplicado y queda marcado para revisión humana. Así, el sistema nunca fusiona dos archivos vivos sin que alguien lo confirme.

Pruebas obligatorias para `model/identity.ts`: renombrado, reemplazo con el mismo ID, reemplazo con otro ID, duplicado en la primera importación, duplicado que aparece después, desempate por fecha, `keepDuplicate`, `mergeAsVersion`, pieza retirada que reaparece y renombrado seguido de un archivo nuevo con el nombre viejo.

### 6.2 Desactualización y herencia de decisiones

**Motivo de desactualización**, comparando el último resultado completo de la pieza con la importación vigente:

- Otro `pieceVersionId`: "Hay una versión nueva de la imagen".
- Otro `requirementsHash`: "El pedido de esta pieza cambió".
- Otra `policyVersion`: "Se actualizaron los criterios de análisis".

Una aprobación humana **no se hereda** entre versiones. Si cambió el pedido de la misma versión, la aprobación sigue vigente, pero se muestra como "Aprobada con un pedido anterior". La persona confirma o revoca.

---

## 7 Importación

### 7.1 Flujo de alta en dos pasos

1. `campaigns.inspectFolder({ url })` es una acción sin escrituras. Valida el enlace y los permisos, lista las subcarpetas y devuelve una vista previa: subcarpetas encontradas, Excel candidatos, CSV candidatos, cantidad de imágenes y archivos ignorados.
2. El diálogo muestra una lista de verificación (ver HTML). Si falta algo obligatorio, el botón queda deshabilitado y se explica qué falta.
3. `campaigns.register({ url, excelFileId?, csvFileId? })` vuelve a validar, inserta la campaña dentro de la mutación (sin duplicados por `by_drive_folder`) y encola la importación en la misma transacción.

### 7.2 Trabajo de importación (`importJob`)

1. `imports.request` (mutación): controla el acceso, rechaza si ya hay `activeImportId`, crea la fila `queued` y la encola en `qaVisualImportPool` con `onComplete` y reintento (3 intentos, espera de 2 s, 4 s y 8 s) para errores transitorios.
2. La acción:
   - Lista la carpeta (`stage: listing`).
   - Resuelve las fuentes (§7.3). Si falta algo obligatorio, devuelve un resultado `failed` con un código, sin lanzar excepción.
   - Descarga solo los originales que no estén ya guardados por `(driveFileId, driveVersion)` (`downloading`).
   - Interpreta el libro y el CSV, o reutiliza `parsedId` si `parserVersion` coincide (`parsing`).
   - Calcula el `fingerprint`. Si ya existe una importación `ready` con ese valor, solo se actualizan el puntero y la fecha, y el trabajo termina.
   - Lee las piezas y versiones activas con `imports.identityContext` y resuelve la identidad de cada archivo (§6.1).
   - Vincula y construye requisitos con funciones puras (`linking`).
   - Escribe con `imports.writeChunk` en lotes de 50 (`writing`), según el contrato de §7.2.1.
   - Llama a `imports.publish`.
3. `imports.publish` (mutación atómica): aplica todos los cambios visibles en una sola transacción (§7.2.1).
4. `imports.onComplete`: si el trabajo falló, marca la importación como `failed` con `{ code, message, retryable }`, borra en lotes las filas `staged` de esa importación y libera `activeImportId`. **El editor sigue mostrando la última importación lista y nunca vio nada de la importación fallida.**

#### 7.2.1 Contrato de escritura: preparar sin mostrar, publicar de una vez

**Regla:** antes de `publish`, ninguna fila que el editor o el portal del cliente puedan leer se crea ni se modifica.

**Qué puede escribir `writeChunk`:**
- Inserta `qaVisualImportPieces` con `importId`. Es invisible, porque las consultas solo leen la importación a la que apunta `currentImportId`.
- Crea **solo filas nuevas** de identidad: piezas nuevas con `status: "staged"` y versiones nuevas con `status: "staged"`, ambas con `stagedImportId`.
- Agrega al manifiesto de la importación las entradas de su lote (`qaVisualImports.manifest`, ≤ 1000 entradas compactas): `{ pieceId, versionId, importPieceId, order, display }`.

**Qué tiene prohibido `writeChunk`:** modificar piezas o versiones `active`. Eso incluye `currentVersionId`, `display`, `status`, `card` y las decisiones.

**Las consultas del editor y del cliente** filtran por `status: "active"` mediante el índice `by_campaign_order`. Las versiones se leen a partir de `currentVersionId` o de la lista `by_piece` filtrada por `active`.

**Qué hace `publish`, todo en una transacción:**
1. Verifica que `campaign.activeImportId === importId` y que el manifiesto esté completo: `manifest.length === counts.images`.
2. Para cada entrada del manifiesto:
   - Pasa la pieza `staged` a `active` o, si ya existía, actualiza `currentVersionId`, `currentImportPieceId`, `order` y `display`.
   - Pasa la versión `staged` a `active`.
3. Pasa a `removed` las piezas activas que no figuran en el manifiesto.
4. Marca la importación como `ready` y la anterior como `superseded`, mueve `currentImportId` y limpia `activeImportId`.
5. Programa `images.enqueuePending({ campaignId })`, que encola en lotes de 100 las versiones con imagen `pending`, para no encolar 1000 trabajos en esta misma transacción.

**Límites:** con el tope de 1000 piezas, `publish` lee alrededor de 3000 documentos (manifiesto, piezas, versiones y piezas activas) y escribe alrededor de 2000, dentro de los límites de una transacción de Convex. Por eso el manifiesto vive dentro del documento de la importación y es compacto (unos 300 bytes por entrada, alrededor de 300 KB en total). No hace falta leer los requisitos de cada pieza. Si alguna vez se sube el tope de 1000 piezas, `publish` tendría que pasar a dos fases, con una bandera `campaign.publishingImportId` que mantenga visible la importación anterior. Ese cambio no está incluido en esta versión.

**Recálculo de tarjetas:** no hace falta. La parte de la tarjeta que depende de la importación (`display`) la escribe `publish`. La que depende de revisiones y decisiones (`card`) no cambia con la importación. La vigencia se calcula en la consulta comparando hashes (§5.5).

**Concurrencia:** solo puede haber una importación activa por campaña, así que nadie más crea identidades mientras se prepara una. Las decisiones y los comentarios humanos no modifican la identidad. Si durante la preparación se crea o se revoca una confirmación humana, eso cambia el `fingerprint`: `publish` igual publica y se encola automáticamente un reprocesamiento.

**Limpieza:** `onComplete` con error borra las filas `staged` de la importación usando `by_staged_import`. Un cron horario borra las filas `staged` cuya importación esté `failed` o lleve más de una hora sin terminar.

### 7.3 Selección de fuentes

| Situación | Comportamiento |
| --- | --- |
| Un `.xlsx` en RECURSOS, sin contar los que empiezan con `~$` | Se usa. |
| Varios `.xlsx` | La importación queda como `needsSource`. La tarjeta y el editor muestran "Elegí la matriz", y la elección se guarda en `sourceSelection`. Si después el archivo elegido desaparece, se vuelve a preguntar. |
| Ningún `.xlsx`, pero hay `.xls` o una hoja de cálculo de Google | Se informa "Formato no admitido: convertí a .xlsx" (§22: evaluar la exportación de lectura desde Google Sheets). |
| CSV: un `_CONVERTED` o `_CONVERTED_vN` | Se usa. Si hay varios, se elige automáticamente la `vN` más alta **solo si** el resto del nombre coincide. Cualquier otro caso se trata como ambigüedad. |
| Varios CSV candidatos | Elección explícita, como con el Excel. |
| Ningún CSV | Error de campaña `csv_missing`. |

### 7.4 Contrato de plantilla (`model/template.ts`)

Se declara como datos y no como código disperso:

```ts
export const templateV1 = {
  id: "matriz-kfc-v1",
  sheets: { production: ["PRODUCCION"], legend: ["LEYENDA"], rules: ["REGLAS"] },
  header: { sheet: "production", column: "A", text: "CAMPAÑA" },
  columns: { campaign: "A", phase: "B", channel: "C", platform: "D", pieceType: "E",
             fileFormat: "G", width: "I", height: "J", offers: "K", prices: "L", notes: "P" },
  legendRefs: { dimensions: "C11", format: "B9", stories: "B12", cta: "C15" },
  rulesRefs: { storiesWithoutOffer: "B6:D6" },
};
```

- **Detección:** la plantilla se reconoce si encuentra las hojas por nombre normalizado y el encabezado `CAMPAÑA`. Si no la reconoce, la importación falla con `template_unrecognized`, indicando qué faltó. No intenta adivinar.
- **Hojas opcionales:** si falta LEYENDA o REGLAS, la importación continúa con un aviso de campaña. PRODUCCION es obligatoria.
- **Celdas combinadas:** el valor de la celda superior izquierda se propaga a todo el rango para las búsquedas.
- **Fechas:** si el estilo de la celda (`numFmtId` 14–22 o un formato personalizado con `d`, `m` o `y`) indica fecha, el número serial se convierte a fecha y se guarda en texto (`22 de octubre`).
- **Fórmulas:** se usa el valor en caché. Si una fórmula no tiene resultado, se emite `formula_without_value` sobre esa celda.
- **Números:** los importes se redondean a dos decimales, porque `8.9900000001` equivale a `8,99`.
- **Seguridad:** se rechazan las entradas del ZIP fuera de `xl/`, los XML con `DOCTYPE` (como ahora) y los libros cuyo tamaño descomprimido supere el límite.

### 7.5 CSV (`model/productionCsv.ts`)

- Quita el BOM UTF-8. Si el texto no es UTF-8 válido, decodifica como Windows-1252 y lo avisa.
- Detecta el separador (`,` o `;`) por la línea de encabezado.
- Exige `ID_PIEZA`. Si faltan otras columnas esperadas, emite un aviso por columna, sin abortar.
- Conserva `csvLine` en cada fila.
- **ID duplicado:** si las filas son idénticas, emite el aviso `csv_duplicate_id` informativo. Si difieren, los campos distintos quedan como conflicto y se muestran las dos filas.
- **Filas sin imagen:** se cuentan en `csvRowsWithoutImage` y se listan en Recursos, en "Entregables sin imagen".

### 7.6 Qué pasa si la carpeta no contiene lo esperado

| Caso | Dónde se detecta | Resultado | Lo que ve la persona |
| --- | --- | --- | --- |
| URL que no es de una carpeta de Drive | `inspectFolder` | No se registra. | "Pegá el enlace de una carpeta de Google Drive." |
| La URL apunta a un archivo | `inspectFolder` | No se registra. | "El enlace es de un archivo; pegá el de la carpeta de la campaña." |
| Carpeta sin compartir (403 o 404) | `inspectFolder` | No se registra. | "No tenemos acceso. Compartila como Lector con `qa-visual@…`", con botón de copiar. |
| Carpeta en la papelera | `inspectFolder` | No se registra. | "La carpeta está en la papelera de Drive." |
| Acceso directo (shortcut) como carpeta raíz o subcarpeta | `inspectFolder` y listado | Se resuelve `shortcutDetails.targetId` si apunta a una carpeta. | Transparente. |
| Falta RECURSOS, EDITABLES o DESPLIEGUE | `inspectFolder` | No se registra. | La lista de verificación marca la que falta. |
| Subcarpeta con otro uso de mayúsculas, tildes o espacios | Normalización | Se acepta. | Transparente. |
| Dos subcarpetas que normalizan al mismo nombre | `inspectFolder` | No se registra. | "Hay dos carpetas DESPLIEGUE; dejá una sola." |
| Carpeta ya registrada y activa | `register` | No se duplica. | "Esta carpeta ya está registrada", con enlace a la campaña. |
| Carpeta registrada en una campaña archivada | `register` | No se duplica. | "Pertenece a una campaña archivada", con opción de restaurarla. |
| Dos personas registran la misma carpeta a la vez | `register` (concurrencia optimista) | Una sola campaña. | La segunda recibe "ya está registrada". |
| Se perdió el permiso después del alta | Importación | `failed: access_lost`. Se conserva la última importación. | Banner: "Se perdió el acceso a la carpeta en Drive", con la indicación de compartirla y un botón para reintentar. |
| Error 429 o 5xx de Drive | Importación | Reintento automático (3 veces). Si persiste, `failed: drive_unavailable` reintentable. | "Google Drive no respondió", con botón para reintentar. |
| Un archivo cambia durante la descarga (MD5 distinto) | Importación | Reintento. | Transparente o error reintentable. |
| Varias matrices o varios CSV | Importación | `needsSource`. | "Elegí la matriz", con un selector. |
| Excel corrupto o con contraseña | Importación | `failed: workbook_unreadable`. | "No se pudo abrir el Excel: está dañado o protegido." |
| Excel con otra plantilla | Importación | `failed: template_unrecognized`. | Indica qué hoja o encabezado faltó. |
| Excel más grande que el límite | Importación | `failed: file_too_large`. | Muestra el tamaño y el límite. |
| CSV sin `ID_PIEZA` | Importación | `failed: csv_missing_columns`. | Lista las columnas faltantes. |
| DESPLIEGUE sin imágenes | Importación | `ready` con cero piezas. | "No hay imágenes PNG o JPEG en DESPLIEGUE", más la lista de archivos ignorados. |
| Archivos que no son imagen (PDF, MP4, AI, PSD) | Importación | Se ignoran. | Recursos, en "Archivos no analizados", con el motivo. |
| Subcarpetas dentro de DESPLIEGUE | Importación | No se recorren en v1. | "La subcarpeta X tiene N archivos que no se analizan." Ver §22. |
| Dos imágenes con el mismo nombre presentes a la vez | Importación (§6.1) | Ambas se importan como piezas distintas: la que ya existía conserva la clave base y la otra recibe `baseKey#id`. | Aviso `file_duplicate_name` en ambas. Se analizan contra la misma fila y se ofrecen "Marcar como definitiva" y "Es una versión nueva de…". |
| Extensión que no coincide con el contenido (un PNG llamado `.jpg`) | Preparación de la imagen | Manda el formato decodificado. | El aviso `format_extension_mismatch` es documental. El control de formato usa el formato real. |
| Imagen de más de 20 MB o 32 MP | Preparación de la imagen | La versión queda en `image.failed`. | La tarjeta muestra "Imagen no admitida (supera 20 MB)". Esa pieza no se analiza y el resto sigue. |
| Imagen con transparencia | Preparación de la imagen | Se aplana sobre blanco para el análisis. | Aviso `has_transparency` para confirmar la legibilidad sobre otros fondos. |
| Más de 1000 imágenes | Importación | `failed: too_many_pieces`. | Muestra el límite y la cantidad encontrada. |
| Imagen sin fila en el CSV | Vinculación | La pieza se importa igual. | Aviso `csv_row_missing`. Solo hay controles técnicos y se ofrece "Vincular manualmente". |
| La fila del CSV no encuentra una fila en el Excel | Vinculación | Se analiza contra la producción (§8.2). | Aviso `excel_row_missing`. |

### 7.7 Actualizar desde Drive y reprocesar

- **Actualizar desde Drive:** ejecuta el flujo completo. Si el `fingerprint` no cambió, no escribe nada nuevo.
- **Reprocesar** (interno o por botón): vuelve a interpretar los originales **desde Storage**, sin descargar el Excel ni el CSV, y lista DESPLIEGUE solo para el inventario. Se dispara cuando:
  - Sube `PARSER_VERSION`. Una mutación de despliegue encola un reprocesamiento por cada campaña activa (`trigger: parserUpgrade`).
  - Se crea o se revoca una confirmación humana (`qaVisualLinkOverrides`).
- En ambos casos, las piezas cuyo `inputHash` cambió aparecen como desactualizadas, con su motivo. Las demás conservan su análisis.

---

## 8 Vinculación y requisitos

### 8.1 Cadena por pieza

```text
Imagen (key) ─► fila CSV (ID_PIEZA) ─► fila Excel (campaña, fase, canal, medio, tipo) ─► oferta numerada en K ─► precio con el mismo numeral en L
                    │                        │                                         │
                    └─ producción declarada  └─ formato, dimensiones, notas (P)        └─ producto, vigencia
```

Cada paso produce un `LinkStep` con estado (`linked`, `missing`, `ambiguous` o `manual`). **Un paso fallido afecta solo a los requisitos que dependen de él.**

| Paso fallido | Controles afectados | Controles que se analizan igual |
| --- | --- | --- |
| Fila del CSV | Todos los que dependen del pedido | Formato y dimensiones contra el nombre del archivo, solo como corroboración. Con `basis: production` y aviso, nunca "Validada". |
| Fila del Excel | Producto, precio, fecha, formato, dimensiones y CTA según el cliente | Los mismos controles contra los valores del CSV (`basis: production`), con aviso `excel_row_missing`. |
| Oferta (ambigua o no encontrada) | Producto, precio y fecha según el cliente | Formato, dimensiones y CTA según el cliente. Producto y precio contra el CSV (`basis: production`). |
| Precio (falta o está duplicado) | Precio según el cliente | Todo lo demás, más el precio contra el CSV si existe. |

Así se cumple el pedido de la usuaria: **siempre se analiza la pieza**. Cuando el pedido del cliente no puede vincularse, se compara con lo declarado por producción y se indica claramente que la referencia es el CSV y no el cliente. El CSV nunca reemplaza en silencio al pedido (regla 3 de la especificación): `basis` queda visible en cada control y el dictamen no puede ser "Validada por IA" mientras haya controles con `basis: production`.

### 8.2 Normalización (`model/normalize.ts`)

- Unicode NFD, sin marcas diacríticas, en mayúsculas, con todo lo que no sea alfanumérico convertido en espacio y espacios colapsados.
- **Tokens de conexión** que se ignoran al comparar productos. La lista es cerrada y versionada: `DE, DEL, LA, EL, LOS, LAS, Y, CON, AL, EN`.
- **Los números se comparan exactos.** `10 PRESAS` nunca equivale a `12 PRESAS`.
- **Canal y temporalidad** se extraen como tokens estructurados antes de comparar el producto: el canal (`DOMICILIO`, `EXPRESS`, `AUTORAPIDO`, con un catálogo extensible por plantilla) y la temporalidad (`HOY`, `22 DE OCTUBRE`, `OCTUBRE 22`, o una fecha de Excel convertida).
- Las equivalencias de formato (`POST ESTATICO` = `POST`, `STORIES ESTATICAS` = `STORY`, `POST CARROUSEL` = `CARRUSEL`) se declaran en la plantilla.

### 8.3 Selección de oferta por niveles (`model/linking.ts`)

1. Se interpreta cada entrada de K como `{ ordinal, channel?, temporal?, productText, productTokens }`.
2. Se filtran los candidatos por canal (de la fila del CSV o, si falta, de un token del nombre de archivo) y por temporalidad (de `SLOT_FECHA` o del token del archivo). Si el canal del CSV y el del archivo difieren, se emite el aviso `channel_mismatch` y se usa el del CSV.
3. Se compara el producto del CSV contra los candidatos, nivel por nivel. **Se queda con el primer nivel que produce resultados**:

| Nivel | Regla | Aviso |
| --- | --- | --- |
| 1 `exact` | Tokens idénticos. | Ninguno. |
| 2 `connectors` | Tokens idénticos sin contar los de conexión, en el mismo orden y con los mismos números. | `offer_name_equivalence` (informativo): "El CSV dice FESTIN DE LOCURA y el Excel FESTIN LOCURA (oferta 7). Se tomaron como la misma oferta." |
| 3 `contained` | Los tokens del CSV aparecen como subsecuencia contigua dentro de la oferta. | `offer_name_partial` (advertencia), con los textos de ambos lados. |
| 4 `alias` | Equivalencia confirmada en `qaVisualLinkOverrides`. | `offer_alias_applied` (informativo), con autor y fecha. |
| — | Fuzzy (distancia de edición o similitud) | **Nunca se aplica automáticamente.** Solo aparece como sugerencia, con el botón "Confirmar equivalencia". |

4. **Unicidad:** si el nivel ganador produce un solo candidato, la oferta queda vinculada. Si produce dos o más, el resultado es `offer_ambiguous`, con la lista de candidatos (numeral y texto) y sin elección inventada. Si ningún nivel produce resultados, es `offer_not_found`, con las sugerencias fuzzy cuando las hay.
5. Un vínculo manual (`offerLink`) tiene prioridad sobre todo lo anterior y se informa como `manual`.

### 8.4 Precio, fecha y CTA

- **Precio:** se conserva el algoritmo actual por numeral (§2.9).
  - Precio de Excel y CSV equivalentes: estado `ready`.
  - Precio distinto: estado `conflict`, con `expected` del Excel y `expectedAlternatives` del CSV, más el aviso `price_conflict_csv` con las dos fuentes.
  - Numeral sin precio: estado `missing` y aviso `price_missing`.
  - Numeral duplicado: estado `invalid` y aviso `price_duplicate_ordinal`.
- **Fecha:** se toma la temporalidad de la oferta seleccionada. Si `SLOT_FECHA` o el nombre de archivo indican otra cosa, se emite `date_mismatch_sources`. `HOY` y una fecha concreta son valores distintos. La imagen debe contener los componentes exigidos por la referencia: no se completa un mes o año ausente desde el contexto de la campaña (§9.2.1).
- **CTA:** se toman las líneas de P que coinciden con el patrón de CTA.
  - Si la fila tiene P y ninguna línea coincide: estado `notRequested`, salvo que P contenga palabras de CTA que no se pudieron interpretar, en cuyo caso es `unresolved`.
  - Si la fila **no** tiene P: `notRequested`.
- **Formato y dimensiones:** se toman de G, I y J. Un conflicto con LEYENDA emite `dimensions_legend_conflict` y se evalúa contra la fila de PRODUCCION, que es la más específica.
- **Stories con oferta completa:** el comportamiento actual se mantiene, con un único aviso `stories_offer_filled`.

### 8.5 Requisito

```ts
type Requirement = {
  ruleId: "format" | "dimensions" | "product" | "price" | "date" | "cta" | string;
  status: "ready" | "notRequested" | "conflict" | "unresolved" | "missing" | "invalid";
  basis: "client" | "production";
  expected?: string;                 // valor normalizado para comparar
  display?: string;                  // texto original, para mostrar
  expectedAlternatives?: string[];   // conflicto
  sources: { file: "excel" | "csv" | "filename" | "override";
             sheet?: string; cell?: string; ordinal?: string; csvLine?: number; column?: string;
             text: string }[];
  issueIds: string[];                // avisos que explican el estado
};
```

| Estado | Qué se hace al analizar |
| --- | --- |
| `ready` | Se evalúa con código o con el modelo. |
| `notRequested` | `notApplicable`, sin llamar al modelo. |
| `conflict` | El modelo lee el valor visible y el código lo compara con ambas alternativas. Si coincide con el valor del cliente, `pass`, con el conflicto informado. Si coincide solo con el del CSV, `fail` frente al cliente. Si no coincide con ninguno, `fail`. |
| `unresolved` o `missing` con alternativa del CSV | Se evalúa con `basis: production`. |
| `unresolved` o `missing` sin alternativa | `unverifiable`, con `causeIssueId`. **No se envía al modelo y no se repite el mismo texto en tres comentarios.** |
| `invalid` | Igual que el caso anterior, con el aviso del dato inválido. |

### 8.6 Avisos de fuente (`model/issues.ts`)

```ts
type Issue = {
  id: string;                         // hash estable de code + alcance + datos
  code: IssueCode;
  severity: "info" | "warning" | "blocking";
  scope: "campaign" | "piece";
  affects: string[];                  // ruleIds afectados ([] = informativo)
  message: string;                    // en español, ya interpolado
  sources: Source[];
  suggestion?: { kind: "confirmAlias" | "chooseOffer" | "chooseSource"; data: unknown };
};
```

Catálogo inicial: `csv_missing`, `csv_missing_columns`, `csv_duplicate_id`, `csv_row_missing`, `csv_encoding_fallback`, `excel_row_missing`, `excel_row_ambiguous`, `offer_name_equivalence`, `offer_name_partial`, `offer_alias_applied`, `offer_ambiguous`, `offer_not_found`, `price_missing`, `price_duplicate_ordinal`, `price_invalid`, `price_conflict_csv`, `date_mismatch_sources`, `channel_mismatch`, `dimensions_legend_conflict`, `stories_offer_filled`, `formula_without_value`, `file_duplicate_name`, `format_extension_mismatch`, `has_transparency`, `template_optional_sheet_missing`, `legend_reference_missing`.

Reglas:

- **Un aviso por causa y pieza.** Si un fallo de oferta afecta a tres controles, se genera un solo aviso con `affects: ["product","price","date"]`.
- Los avisos se muestran como **comentarios generales de tipo "Aviso de fuente"**, con un ícono y un color propios. Nunca tienen marcador sobre la imagen ni cuentan como hallazgos.
- Los avisos con `suggestion` muestran una acción: confirmar la equivalencia, elegir la oferta o elegir la fuente.
- Un aviso puede marcarse como revisado (`ignoreIssue`) con un motivo. Sigue visible en el historial y no se borra.

### 8.7 La pieza 16 con la nueva vinculación

1. Archivo `…_AUTORAPIDO_FESTIN_DE_LOCURA_HOY_1080X1080px.png`: se encuentra la fila del CSV, con `TXT_PRODUCTO = FESTIN DE LOCURA` y `TXT_PRECIO = 8,99`.
2. Fila del Excel 6: coinciden campaña, fase, canal, medio y tipo.
3. K6 tiene 13 ofertas. Filtrando por canal `AUTORAPIDO` y temporalidad `HOY` quedan las entradas con ese canal y esa temporalidad.
4. Nivel 1: no hay coincidencia exacta. Nivel 2: `FESTIN DE LOCURA` y `FESTIN LOCURA` dan los mismos tokens `[FESTIN, LOCURA]` sin conectores. Hay **un** candidato: la oferta 7.
5. El precio es L6 n.º 7, `$8,99`, igual al CSV, así que queda `ready`. La fecha es `HOY` y queda `ready`.
6. Aviso único `offer_name_equivalence` (informativo).
7. Se envían al modelo producto, precio y fecha, y el CTA se resuelve según P.
8. Detalles muestra cada requisito con su cadena de origen: `PRODUCCION!K6 · Oferta n.º 7` para el producto y `PRODUCCION!L6 · Precio n.º 7` para el precio.

### 8.8 Pruebas de regresión obligatorias

Pieza 16 (equivalencia por conectores). Primer precio vacío y `$5,99` en el numeral 2. Numeral duplicado. Precio del Excel distinto al del CSV. Story con oferta completa. Dos candidatos en el nivel 2 (ambigüedad). Imagen sin fila en el CSV. Celdas A y B combinadas. Fecha guardada como número serial. CSV con BOM y separador `;`. ID duplicado en el CSV. **Agregar una imagen no cambia el `inputHash` de las demás.**

---

## 9 Análisis de IA

### 9.1 Qué se resuelve con código y qué con el modelo

| Control | Método | Detalle |
| --- | --- | --- |
| Formato | Código | Formato decodificado del original contra G, con las equivalencias JPG/JPEG. |
| Dimensiones | Código | Ancho y alto del original contra I y J. |
| Precio | Lectura y evaluación semántica, con comparación exacta cuando aplica | El código compara importes simples (`$8,99` = `8.99`) contra la referencia. Para otras expresiones legibles conserva el resultado semántico; no convierte un formato desconocido en `unverifiable`. La alternativa de producción nunca reemplaza el pedido del cliente. |
| Fecha y vigencia | Lectura y evaluación semántica, con comparación estructurada cuando aplica | Se compara la expresión completa y cada componente requerido. `JUEVES 15` frente a `15 DE OCTUBRE` es `fail` por faltar el mes. Se aceptan escrituras equivalentes que conservan los datos, como `15/10`. Rangos y condiciones que el código no interpreta se evalúan semánticamente, sin truncarlos a la primera fecha. |
| Producto | El modelo juzga | Hace falta interpretar la semántica: el nombre comercial visible frente a la oferta. |
| CTA | El modelo juzga | Criterio del cliente frente al texto visible. Por ejemplo, `A DOMICILIO POR KFC APP` no es una invitación a descargar la app. |

El modelo responde un objeto por control: `{ ruleId, visibleText, evidenceStatus, missingElements, outcome, observed, visibleAnchor, box_2d }`. El código aplica las reglas de §9.2.1. `method` indica cómo se obtuvo el resultado final: `deterministic` para una comparación soportada o `model` para la evaluación semántica. Una comparación no soportada devuelve internamente "sin comparación determinista"; eso no es un dictamen ni un `unverifiable`. La evaluación semántica ya viene en la misma respuesta: no requiere otra llamada por cada formato desconocido.

### 9.2 Contrato del prompt (`model/prompt.ts`)

- El prompt se versiona con `ANALYSIS_POLICY_VERSION`, que entra en el `inputHash`.
- Los datos (requisitos e imagen) se tratan como datos y nunca como instrucciones. Esto ya está así y se mantiene.
- Cada control incluye `ruleId`, el criterio y el valor esperado. Si existe, también la alternativa y la indicación "comparar con el pedido del cliente" o "comparar con lo declarado por producción".
- Se exige exactamente un control por cada `ruleId` enviado. Si falta alguno o hay uno duplicado, se considera salida inválida y se reintenta (§10.3).
- La evidencia se clasifica separadamente del resultado. `missingElements` enumera solo omisiones confirmadas de requisitos reales. No se inventan palabras, meses, años, importes o exigencias a partir del contexto.

### 9.2.1 Política de contenido legible, omisiones e incertidumbre (13/11/2026)

**Regla central:** una pieza con texto legible que incumple u omite algo exigido por el cliente tiene un hallazgo. "Revisión incompleta" describe la imposibilidad real de concluir la evaluación; no describe un texto incompleto respecto del pedido.

| Evidencia y referencia | Resultado del control | Explicación requerida |
| --- | --- | --- |
| Contenido legible y equivalente, con todos los componentes solicitados | `pass` | Qué coincide con la referencia. No se exige copia literal salvo que el criterio lo indique. |
| Contenido legible diferente, o parte requerida ausente | `fail` | Qué se pidió, qué se ve y qué falta o difiere. Incluye producto, cantidad, precio, fecha, CTA y otros controles configurados. |
| Se inspeccionó la imagen y se confirmó que el elemento requerido no aparece (`absent`) | `fail` | Identificar el elemento ausente. No se necesita inventar un marcador donde no hay nada visible. |
| Elemento presente pero ilegible (`unreadable`), o evidencia realmente ambigua (`ambiguous`) | `unverifiable` | Indicar qué información concreta impide decidir. Una zona borrosa o recortada no demuestra ausencia. |
| Falta una referencia suficiente del cliente o su vinculación es incierta | `unverifiable` para el control afectado, o evaluación parcial contra producción según §8.5 | Explicar el problema de fuente y conservar su `causeIssueId`. No atribuirlo a un error del diseño. |
| Texto legible con sintaxis no soportada por el comparador | Evaluación semántica: `pass` o `fail` | La limitación del código no autoriza `unverifiable`. Si existe una ambigüedad real, se identifica como tal y se explica. |
| El cliente no solicitó el control (`notRequested`) | `notApplicable` | No participa en los controles solicitados. El modelo no puede descartar por su cuenta un requisito recibido. |

Orden de resolución por control:

1. Comprobar aplicabilidad y disponibilidad de referencia (§8.5).
2. Una ausencia confirmada es `fail`. Una omisión confirmada en evidencia legible también es `fail`, aunque el modelo haya propuesto `unverifiable`.
3. Evidencia ilegible o verdaderamente ambigua queda `unverifiable`, con explicación. Una salida que simultáneamente afirma que no puede verificar la evidencia y enumera ausencias confirmadas es inconsistente y se reintenta.
4. Para precio y fecha legibles, aplicar la comparación determinista cuando reconoce toda la expresión. Las fechas se comparan por los componentes exigidos; un componente requerido ausente es un incumplimiento.
5. Cuando no hay comparación determinista, conservar la evaluación semántica. Si el modelo informa `readable` pero devuelve `unverifiable` sin una omisión resoluble, o intenta marcar como `notApplicable` un control solicitado, tratarlo como salida inválida y reintentar. Si se agotan los intentos, es **error de análisis**, no una revisión completada como "incompleta".

Ejemplos obligatorios:

| Pedido | Visible / evidencia | Resultado |
| --- | --- | --- |
| `15 DE OCTUBRE` | `JUEVES 15` legible | `fail`: falta el mes. No se infiere octubre del pedido, del calendario ni de la campaña. |
| `15 DE OCTUBRE` | `15/10`, `15 OCT.`, `OCTUBRE 15` | `pass`: conservan día y mes. Fechas numéricas en orden día/mes[/año]; también se reconoce ISO año-mes-día. |
| `15 DE OCTUBRE DE 2026` | `15/10` | `fail`: falta el año requerido. Si el pedido no exige año, no se agrega esa exigencia. |
| `15 DE OCTUBRE` | `16 DE OCTUBRE` o `HOY` | `fail`: la vigencia no coincide. |
| `DEL 15 AL 20 DE OCTUBRE` | Rango legible | Evaluación semántica de ambos extremos y sus condiciones, sin aprobar por reconocer solo el primer día. |
| `$8,99` | `8.99` | `pass`. Un precio diferente es `fail`, incluso si coincide con el CSV. |
| `FESTIN LOCURA 12 PRESAS` | `FESTIN LOCURA` sin cantidad | `fail`: falta la cantidad solicitada. |
| Invitación a descargar la app | `A DOMICILIO POR KFC APP` | `fail`: mencionar la app no cumple la acción requerida. |
| Precio solicitado | No aparece en la imagen completa | `fail`: ausencia confirmada. |
| Precio solicitado | Zona borrosa, no se distingue el importe | `unverifiable`: falta evidencia legible. |

`evidenceStatus` y `missingElements` se guardan en el hallazgo para auditar la conclusión; son opcionales en datos históricos. `observedValue` conserva el texto literal. `locationStatus` solo describe la ubicación del comentario y nunca rebaja un incumplimiento a `unverifiable`.

### 9.3 Coordenadas

Se mantiene `box_2d` en el rango de 0 a 1000, en el orden `[y_min, x_min, y_max, x_max]`, y su conversión. Las regiones se refieren a la imagen de análisis, la misma que muestra el visor, así que no hace falta reescalar.

### 9.4 Localización sin bloqueo

- Si un `fail` o `unverifiable` llega sin caja válida, se hace **una** llamada adicional de localización, como ahora.
- Si esa llamada falla, devuelve `uncertain` o una caja inválida, el control **se conserva** con `locationStatus: "unlocated"` y se muestra como comentario general con la etiqueta "Sin ubicación precisa". No se reintenta la pieza completa.
- `absent` y `unreadable` se conservan.
- Una prueba de evaluación mide la intersección sobre la unión (IoU) entre la caja y una caja anotada por una persona (§16).

### 9.5 Dictamen y cobertura (`model/verdict.ts`)

```ts
coverage = {
  requested,          // controles cuyo requisito no es notRequested
  executed,           // con outcome pass o fail
  pass, fail, unverifiable, notApplicable,
  visualRequested,    // controles visuales solicitados (product, price, date, cta…)
  modelControls,      // controles visuales que efectivamente pasaron por el modelo
  productionBasis,    // controles comparados contra el CSV en lugar del cliente
  unresolvedInputs,   // requisitos solicitados en conflict, unresolved, missing o invalid
  blockingNotices,    // avisos warning o blocking que afectan a un control solicitado
};
```

**Validada por IA (verde).** Se muestra **solo si se cumplen todas estas condiciones**. Si falla cualquiera, la pieza no queda en verde:

| # | Condición | Si no se cumple |
| --- | --- | --- |
| V1 | El trabajo técnico terminó (`completed`). | "Error de análisis" o el estado en curso. |
| V2 | El resultado está vigente: su `inputHash` coincide con `display.inputHash`. | "Desactualizada", en tono neutro. |
| V3 | `requested ≥ 1`. | "Revisión incompleta · Pedido sin vincular". |
| V4 | `pass === requested`: ningún `fail`, `unverifiable` ni control sin ejecutar. | "Con hallazgos" si hay algún `fail`. Si no, "Revisión incompleta". |
| V5 | `productionBasis === 0`: todo se comparó contra el pedido del cliente. | "Revisión incompleta · Pedido sin vincular". |
| V6 | `unresolvedInputs === 0`. Un requisito en `conflict` impide el verde **aunque la imagen coincida con el valor del cliente**. | "Revisión incompleta · Conflicto de fuentes" o "Dato inválido en el pedido". |
| V7 | `blockingNotices === 0`. Los avisos `info`, como `offer_name_equivalence` u `offer_alias_applied`, no impiden el verde. Un `offer_name_partial` sí lo impide hasta que una persona confirme la equivalencia. | "Revisión incompleta · Vinculación por confirmar". |
| V8 | `modelControls === visualRequested`: si se pidió algún control visual, todos pasaron por el modelo. Una revisión con solo formato y dimensiones nunca es verde cuando se pidió algo visual. | "Revisión incompleta · Solo controles técnicos". |

**Dictamen y prioridad de etiquetas:**

```ts
if (job.status !== "completed")         -> estado técnico (en cola / analizando / error)
else if (!fresh)                        -> "Desactualizada" (neutro), mostrando debajo el dictamen anterior
else if (fail > 0)                      -> verdict "findings"   · "Con hallazgos" (+ "· N no verificables" si corresponde)
else if (V3…V8 se cumplen)              -> verdict "validated"  · "Validada por IA" (verde)
else                                    -> verdict "partial"    · "Revisión incompleta · <motivo>"
```

Cuando hay más de un motivo de "Revisión incompleta", se muestra el primero de esta lista: **Pedido sin vincular** (V3 o V5) > **Conflicto de fuentes / dato inválido** (V6) > **Controles duplicados en el pedido** > **Vinculación por confirmar** (V7) > **Falta información para concluir controles solicitados** (V4 por `unverifiable`) > **Solo controles técnicos / visuales pendientes** (V8). Detalles muestra la lista completa. No se presenta "evidencia ilegible" como explicación genérica de un formato no soportado.

**Clasificación de la pieza:** un `fail` basta para "Con hallazgos", incluso si otro control sigue sin verificarse. Cuatro `pass` y una omisión legible son **5/5 controles verificados, 1 hallazgo**. Cuatro `pass` y un texto realmente ilegible son **4/5 controles verificados, revisión incompleta**. El número de comentarios no determina el dictamen: los comentarios incluyen hallazgos, controles no verificables y avisos de fuente. Resolver una conversación no cambia el resultado de IA ni aprueba la pieza.

| Dictamen | Tono |
| --- | --- |
| `validated` | Éxito (verde). Es el único dictamen de IA que puede ser verde. |
| `findings` | Advertencia, o peligro si algún `fail` es `blocking`. |
| `partial` | Advertencia. |
| Desactualizada | Neutro. |
| Error de análisis | Peligro. |

`model/verdict.ts` es una función pura y tiene una prueba por fila de la tabla de condiciones, más los casos combinados: `fail` junto con `unverifiable`, conflicto en el que la imagen coincide con el cliente, solo controles técnicos, aviso `info` frente a `warning`, y resultado desactualizado.

La tarjeta muestra el dictamen y la cobertura juntos, por ejemplo "4/5 controles". Detalles muestra cada control con su método (código o IA), su base (cliente o producción) y su resultado.

### 9.6 Evidencia y reproducibilidad

Cada intento guarda: proveedor, modelo, `ANALYSIS_POLICY_VERSION`, tiempo en cola, tiempo del modelo, tokens y `rawId`. `rawId` apunta a un JSON en Storage con la solicitud (sin la imagen, solo su hash) y la respuesta estructurada cruda. Cada revisión referencia `importPieceId`, que es inmutable, y `pieceVersionId`. Con eso se puede reconstruir exactamente qué se pidió y qué se respondió.

### 9.7 Configuración de modelos

`model/llm.ts` define `qaModels = { primary: { provider: "gemini", id, providerOptions }, fallback: { provider: "openai", id } }` y reutiliza solo las fábricas de proveedor de `convex/lib/llmFallback.ts`. Cambiar el modelo de otro agente ya no afecta a QA, y QA tampoco afecta a los otros agentes.

---

## 10 Orquestación

### 10.1 Pools

> **Comentario de decisión — 12 de noviembre de 2026. Implementado en la etapa 4 (`analysisPool.ts`, variable `QA_VISUAL_ANALYSIS_CONCURRENCY`); falta fijar el valor con mediciones.** Se reemplaza el tope global propuesto de **ocho análisis simultáneos** por una concurrencia global **configurable por entorno y dimensionada con mediciones**. Se mantiene Workpool como ejecutor exclusivo de los análisis de QA. No se acuerda otro número fijo ni una ejecución sin límites; esta decisión no cambia el cupo de cuatro piezas por corrida ni los límites de importación e imágenes.
>
> **Justificación:** la captura de cuotas aportada muestra 20.000 solicitudes por minuto y 20 millones de tokens de entrada por minuto para Gemini 3.8 Flash. Esas cuotas, por sí solas, no justifican el tope de ocho; mantenerlo sin medir puede provocar esperas innecesarias entre usuarios. Los requests de usuarios distintos comparten la cuota del proyecto. Además, RPM y TPM miden consumo por minuto, no cantidad de trabajos simultáneos, por lo que no se convierten directamente en un valor de `maxParallelism`. La configuración revisada usa Gemini 3.7 Flash: antes de dimensionar hay que comprobar las cuotas del modelo y proyecto que QA utilizará efectivamente.
>
> **Aplicación del cambio:** elegir y documentar el valor global durante la etapa 4 a partir de la capacidad del despliegue de Convex, las cuotas de Gemini y del proveedor de respaldo, la duración de las llamadas y los tokens y llamadas por pieza, incluidos reintentos y localización. Validarlo con campañas concurrentes, midiendo tiempo en cola, latencia y errores de cuota; comprobar que todas las campañas avanzan. El límite global y el cupo por corrida son controles de concurrencia, no una garantía automática de reparto equitativo.
>
> **Experiencia de uso:** conservar la entrega progresiva de resultados: cada pieza aparece al terminar, sin esperar a toda la campaña. Workpool se apoya en el scheduler y permite iniciar trabajos en cuanto hay capacidad; sustituirlo por el scheduler no elimina los límites de Convex ni aporta por sí solo reintentos y recuperación. El cambio de proveedor ante fallos es independiente del límite de concurrencia.

| Pool | Paralelismo | Reintento propio de Workpool | Uso |
| --- | --- | --- | --- |
| `qaVisualImportPool` | 2 | 3 intentos, espera exponencial desde 2 s | Importaciones y reprocesamientos. |
| `qaVisualImagePool` | 4 | 3 intentos | Una tarea por versión de imagen sin preparar. |
| `qaVisualAnalysisPool` | Global configurable por entorno, según cuotas y capacidad medidas (comentario de decisión anterior) | Ninguno: la política está en `retryPolicy` | Un intento de análisis por tarea. |

### 10.2 Ciclo de una corrida

1. `runs.start({ campaignId, scope, pieceIds?, requestId })` (mutación):
   - Controla el acceso. Si ya existe la corrida para ese `requestId`, la devuelve.
   - Si ya hay una corrida activa, agrega los ítems a esa corrida (§10.4).
   - Si no, crea la corrida con un ítem `queued` por cada pieza del alcance. **No se crea un ítem si ya hay uno no terminal para el mismo `(pieceVersionId, inputHash)`.**
   - Guarda `campaign.activeRunId` y llama a `fillSlots`.
2. `fillSlots(ctx, runId)` (helper de mutación):
   ```ts
   const running = await ctx.db.query("qaVisualReviews")
     .withIndex("by_run_status_order", q => q.eq("runId", runId).eq("status", "running")).take(4);
   const free = 4 - running.length;
   const next = free > 0 ? await …eq("status", "queued").take(free) : [];
   for (const item of next) {
     const workId = await analysisPool.enqueueAction(ctx, internal.qaVisual.analyzeJob.attempt,
       { reviewId: item._id, provider: "gemini" },
       { onComplete: internal.qaVisual.runs.onAttemptComplete, context: { reviewId: item._id, n: 1 } });
     await ctx.db.patch(item._id, { status: "running", phase: "image", workId });
   }
   if (!running.length && !next.length) await finishRun(ctx, runId);
   ```
   Así hay como máximo cuatro piezas por corrida y el total queda limitado por la concurrencia global configurada según §10.1. El avance de varias campañas debe verificarse con carga concurrente; esos límites no garantizan por sí solos un reparto equitativo.
3. `analyzeJob.attempt` (acción). Si la imagen no está lista, la prepara en el mismo intento. Después ejecuta los controles deterministas y, si hay controles visuales, llama al modelo y localiza. **No lanza excepciones por errores esperados**: devuelve `{ kind: "done", findings, attempt }`, `{ kind: "retryable", code, attempt, retryAfterMs? }` o `{ kind: "fatal", code, message, attempt? }`.
4. `runs.onAttemptComplete` (mutación de Workpool):
   - Ignora la llamada si el ítem no está en `running` o si su `workId` no coincide. Eso la hace idempotente.
   - `done`: guarda los hallazgos y el resultado, marca el ítem como `completed`, actualiza los contadores de la corrida y la tarjeta (`refreshPieceCard`), y llama a `fillSlots`.
   - `retryable` (o una excepción no prevista): `retryPolicy(attempts)` decide el siguiente paso. Puede ser otro intento con el mismo proveedor, el cambio de proveedor o el error definitivo. Si hay otro intento, se encola con `runAfter`, se pone `phase: waitingRetry` y el lugar sigue ocupado.
   - `fatal`: marca el ítem como `failed` con un código y un mensaje claro, y llama a `fillSlots`.
   - `canceled`: marca el ítem como `cancelled`.
5. `finishRun` marca la corrida como `completed`, guarda `finishedAt`, libera `activeRunId` y actualiza el resumen de la campaña.

### 10.3 Política de reintentos (`model/retryPolicy.ts`)

| Causa (código) | Mismo proveedor | Cambio a OpenAI | Espera |
| --- | --- | --- | --- |
| `timeout` (75 s), `http_5xx`, `network` | Hasta 3 intentos con Gemini | Sí, hasta 2 intentos | 2 s y 4 s |
| `http_429` (cuota) | Hasta 3 intentos, respetando `Retry-After` | Sí | `Retry-After` o 10 s y 30 s |
| `invalid_output` (esquema o controles faltantes) | 1 reintento | Sí | 2 s |
| `safety_blocked` | No | Sí, 1 intento | — |
| `http_400` o `image_rejected` | No | No (es un error de entrada) | `fatal` |
| `image_unavailable` o `image_too_large` | No | No | `fatal`. La imagen se informa en la tarjeta. |
| Excepción no prevista | Se trata como `network` | Sí | 2 s |

El total máximo es de cinco llamadas al modelo por pieza, más una de localización por intento.

### 10.4 Analizar una pieza durante una corrida

- Si no hay corrida activa, se crea una corrida de tipo `piece`.
- Si hay corrida activa, se agrega un ítem a esa corrida con `order` negativo, así que entra al frente de la cola. La UI avisa: "Se agregó al análisis en curso".
- Si la pieza ya tiene un ítem `queued` o `running` con el mismo `inputHash`, no se duplica. La UI muestra "Ya se está analizando".

### 10.5 Cancelar y reintentar fallidas

- `runs.cancel({ runId })`: pasa los ítems `queued` a `cancelled`, llama a `analysisPool.cancel(workId)` para los que están `running` y cierra la corrida. Los resultados ya completos se conservan.
- `runs.retryFailed({ runId })` crea una corrida `retry` con las piezas `failed` de esa corrida. Los resultados previos no se tocan.

### 10.6 Vigilancia

Hay un cron cada 10 minutos (`convex/crons.ts`):

- Revisa los ítems `running` con más de 15 minutos. Consulta `analysisPool.status(workId)`. Si el trabajo ya no existe, aplica el mismo cierre que `onAttemptComplete` con `canceled`, y el ítem queda `failed: lost_work`.
- Revisa las corridas `running` sin ítems activos y las cierra.
- Revisa las importaciones en `running` o `building` con más de 30 minutos. Las marca como `failed: stalled` y libera `activeImportId`.

Una vez al día, borra los blobs de Storage huérfanos (originales sin `qaVisualSourceFiles` e imágenes sin versión) y las filas `building` abandonadas.

---

## 11 Contratos de datos para la UI

### 11.1 Consultas

| Función | Lee | Devuelve |
| --- | --- | --- |
| `campaigns.list({ paginationOpts })` | `qaVisualCampaigns` por `by_status` | `{ id, name, summary, import: { state, stage?, error?, lastImportedAt }, run?: { done, total } }` |
| `editor.campaign({ campaignId })` | La campaña, su importación vigente, la activa y la corrida activa | Cabecera, banner de importación, `sources` (Excel, CSV y elección pendiente), `issues` de campaña, `counts`, `parserOutdated` y `run.counts`. |
| `editor.pieces({ campaignId })` | `qaVisualPieces` por `by_campaign_order` (≤ 1000 documentos chicos) | `PieceCard[]` |
| `editor.piece({ pieceId, version? })` | Pieza, versiones, `importPiece`, últimas revisiones de esa versión, hilos con comentarios y decisiones | Todo lo que necesita la pieza seleccionada: requisitos, avisos, hallazgos, resultado previo y estado de desactualización. |
| `editor.history({ pieceId, paginationOpts })` | Revisiones, decisiones, versiones y comentarios de la pieza | Línea de tiempo paginada. |
| `campaigns.serviceAccount()` | Variable de entorno (solo `client_email`) | El correo para compartir la carpeta. |

### 11.2 Mutaciones y acciones públicas

`campaigns.inspectFolder`\* · `campaigns.register`\* · `campaigns.chooseSource` · `campaigns.rename` · `campaigns.archive` · `campaigns.restore` · `imports.request` · `runs.start` · `runs.cancel` · `runs.retryFailed` · `threads.create` · `threads.reply` · `threads.resolve` · `threads.reopen` · `threads.editComment` · `threads.removeComment` · `decisions.decide` · `decisions.revoke` · `overrides.confirmAlias` · `overrides.linkOffer` · `overrides.revoke` · `overrides.ignoreIssue`.
`*` Son acciones.

Los errores esperados se devuelven como `ConvexError({ code, message })`, y el cliente muestra `message`. Los inesperados se registran en el log y el cliente muestra un mensaje genérico.

### 11.3 Reactividad y tamaño

- La lista de tarjetas se vuelve a calcular cuando cambia una tarjeta (unos 0,5 KB por pieza). El detalle se recalcula solo cuando cambia la pieza seleccionada.
- No se pasan listas del cliente al servidor: el servidor ya sabe qué piezas forman la importación vigente.
- Si en el futuro hay campañas de más de 300 piezas, la lista se pagina con `usePaginatedQuery` y se aplica `content-visibility: auto` en las tarjetas.

### 11.4 Frontend

- `CampaignEditor` es el contenedor que usa `useCampaignEditor` (campaña y tarjetas) y `usePieceSelection`, sincronizado con la URL (`?pieza=…&v=…&hilo=…`).
- `PiecePanel`, `ReviewCanvas` y `CommentsPanel` usan `usePieceDetail(pieceId, version)`. Convex comparte una sola suscripción entre todos.
- `useThreads` agrega **actualizaciones optimistas** (`withOptimisticUpdate`) a crear, responder y resolver, para que comentar sea inmediato.
- Los textos de la UI salen de `app/lib/qa-visual/labels.ts`, que convierte los códigos del servidor en textos en español. Los mensajes de los avisos ya llegan interpolados desde el servidor.
- `useReviewSession` desaparece. Lo reemplazan hooks pequeños: selección, transformación del visor, herramienta de anotación, hilos, decisión y corrida.
- Se eliminan `analysis-feed.ts`, la parte de `piece-inventory.ts` que interpreta nombres de archivo y `source.ts`.

---

## 12 Colaboración humana

### 12.1 Comentarios y respuestas

- **Crear un comentario sobre la imagen:** con la herramienta de punto se elige un lugar y se abre el popover. `threads.create({ pieceVersionId, anchor: { kind: "point", x, y }, body })`.
- **Rectángulo o dibujo libre:** al terminar el trazo se abre el mismo popover, con `anchor: rect | path`. Las anotaciones dejan de ser estado local: son el ancla de un hilo.
- **Comentario general:** desde el compositor del panel derecho, con `anchor: general`.
- **Responder:** `threads.reply({ threadId, body })`. Para un hallazgo de IA, `threads.reply({ finding: { reviewId, ruleId }, body })` crea el hilo en ese momento.
- **Editar o borrar:** solo el autor puede hacerlo. Borrar es lógico y el texto se reemplaza por "Comentario eliminado".

### 12.2 Resolución

- `resolve` y `reopen` operan sobre el hilo y guardan quién y cuándo.
- Resolver **no cambia el dictamen de IA ni la decisión humana** (regla 16). La tarjeta muestra, por ejemplo, "2 hallazgos · 1 abierto".

### 12.3 Decisión humana

| Estado visible | Cómo se obtiene |
| --- | --- |
| Pendiente | Sin decisión y sin actividad humana. |
| En revisión | **Se deriva**: hay hilos humanos o respuestas en esta versión y todavía no hay decisión. No es un botón ni muestra un spinner. |
| Cambios solicitados | `decide({ decision: "changesRequested", note })`. Exige siempre un comentario explícito y no vacío que explique qué debe corregirse, aunque ya existan hilos abiertos. La decisión y un hilo interno con ese comentario se guardan en la misma operación para la pieza y versión seleccionadas; el texto queda visible en Comentarios y en el historial. |
| Aprobada | `decide({ decision: "approved" })` cuando la IA está en `validated` y vigente. |
| Aprobada con excepción | `decide({ decision: "approved", exception: { reason, note } })` cuando la IA tiene hallazgos, una revisión incompleta, un error, está desactualizada o no existe. `reason` es uno de: `acceptedFinding` (hallazgo aceptado por el cliente), `falsePositive` (la IA se equivocó), `notApplicable` (el requisito no aplica) u `other`. La nota es obligatoria. |

- **Concurrencia:** `decide` recibe `expectedCurrentDecisionId`. Si otra persona decidió antes, devuelve `ConvexError({ code: "decision_conflict" })` y la UI muestra la decisión nueva antes de permitir otra.
- **Revocar:** agrega un registro `revoked`. La versión vuelve a Pendiente o a En revisión.
- **Auditoría:** cada decisión guarda `aiSeen` (revisión, dictamen, `inputHash` y si estaba desactualizada) para saber qué tenía delante quien decidió.
- **Versión nueva:** empieza en Pendiente. Los hilos abiertos de la versión anterior se muestran en una sección colapsable, "Pendientes de v1 para verificar en v2".

### 12.4 Permisos

Por ahora, todas las acciones internas requieren `super_admin` interno. El acceso del cliente se define en §23.6. Todo pasa por `requireCampaign(ctx, campaignId, action)`, de modo que cuando se amplíe el acceso se agrega una tabla `qaVisualCampaignMembers { campaignId, userId, role: viewer | reviewer | approver | admin }` sin tocar cada función (§22).

### 12.5 Versiones

La pestaña Versiones lista `qaVisualPieceVersions` (v1, v2…) con fecha, nombre de archivo, dictamen de IA y decisión de cada una. Desde ahí se puede comparar una versión con otra: lado a lado o con un deslizador superpuesto.

### 12.6 Historial

Se deriva sin una tabla de eventos. Combina, ordenados por fecha:

- Versiones detectadas.
- Corridas en las que entró la pieza, con su resultado o error.
- Decisiones.
- Hilos creados y resueltos.
- Avisos de importación nuevos o resueltos (comparando el `requirementsHash` entre importaciones).

---

## 13 Imágenes y medios

### 13.1 Preparación

- La publicación de una importación encola en `qaVisualImagePool` cada versión con `image.status = pending`. La tarea es idempotente: si la imagen ya está `ready`, no hace nada.
- `imageJob` descarga el original, lo verifica, genera la miniatura (WebP de 192 px) y la imagen de análisis (JPEG de 1800 px, o 1400 px si pesa más de 700 KB), convierte a sRGB y corrige la orientación. Con la revisión del cliente se agrega una vista previa en WebP de 640 px para la galería (§23.9). Al terminar guarda los blobs con `images.save`, que borra lo subido si la versión ya tenía imágenes.
- Si dos versiones de piezas distintas tienen el mismo `contentHash`, comparten las imágenes.
- `analyzeJob` reutiliza el mismo helper si la imagen todavía no está lista. Nunca hay espera activa.

### 13.2 Original

El original no se copia. Se sirve en streaming desde Drive solo para "Descargar original", con `Content-Disposition: attachment`.

### 13.3 Entrega al navegador

- La ruta `GET /workspace/qa-visual/media?campaign=…&version=…&variant=thumb|analysis|original` sigue en Next porque el token de sesión está en una cookie. Se habilita con `QA_VISUAL_ENABLED` y no con `NODE_ENV`.
- La URL incluye `pieceVersionId`, que es inmutable. Por eso las variantes `thumb` y `analysis` responden con `Cache-Control: private, max-age=31536000, immutable` y un `ETag` igual al hash. La segunda visita no descarga nada.
- `original` responde con `private, no-store`.
- La autorización se valida en la `httpAction`: la versión tiene que pertenecer a una campaña activa a la que el usuario tenga acceso.
- **Mejora opcional:** firmar el JWT de Drive con WebCrypto (`crypto.subtle`), que está disponible en el runtime por defecto de Convex. Así la `httpAction` puede hacer el streaming del original sin pasar por una acción de Node.

---

## 14 Seguridad y paso a producción

- **Bandera:** `QA_VISUAL_ENABLED=true` en Next y en Convex. Sin ella, las rutas responden 404 y las funciones públicas lanzan un error de acceso.
- **Roles:** se mantiene `super_admin` interno y se excluye el rol externo, como ahora.
- **Credenciales:** `QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON`, con una cuenta de servicio distinta por entorno (Dev y Prod). Solo `client_email` se expone a la UI, para que se pueda compartir la carpeta.
- **Drive:** alcance `drive.readonly`. Una prueba unitaria verifica que `model/drive.ts` solo construye solicitudes `GET` (y el `POST` del token).
- **Entradas:** límites de tamaño y de píxeles, XML sin `DOCTYPE`, control del tamaño descomprimido del ZIP y rutas del ZIP restringidas a `xl/`.
- **Prompts:** los datos del Excel van dentro de JSON y se tratan como datos. El sistema ignora instrucciones que aparezcan dentro de la imagen o de las celdas.
- **Costos:** un límite de piezas por corrida (`QA_VISUAL_MAX_RUN_PIECES`, por defecto 1000) y una alerta cuando el costo estimado de una corrida supera un umbral (§15).
- **Configuración heredada:** se elimina `QA_VISUAL_GOOGLE_FOLDER_ID` + `QA_VISUAL_RULES_JSON`. Las referencias confirmadas pasan a `qaVisualLinkOverrides`, o a un tipo `expectedValue` si se necesitan valores por pieza.

---

## 15 Observabilidad, métricas y costos

| Métrica | Fuente |
| --- | --- |
| Tiempo de importación por etapa | `qaVisualImports.stage`, con la marca de tiempo de cada transición en el log. |
| Tiempo hasta el primer resultado y duración de la corrida | `qaVisualRuns.firstResultAt` y `finishedAt`. |
| Espera en cola, tiempo de preparación y tiempo del modelo por pieza | `attempts[].queuedMs` y `elapsedMs`, más la duración de `phase`. |
| Tokens y costo estimado | `attempts[].inputTokens` y `outputTokens` × la tarifa configurada en `model/llm.ts`. |
| Cobertura | `result.coverage` agregado por corrida. |
| Calidad de vinculación | Cantidad de piezas por nivel (`exact`, `connectors`, `contained`, `alias`, `manual`), ambiguas y sin vincular. |
| Tasa de localización | `locationStatus` agregado. |
| Discrepancias entre el código y el modelo | Precio y fecha cuyo `outcome` difiere entre ambos. |
| Fallos por código | `error.code` y `attempts[].code`. |

Los logs se emiten como una línea JSON con `{ area: "qa-visual", event, campaignId, runId, reviewId, ms, code }`, para filtrarlos en los log streams de Convex.

**Alertas:**

- Más del 10 % de piezas fallidas en una corrida.
- Ráfagas de errores `http_429`.
- Una corrida de más de 30 minutos.
- Una importación fallida dos veces seguidas.

---

## 16 Pruebas y evaluación

| Nivel | Herramienta | Qué cubre |
| --- | --- | --- |
| Unitarias del dominio | `node --test` con `tsx`, que ya se usa en `tests/` | `workbook` (celdas combinadas, fechas, fórmulas, límites), `productionCsv` (BOM, `;`, duplicados), `linking` (todos los niveles, ambigüedad, pieza 16), `offers` (las pruebas actuales de precios), `requirements` (estados), `verdict` (todas las combinaciones), `hashing` (estabilidad del `inputHash`), `retryPolicy` (tabla completa), `drive` (solo GET). |
| Funciones de Convex | `convex-test`, que hay que agregar como dependencia de desarrollo | Importación por lotes y publicación atómica. `fillSlots` respeta el máximo de 4 por corrida. Idempotencia de `onAttemptComplete`. Cancelación. Agregar una pieza a una corrida activa. Conflicto de decisiones. Permisos en cada función pública. |
| UI | Pruebas de componentes y una prueba de extremo a extremo de los flujos principales | Navegación con flechas (sin interferir con campos de texto). Clic en un marcador que abre el comentario, quita filtros y lo realza. Popover sobre la imagen. Decisión con excepción. Temas claro y oscuro. |
| Evaluación con piezas reales | Script `qaVisual/eval:run` (acción interna) | Las 61 piezas de Semana de Locura, etiquetadas por una persona con el resultado esperado por control y la caja de cada elemento. Mide la precisión y la exhaustividad de los hallazgos, la tasa de `unverifiable` y el IoU de las cajas. Se ejecuta antes de cambiar el prompt, el modelo o `ANALYSIS_POLICY_VERSION`. |

---

## 17 Migración desde las tablas actuales

QA Visual solo funciona en Dev (`NODE_ENV === "development"`), así que no hay datos de producción que preservar. El plan prioriza la simplicidad:

1. Se agregan las tablas nuevas al esquema junto a las actuales.
2. Se implementan importación, piezas y versiones nuevas. Para cada campaña activa se lanza `imports.request({ trigger: "reprocess" })`, que lee Drive y crea la identidad nueva.
3. Los resultados de IA anteriores no se migran: se generaron con la vinculación defectuosa y con `contextKey` incompatibles. Si se quieren conservar como referencia, se exportan antes con `npx convex export`.
4. Se cambia el frontend a las consultas nuevas.
5. Se vacían las tablas viejas con una mutación interna por lotes, que borra también sus blobs de Storage (`qaVisualImageCopies`, `qaVisualAssetVersions` y originales sin referencia). Recién entonces se quitan del esquema.
6. Se eliminan los archivos `pipeline.ts`, `runDispatch.ts`, `stageDriveRun.ts`, `imageWarmup.ts`, `prepareImages.ts`, `imageCopies.ts`, `campaignSnapshots.ts`, `campaignSync.ts`, `documents.ts` (y sus utilidades de limpieza de pruebas), `driveAnalysis.ts`, `analysisInput.node.ts`, `clientMatrix.node.ts` (su lógica pasa a `model/`), `app/lib/qa-visual/production-csv.ts`, `source.ts`, `analysis-feed.ts` y `use-review-decisions.ts`.
7. Los workflows de QA que queden en el componente compartido no se borran a mano: terminan solos o se dejan vencer. El resto de la aplicación no se toca.

---

## 18 Plan por etapas

Cada etapa se puede publicar por separado y deja el sistema funcionando.

| Etapa | Contenido | Criterios de aceptación |
| --- | --- | --- |
| **1. Dominio puro y vinculación** | `model/`: `normalize`, `offers` (código actual), `linking` por niveles, `requirements` con estado, `issues`, `verdict` con cobertura, `hashing` por pieza, `workbook` (celdas combinadas y fechas) y `productionCsv` (BOM, `;`, duplicados). Pruebas de §8.8. | Las pruebas pasan. La pieza 16 vincula con la oferta 7 y emite un aviso. Agregar una imagen no cambia el `inputHash` de otra. |
| **2. Datos e importación** | Tablas nuevas, `importPool`, importación por lotes, publicación atómica, identidad de pieza y versión, selección de fuentes, reprocesamiento desde Storage, alta en dos pasos y todos los casos de §7.6. | Importar Semana de Locura da 61 piezas. Repetir sin cambios no escribe nada. Reemplazar una imagen crea v2 solo en esa pieza. Una carpeta incompleta muestra la lista de verificación correcta. |
| **3. Imágenes y medios** | `imagePool`, imágenes por versión y caché `immutable`. | Al volver a entrar, ninguna imagen se descarga de nuevo (verificado en la pestaña Network). Una imagen de 25 MB falla solo en su pieza. |
| **4. Análisis y orquestación** | `analysisPool`, máquina de estados, `retryPolicy`, el modelo lee y el código compara, localización sin bloqueo, evidencia cruda, cancelación, pieza al frente de la cola, cron de vigilancia y configuración LLM propia. | Hay como máximo 4 piezas por corrida y se respeta el límite global configurable, cuyo valor se documenta y valida con carga concurrente según §10.1. Matar una acción no deja piezas colgadas. Un fallo de localización conserva la conclusión. La pieza 16 pasa por Gemini. |
| **5. UI sobre los datos nuevos** | Hooks nuevos, tarjetas con proyección, detalle con requisitos y cadena de origen, avisos agrupados, progreso con desglose, menú de **Analizar piezas**, banner de importación, campañas con estado, enlace profundo. | Se cumplen los casos de §21 relacionados con la UI. El diseño en ambos temas coincide con el aprobado. |
| **6. Colaboración guardada** | Hilos, comentarios, anclas, resolución, decisiones con excepción y control de concurrencia, versiones e historial. | Al recargar, todo sigue ahí. Dos personas que deciden a la vez reciben el aviso de conflicto. Una versión nueva empieza en Pendiente. |
| **7. Evaluación y producción** | Dataset de evaluación, métricas, alertas, bandera de producción, credenciales por entorno y migración final (§17). | Se alcanzan las metas acordadas de precisión e IoU. La lista de verificación de §14 está completa. |

Las etapas de la revisión del cliente, la galería, el carrusel y la voz siguen en §23.15.

La **etapa 1** y una versión mínima de la 2 (solo la nueva vinculación sobre las tablas actuales) pueden adelantarse para resolver la pieza 16 cuanto antes, si se prioriza desbloquear la revisión de esa campaña. El costo es reescribir después la parte de escritura de la importación.

---

## 19 Propuesta de diseño

El archivo [`DISENO_QA_VISUAL.html`](./DISENO_QA_VISUAL.html) muestra las propuestas con los tokens de `review.css`, en tema claro y oscuro. Mantiene el header y las tabs de la app, el header compacto de campaña y la estructura de tres paneles aprobada. Estos son los cambios. Las escenas 1 a 5 cubren el editor interno. Las escenas 6 a 11 cubren la galería y el carrusel internos, el envío al cliente y el portal del cliente en web y en celulares (§23).

### 19.1 Página de campañas

- Cada tarjeta muestra el **estado de la importación** (Importando · etapa / Lista / Requiere acción / Error) y un **resumen** con piezas, validadas, con hallazgos y aprobadas, más una barra fina de la corrida si hay una en curso.
- Las tarjetas con error o que requieren acción muestran su botón (Reintentar o Elegir matriz) en la misma tarjeta.
- Un filtro simple: Activas / Archivadas.

### 19.2 Alta de campaña en dos pasos

- **Paso 1:** se pega la URL. Debajo se muestra el correo de la cuenta de servicio con un botón para copiarlo.
- **Paso 2:** lista de verificación con RECURSOS (1 Excel ✓), EDITABLES (1 CSV ✓), DESPLIEGUE (61 imágenes ✓) y archivos ignorados. Si hay varios candidatos, se elige ahí mismo. **Agregar campaña** se habilita solo cuando la lista está completa.

### 19.3 Editor

- **Analizar piezas** es un botón dividido. La acción principal analiza las pendientes, desactualizadas y fallidas (muestra la cantidad). El menú ofrece "Reanalizar todas (61)" y "Reintentar fallidas (3)". Si todo está vigente, el menú lo dice.
- **Barra de progreso segmentada:** verde para validadas, ámbar para hallazgos, ámbar claro para incompletas y rojo para errores. Muestra el texto "38 de 61 · 62 %", "4 en curso" y un botón **Detener**. Al terminar dice "Análisis finalizado · 40 validadas · 12 con hallazgos · 6 incompletas · 3 con error".
- **Banner de importación** (debajo del header, colapsable): "Importando desde Drive · Vinculando pedido…", "No se pudo actualizar: se perdió el acceso · Se muestran los datos del 11/11 14:20 · Reintentar" o "Hay una nueva versión de interpretación · Reprocesar".
- **Tarjeta de pieza:** se mantienen la miniatura, el nombre y el formato, más los dos estados (IA y humano). Se agrega un indicador pequeño de **aviso de fuente** (ícono de documento con un número), separado de los comentarios. Si la pieza está desactualizada, un punto muestra el motivo al pasar el mouse.
- **Filtros de la lista:** IA (Validada, Con hallazgos, Incompleta, Error, Sin analizar, Desactualizada), Humana (Pendiente, En revisión, Cambios, Aprobada) y "Con avisos de fuente".
- **Centro:** el bloque de estado de IA abre un menú pequeño con "Volver a analizar esta versión" y "Ver intentos". Así se resuelve el análisis individual sin la barra aparte que se descartó. La cobertura (por ejemplo, "5/6 controles") aparece junto al dictamen.
- **Comentarios:** tres tipos de tarjeta, bien diferenciados:
  1. **Hallazgo de IA:** avatar de robot, severidad, filas "Pedido" y "Visible" alineadas, fuente en un chip, marcador numerado.
  2. **Aviso de fuente:** ícono de documento con fondo neutro azulado, "Afecta: producto · precio · vigencia", acción sugerida ("Confirmar equivalencia"). Sin marcador.
  3. **Humano:** avatar con iniciales y respuestas anidadas.
- **Detalles:** cada control es una tarjeta de requisito con:
  - Encabezado: control y resultado (Cumple / No cumple / No verificable / No aplica / Sin evaluar).
  - **Cadena de origen**: Cliente (Excel `K6 · n.º 7`) → Producción (CSV, línea 17) → Imagen (texto leído).
  - Chips de **método** (Código / IA) y de **base** (Cliente / Producción).
  - En caso de conflicto, las dos fuentes lado a lado.
  - Arriba, un resumen de cobertura: "5 de 6 controles verificados · 1 no aplica".
- **Aprobación con excepción:** un diálogo con el motivo (cuatro opciones) y una nota obligatoria. Muestra qué dictamen de IA está viendo la persona y si está desactualizado.

### 19.4 Detalles visuales

- El verde (`--success`) se usa solo para "Validada por IA" y "Aprobada". Ningún otro estado lo usa.
- Las advertencias usan `--warning`. Los errores técnicos usan `--danger` con un ícono de alerta. "Cambios solicitados" usa `--danger` con un ícono de flecha de retorno, para diferenciarlo de un error técnico.
- Los avisos de fuente usan un tono neutro azulado (`--primary-soft`) para no confundirse con hallazgos.
- El estado humano nunca muestra spinner. El de IA usa el loader solo en `running`.
- Se respeta `prefers-reduced-motion` en el realce y en la barra.
- El contraste mínimo es AA en ambos temas. Los marcadores llevan un borde blanco y una sombra para leerse sobre cualquier imagen.

---

## 20 Catálogo consolidado de errores y reintentos

| Ámbito | Código | Reintento automático | Acción en la UI |
| --- | --- | --- | --- |
| Alta | `invalid_url`, `not_a_folder`, `no_access`, `trashed`, `missing_subfolder`, `duplicate_subfolder`, `already_registered`, `archived` | No | Mensaje en el diálogo y lista de verificación. |
| Importación | `drive_unavailable`, `file_changed` | Sí (3) | Reintentar. |
| Importación | `access_lost` | No | Instrucción para volver a compartir y Reintentar. |
| Importación | `needs_source` | No | Elegir la matriz o el CSV. |
| Importación | `workbook_unreadable`, `template_unrecognized`, `file_too_large`, `csv_missing_columns`, `too_many_pieces` | No | Mensaje con el detalle. Se conserva la importación anterior. |
| Importación | `stalled` (vigilancia) | No | Reintentar. |
| Imagen | `image_too_large`, `image_unreadable`, `image_changed` | Sí (3) para `image_changed` | Estado en la tarjeta. Se resuelve al actualizar desde Drive. |
| Análisis | `timeout`, `http_5xx`, `http_429`, `invalid_output`, `safety_blocked`, `network` | Según §10.3 | Al final: Reintentar fallidas o Volver a analizar esta versión. |
| Análisis | `image_unavailable`, `http_400` | No | Mensaje en la pieza. |
| Análisis | `lost_work` (vigilancia) | No | Reintentar fallidas. |
| Decisión | `decision_conflict` | No | Mostrar la decisión nueva y permitir decidir otra vez. |
| Hilos | `not_author`, `thread_not_found` | No | Mensaje breve. |

---

## 21 Correspondencia con los criterios de aceptación de la especificación

| Caso (§21 de la especificación) | Cómo lo resuelve esta arquitectura |
| --- | --- |
| Agregar una URL válida y compartida | Alta en dos pasos (§7.1) e importación encolada en la misma transacción. |
| URL inválida o carpeta sin permisos | `inspectFolder` falla sin escribir (§7.6). |
| Misma carpeta registrada dos veces | `by_drive_folder` y control dentro de la mutación. |
| Dos campañas con archivos de igual nombre | Todo se asocia a `campaignId` y `pieceId`, nunca a un nombre global. |
| Recargar el editor o abrir Detalles | Se lee `qaVisualImportPieces`; no se vuelve a interpretar nada. |
| Actualizar sin cambios | El `fingerprint` coincide y no se escribe nada. |
| Actualizar con fuentes nuevas | Importación nueva y motivo de desactualización por pieza (§6). |
| Cambiar el algoritmo de extracción | `PARSER_VERSION` en el `fingerprint` y reprocesamiento automático desde Storage (§7.7). |
| Originales pesados | Miniatura WebP e imagen de análisis con caché `immutable` (§13). |
| Analizar campaña | Máximo 4 piezas por corrida y concurrencia global configurable según §10.1. Los resultados aparecen a medida que termina cada pieza (§10). |
| Falla una pieza o un proveedor | `retryPolicy` y resultados parciales conservados. |
| Reintentar una pieza | Corrida `piece` o ítem al frente de la cola. La revisión anterior se conserva. |
| El cliente no exige CTA | `notRequested` → `notApplicable`. No afecta la cobertura. |
| El cliente exige CTA de descarga y aparece un cierre genérico | El modelo juzga el CTA con el criterio de P16 y marca la caja de `A DOMICILIO POR KFC APP`. |
| Story con oferta en una fila que debería estar vacía | Se analiza y aparece el aviso `stories_offer_filled`. |
| `FESTIN LOCURA` frente a `FESTIN DE LOCURA` | Nivel `connectors` y aviso `offer_name_equivalence` (§8.7). |
| Precio 1 vacío y precio 2 con $5,99 | Algoritmo por numeral conservado y prueba de regresión. |
| Dos precios con el mismo numeral | `price_duplicate_ordinal` y estado `invalid`. |
| Precio diferente entre Excel y CSV | Estado `conflict` con las dos fuentes. El código compara contra ambas. |
| Un fallo de vinculación afecta a tres controles | Un solo aviso con `affects[]` y ningún texto repetido. |
| Hallazgo sobre una región visible | `box_2d` sobre la imagen de análisis y evaluación de IoU. |
| Aviso solo documental | Comentario general sin marcador. |
| Clic en un marcador | Se mantiene el comportamiento actual (`selectComment` con realce). |
| Flechas de teclado | Se mantiene `use-piece-keyboard-navigation`. |
| Aprobación humana | `qaVisualDecisions` por versión, con autor, motivo y sin spinner. |
| Recargar tras comentar o aprobar | Hilos y decisiones guardados (§12). |
| Nueva versión de una pieza | `qaVisualPieceVersions`. No hereda la decisión y conserva el historial. |
| La corrida llega al 100 % | Barra segmentada y resumen por dictamen. |
| Tema claro y oscuro | Tokens de `review.css`. La propuesta se ve en los dos temas en el HTML. |

---

## 22 Decisiones abiertas

Cada punto incluye la opción recomendada, que se puede aplicar mientras el equipo no decida otra cosa.

| # | Pregunta | Recomendación |
| --- | --- | --- |
| 1 | ¿Qué equivalencias se aceptan automáticamente? | Los niveles `exact` y `connectors` se aceptan automáticamente, con un aviso informativo. `contained` se acepta con una advertencia. Lo fuzzy requiere confirmación humana. |
| 2 | Si no se puede vincular el pedido del cliente, ¿se compara contra el CSV? | Sí, con `basis: production` visible y sin poder llegar a "Validada por IA". Así se cumple "analizar siempre" sin ocultar la falta del pedido. |
| 3 | ¿`JUEVES 22` equivale a `22 de octubre`? ¿Y `HOY` a una fecha? | **Resuelta el 13/11/2026 (§9.2.1):** no se completa el mes desde el calendario de la campaña. Si se exige día y mes, `JUEVES 22` tiene un hallazgo por omitir el mes. `HOY` y una fecha concreta no son equivalentes. Sí se aceptan formatos que conservan toda la información solicitada, como `22/10`. |
| 4 | Cobertura mínima para "Validada por IA" | Todos los controles solicitados ejecutados y cumplidos, con base en el cliente. |
| 5 | ¿Quién puede aprobar con excepción? | Por ahora, `super_admin`. Más adelante, el rol `approver`. |
| 6 | Subcarpetas dentro de DESPLIEGUE | En v1 se informan sin analizarse. Si el equipo organiza por formato, se pueden recorrer hasta dos niveles con `path` en la pieza. |
| 7 | ¿Se admite Google Sheets como matriz? | Sí, mediante la exportación a XLSX de Drive, que es de solo lectura. Es poco esfuerzo y evita un error común. |
| 8 | Carruseles | Agrupar los slides por prefijo de nombre como una pieza con varias imágenes. Requiere ejemplos reales. Queda fuera de v1. |
| 9 | Retención | Conservar todas las importaciones referenciadas por corridas. Purgar las importaciones `failed` y `superseded` sin referencias después de 90 días. Las imágenes viven mientras exista su versión. |
| 10 | ¿Sincronización automática con Drive? | Manual en v1. Más adelante, un cron diario que solo lista y compara el `fingerprint`, sin descargar si nada cambió. |
| 11 | Valor del límite global de análisis y presupuesto | La política ya está decidida (§10.1): concurrencia global configurable según cuotas y capacidad medidas, sin fijar ocho como requisito. Queda por determinar y validar el valor operativo en la etapa 4. Se mantiene la alerta de costo por corrida. |
| 12 | ¿Revisar la importación antes de analizar? | No como paso obligatorio. La pestaña Resumen ya muestra los avisos de campaña y las piezas bloqueadas antes de presionar **Analizar piezas**. |

---

## 23 Revisión del cliente: la tercera aprobación

Esta sección extiende la arquitectura anterior sin reemplazarla. Agrega la revisión **del cliente**, que es la que define si una pieza está aprobada. También agrega la vista de **galería y carrusel** para el equipo interno y para el cliente, y los **comentarios de voz**. El diseño está en [`DISENO_QA_VISUAL.html`](./DISENO_QA_VISUAL.html), escenas 6 a 11.

### 23.1 Principios

| Principio | Consecuencia |
| --- | --- |
| Tres revisiones independientes | **IA** (asistente) → **interna** (control de calidad de la agencia) → **cliente** (definitoria). Cada una tiene sus propios estados y registros. Ninguna sobrescribe a otra. |
| El cliente solo ve lo que se le envió | El cliente accede a versiones publicadas explícitamente en una **ronda de entrega**. Nunca ve el editor interno, los resultados de IA, los avisos de fuente, las celdas del Excel, el CSV, los comentarios internos ni los nombres técnicos de archivo. |
| Todo lo del cliente se ve internamente | Cada comentario, audio, transcripción, visita y decisión del cliente aparece en el editor interno, en tiempo real. |
| Versiones hasta aprobar | Si el cliente pide cambios, la siguiente entrega de esa pieza es una **versión nueva del cliente** (V2, V3…). Las anteriores quedan visibles en modo lectura con sus comentarios. El ciclo termina cuando el cliente aprueba cada pieza. |
| Una sola interfaz adaptable | El portal del cliente reutiliza los componentes del editor (visor, marcadores, compositor, galería y carrusel) con una propiedad `audience: "internal" \| "client"` y un diseño responsive. No es otra aplicación, y queda lista para convertirse en PWA. |
| Frontera de datos en el backend | Ocultar cosas en la UI no alcanza. El cliente consume un módulo de Convex propio que solo lee tablas y campos permitidos, con validadores de retorno explícitos. |

### 23.2 Conceptos nuevos

| Concepto | Significado |
| --- | --- |
| Ronda de entrega | Conjunto de versiones de piezas que la agencia publica juntas para el cliente: Ronda 1, Ronda 2… |
| Ítem entregado | Una versión concreta de una pieza dentro de una ronda. Es lo que el cliente revisa y aprueba. |
| Versión del cliente | Numeración que ve el cliente (V1, V2…). Es independiente de la interna: si internamente hubo v1, v2 y v3 y solo se enviaron v1 y v3, el cliente ve V1 y V2. |
| Ficha del pedido | Resumen para el cliente de lo que pidió (producto, precio, vigencia, formato y medidas, canal, CTA). Se **congela** al publicar, para que el cliente siempre vea con qué se comparó esa versión. |
| Hilo del cliente | Conversación visible para el cliente, iniciada por él o por la agencia. |
| Nota interna | Comentario de la agencia **dentro** de un hilo del cliente que el cliente no ve. |
| Decisión del cliente | `approved` o `changesRequested` sobre un ítem entregado. |

### 23.3 Flujo completo

1. **Habilitar la revisión del cliente en la campaña:**
   - Un `super_admin` asocia la campaña a un cliente de `corClients`, y opcionalmente a una marca de `clientBrands`.
   - Activa la revisión del cliente.
   - Opcionalmente define quiénes pueden aprobar. Si no define a nadie, aprueba cualquier usuario externo asignado.
   - Para el acceso se reutilizan `approvedExternalUsers`, el login por OTP y `clientUserAssignments`, que ya existen en la app.
2. **Preparar la entrega:**
   - Son elegibles las piezas cuya versión actual tiene **decisión interna `approved`** (con o sin excepción), que no están `excluded` ni `removed` y cuya versión todavía no se envió.
   - En el editor, **Enviar al cliente** abre un diálogo con:
     - Las piezas elegibles, preseleccionadas.
     - Las no elegibles, con su motivo: "sin aprobación interna", "análisis desactualizado", "duplicado sin resolver", etc.
     - Una vista previa de la ficha que verá el cliente.
     - Un mensaje opcional.
3. **Publicar:** `deliveries.publish` crea la ronda y sus ítems en **una sola transacción**. Para cada pieza:
   - Asigna el siguiente número de versión del cliente.
   - Congela la ficha.
   - Marca como `superseded` el ítem anterior de esa pieza.
   - Pone el estado del cliente en `sent`.
   - Encola la notificación.
4. **El cliente recibe un email** con el enlace al portal (`/workspace/reviews/<campaignId>`) e inicia sesión con OTP.
5. **El cliente revisa** en la galería o en el carrusel:
   - Ve la imagen y la ficha.
   - Comenta sobre un punto de la imagen o en general, por escrito o por voz.
   - Aprueba la pieza o solicita cambios.
6. **La agencia ve todo en vivo:**
   - La tarjeta de la pieza muestra el estado del cliente.
   - Los hilos del cliente aparecen con su propia identidad visual.
   - La agencia puede responder al cliente o dejar una nota interna.
7. **Cambios:**
   - Diseño sube el archivo corregido a Drive.
   - La importación lo detecta como versión nueva (§6.1), la IA la analiza y la revisión interna la aprueba.
   - Se envía en la ronda siguiente.
   - El cliente ve "V2 · Nueva versión", con la lista "Lo que pediste en V1" para verificar cada punto. V1 sigue disponible en modo lectura.
8. **Aprobación final:**
   - Cuando el cliente aprueba, la pieza queda en verde: "Aprobada por el cliente".
   - Si después aparece en Drive otra versión de esa pieza, la tarjeta interna avisa: "Cambió después de la aprobación del cliente".
   - Esa versión nueva no se envía sola. Enviarla reabre la revisión del cliente.
9. **Cierre de la campaña:** cuando todas las piezas activas entregadas están aprobadas por el cliente, la campaña muestra "Aprobación del cliente completa" y ofrece exportar un resumen en CSV o PDF con versión, fecha y aprobador.

### 23.4 Estados de la revisión del cliente

Cada ítem entregado tiene su propio estado del cliente. La tarjeta interna muestra el estado del **último ítem activo** de la pieza.

| Estado | Lo que ve la agencia | Lo que ve el cliente | Tono |
| --- | --- | --- | --- |
| `notSent` (sin ítem) | "Cliente · sin enviar" | No ve la pieza | Neutro |
| `sent` | "Enviada · Ronda 2 · V2" | "Por revisar", con la insignia "Nueva versión" si es V2 o posterior | En curso |
| `viewed` | "Vista por el cliente · 12/11 15:20" | "Por revisar" (el cliente no necesita ver este estado) | En curso |
| `changesRequested` | "El cliente pidió cambios" | "Cambios solicitados · esperando una nueva versión" | Peligro |
| `approved` | "Aprobada por el cliente" | "Aprobada" | Éxito (verde) |

Indicadores adicionales en la tarjeta interna, que no se muestran al cliente:

- "v3 interna lista para enviar": la versión interna aprobada es más nueva que la última versión entregada.
- "Cambió después de la aprobación del cliente": hay una versión interna nueva después de un `approved`.
- "El pedido cambió después del envío": el `requirementsHash` actual difiere del que había al congelar la ficha. Se ofrece **Actualizar ficha**, que la vuelve a congelar sin crear una versión nueva y deja el cambio registrado.

**Reglas:**

- La decisión del cliente se aplica al ítem, es decir, a la versión del cliente. Una versión nueva entregada empieza en `sent`.
- **Solicitar cambios** exige al menos un hilo del cliente abierto en esa versión o un comentario escrito en el mismo diálogo.
- **Aprobar** exige permiso de aprobador. Quien no lo tiene ve "La aprobación la realiza el equipo de [cliente]" y puede comentar.
- El cliente puede cambiar su decisión mientras no exista una versión posterior entregada. Cada cambio queda registrado.
- La agencia **no puede** cambiar una decisión del cliente. Solo puede enviar una versión nueva o retirar un ítem que todavía no tiene decisión.
- **Concurrencia:** `decide` recibe `expectedDecisionId`, como en §12.3. Si dos personas del cliente deciden a la vez, la segunda ve la decisión de la primera antes de confirmar la suya.

Estado de la campaña para el cliente: "12 de 24 aprobadas · 3 con cambios · 9 por revisar".

### 23.5 Modelo de datos

Hay cambios en tablas existentes y cuatro tablas nuevas.

**Cambios en tablas existentes:**

| Tabla | Campos nuevos |
| --- | --- |
| `qaVisualCampaigns` | `client?: { clientId: Id<"corClients">, brandId?: Id<"clientBrands"> }`. `clientReview: { enabled, approverIds?: Id<"users">[] (≤ 20), agencyLabel, showAgencyFirstNames, briefFields: string[], allowOriginalDownload }`. `summary.client: { notSent, pending, changesRequested, approved }`. |
| `qaVisualPieces.card` | `client: { state, clientVersion, deliveryNumber, at, internalAhead, changedAfterApproval }` y `openClientThreads`. |
| `qaVisualThreads` | `audience: "internal" \| "client"`, `deliveryItemId?` (solo en hilos del cliente) y el valor `{ kind: "client" }` en `origin`. Índices nuevos: `by_version_audience [pieceVersionId, audience, status]` y `by_item [deliveryItemId, status]`. |
| `qaVisualComments` | `visibility: "internal" \| "client"`, `authorKind: "internal" \| "client"`, `audio?: { storageId, mimeType, durationMs, bytes }` y `transcript?: { status: "pending" \| "done" \| "failed", text?, language? }`. Índice: `by_thread_visibility [threadId, visibility]`. |
| `qaVisualDecisions` | `party: "internal" \| "client"` y `deliveryItemId?`. Índice: `by_item [deliveryItemId]`. |

Reglas de visibilidad:

- Un hilo `internal` solo tiene comentarios `internal`.
- Un hilo `client` puede tener comentarios `client`, que ven ambas partes, y comentarios `internal`, que son notas internas.
- El cliente **solo** puede crear hilos `client` y comentarios `client`.

**Tablas nuevas:**

`qaVisualDeliveries`

| Campo | Nota |
| --- | --- |
| `campaignId`, `number` | Ronda 1, 2… |
| `status` | `published` \| `withdrawn`. No hace falta un borrador: la selección vive en el diálogo hasta publicar. |
| `message?`, `createdBy`, `publishedAt`, `itemCount`, `requestId` | `requestId` vuelve idempotente la publicación. |

Índices: `by_campaign_number [campaignId, number]` y `by_request [createdBy, requestId]`.

`qaVisualDeliveryItems`

| Campo | Nota |
| --- | --- |
| `deliveryId`, `campaignId`, `pieceId`, `pieceVersionId`, `order` | |
| `clientVersion` | V1, V2… por pieza. |
| `status` | `active` (versión vigente para el cliente) \| `superseded` (versión anterior, en modo lectura) \| `withdrawn`. |
| `brief` | `{ title, format, fields: [{ key, label, value }] (≤ 12), requirementsHash }`, congelado. |
| `image` | `{ width, height }` de la imagen de análisis, para reservar el espacio sin saltos de diseño. |
| `clientState` | `sent` \| `viewed` \| `changesRequested` \| `approved`. |
| `currentDecisionId?`, `firstViewedAt?`, `firstViewedBy?`, `publishedAt` | |

Índices: `by_campaign_status_order [campaignId, status, order]` (galería del cliente), `by_piece [pieceId, clientVersion]`, `by_delivery [deliveryId, order]` y `by_version [pieceVersionId]`.

`qaVisualUploads` registra de quién es cada audio subido, para que nadie pueda adjuntar el `storageId` de otra persona.

| Campo | Nota |
| --- | --- |
| `storageId`, `userId`, `kind: "audio"`, `createdAt`, `usedAt?` | |

Índices: `by_storage [storageId]` y `by_unused [usedAt, createdAt]`, que usa el cron de limpieza.

`qaVisualNotifications`

| Campo | Nota |
| --- | --- |
| `userId`, `campaignId`, `kind` | `deliveryPublished` \| `clientComment` \| `clientDecision` \| `agencyReply`. |
| `refId`, `read`, `createdAt` | |
| `email: { state: "pending" \| "sending" \| "sent" \| "failed" \| "skipped", attempts, nextAttemptAt? }` | Mismo patrón que `commentNotifications`. |

Índices: `by_user_read [userId, read]` y `by_email_state [email.state, email.nextAttemptAt]`.

### 23.6 Frontera de datos: módulo del cliente

El backend del cliente es un módulo separado, de modo que nunca pueda leer datos internos por error:

```text
convex/qaVisual/client/
  access.ts      requireClientCampaign(ctx, campaignId) y requireClientItem(ctx, itemId)
  validators.ts  validadores de retorno (lista explícita de campos permitidos)
  portal.ts      campaigns, gallery, piece, markViewed
  threads.ts     create, reply, edit, remove (solo audience client)
  decisions.ts   decide
  audio.ts       generateUploadUrl
```

**`requireClientCampaign(ctx, campaignId)`** verifica, en este orden:

1. El usuario está autenticado y su perfil es `external`.
2. La campaña está `active` y tiene `clientReview.enabled`.
3. Existe una asignación `clientUserAssignments` para `campaign.client.clientId`, sin marca (acceso a todo el cliente) o con la misma `brandId` de la campaña.

Devuelve `{ user, campaign, canApprove }`. Si algo falla, responde **"no encontrado"** y no "sin permiso", para no revelar que la campaña existe.

**Reglas del módulo:**

- **Solo lee** `qaVisualDeliveryItems`, `qaVisualPieceVersions` (identificadores de imagen y dimensiones), los hilos `client` con sus comentarios `client` y las decisiones `party: "client"`.
- **Nunca lee** `qaVisualReviews`, `qaVisualImportPieces`, `qaVisualSourceFiles`, los hilos `internal` ni los comentarios `internal`.
- Todas sus funciones declaran `returns` con validadores de `client/validators.ts`. Así, aunque alguien agregue un campo por error, Convex rechaza la respuesta.
- **Autores:** los comentarios de la agencia se muestran como `clientReview.agencyLabel` (por ejemplo, "PTO99") y, si está habilitado, con el nombre de pila. Nunca se muestran emails ni roles.
- **Prueba de frontera:** una prueba recorre todas las funciones del módulo con datos que incluyen hallazgos, avisos y notas internas. Verifica que ninguna respuesta contenga las claves `findings`, `issues`, `sources`, `production`, `requirements`, `visibility: "internal"` ni nombres técnicos de archivo.
- **Funciones internas:** las funciones del editor interno siguen exigiendo `super_admin` (§12.4). Un usuario externo que las llame recibe un error de acceso.

**Imágenes y audio para el cliente:**

- Ruta de Next `/workspace/reviews/media?item=<deliveryItemId>&variant=preview|view`. La `httpAction` verifica `requireClientItem` y que el ítem no esté `withdrawn`. Sirve la vista previa en WebP o la imagen de análisis en JPEG, con `private, max-age=31536000, immutable`.
- El original solo se descarga si `allowOriginalDownload` está activo.
- El audio se sirve en `/workspace/reviews/audio?comment=<id>`, verificando la audiencia del hilo y la pertenencia del usuario.

**Límites para el cliente:** 30 comentarios por minuto por usuario, 20 audios por hora, audios de hasta 3 minutos y 10 MB, y texto de hasta 4000 caracteres.

### 23.7 Comentarios y comentarios de voz

- **Anclas:** las mismas que en la herramienta interna (punto, rectángulo y general). Están normalizadas sobre la misma imagen de análisis, así que la agencia ve el marcador del cliente exactamente en el mismo lugar. En celulares, el modo "Comentar en la imagen" convierte un toque en un punto y abre el compositor como hoja inferior.
- **Grabación** (`app/hooks/qa-visual/use-voice-recorder.ts`):
  - Usa `MediaRecorder` con `audio/webm;codecs=opus` o, en Safari e iOS, `audio/mp4`. El formato se elige con `MediaRecorder.isTypeSupported`.
  - Muestra una onda en vivo con `AnalyserNode`, un temporizador, y se detiene sola a los 3:00.
  - Permite escuchar la grabación antes de enviarla, descartarla o volver a grabarla.
  - Si el navegador no tiene `MediaRecorder`, el botón del micrófono no se muestra.
  - Si se niega el permiso, se explica cómo habilitarlo y el texto sigue disponible.
- **Envío:**
  1. `client/audio.generateUploadUrl` controla la autenticación y el límite, y devuelve una URL de subida de Convex.
  2. El navegador sube el blob.
  3. `client/threads.create` o `reply` reciben `{ audio: { storageId, durationMs }, body? }`.
  4. La mutación verifica con `ctx.db.system.get("_storage", storageId)` que el `contentType` empiece con `audio/` y que el tamaño no supere 10 MB. Con `qaVisualUploads` confirma que el archivo lo subió el mismo usuario y no se usó antes, y lo marca como usado.
  5. Si la subida falla, el audio se conserva en memoria y se ofrece "Reintentar". No se pierde.
- **Transcripción:**
  - El comentario se crea con `transcript.status = "pending"` y se encola en un pool pequeño, `qaVisualTranscriptionPool` (paralelismo 2, 3 reintentos).
  - Reutiliza la integración de Azure de `convex/lib/speechToText.ts`. Habría que extraer un helper que reciba bytes en lugar de base64, sin cambiar el comportamiento actual de esa acción.
  - Idioma `es`.
  - El texto se muestra debajo del audio, para ambas partes. Sirve como alternativa accesible y para buscar.
  - Si falla, el audio sigue disponible y se muestra "No se pudo transcribir".
- **Limpieza:** un cron horario borra los audios subidos y no usados con más de una hora.
- **Agencia:** el mismo componente permite responder por voz. Es opcional.

### 23.8 Cambios en el editor interno

- **Tarjeta de pieza:** suma un tercer estado, **Cliente**, junto a IA y Humano, más los indicadores de §23.4.
- **Filtros nuevos:** Cliente · sin enviar / por revisar / cambios / aprobada, y "Lista para enviar".
- **Header:** el botón **Enviar al cliente** aparece solo si la campaña tiene la revisión del cliente habilitada. Muestra la cantidad de piezas listas para enviar.
- **Panel de comentarios:**
  - Filtro **Cliente**.
  - Los hilos del cliente tienen un avatar con las iniciales de la empresa cliente, un borde de color propio y la etiqueta "Visible para el cliente".
  - El compositor de un hilo del cliente tiene un selector **Nota interna / Responder al cliente**. Por defecto está en **Nota interna**, para evitar filtraciones. Al elegir "Responder al cliente", el compositor cambia de color y avisa que el cliente lo va a ver.
- **Hilos internos:** nunca se pueden mover al cliente. Para trasladar algo al cliente, se escribe en un hilo del cliente.
- **Versiones:** muestra la correspondencia "v3 interna → V2 del cliente (Ronda 2)" y la decisión del cliente de cada una.
- **Historial:** suma rondas, visitas del cliente, comentarios del cliente y decisiones del cliente.
- **Resumen** (panel izquierdo): suma "Entregas", con la lista de rondas, la cantidad de piezas, la fecha y quién las envió. Permite retirar un ítem o una ronda completa, solo en los ítems sin decisión.

### 23.9 Galería y carrusel (internos y del cliente)

Son los mismos componentes con dos variantes:

```text
app/components/qa-visual/gallery/   PieceGallery · GalleryCard · GalleryToolbar
app/components/qa-visual/carousel/  PieceCarousel · CarouselStage · CarouselPanel · CarouselSheet
app/components/qa-visual/client/    ClientShell · ClientBrief · ClientDecisionBar · ClientProgress
app/components/qa-visual/comments/  VoiceRecorder · AudioMessage (nuevos)
app/components/qa-visual/deliveries/ SendToClientDialog · DeliveryHistory
app/hooks/qa-visual/                use-carousel.ts · use-swipe.ts · use-voice-recorder.ts · use-client-piece.ts
```

- **Galería:**
  - Grilla responsive (`auto-fill, minmax(220px, 1fr)`), con densidad cómoda o compacta.
  - Cada tarjeta muestra la imagen en proporción real (Post 1:1 y Story 9:16 en la misma fila, alineadas abajo), el título, el formato y los estados.
  - **Variante interna:** los tres estados, un indicador de avisos y una casilla para seleccionar piezas en bloque ("Enviar al cliente").
  - **Variante del cliente:** solo el estado del cliente y la insignia "Nueva versión".
- **Vista previa más grande:** la miniatura de 192 px no alcanza para una grilla en pantallas de alta densidad. El `imageJob` genera una tercera variante: **WebP de 640 px** (`previewId` en `image`). Esto amplía §13.1.
- **Carrusel** (al tocar una pieza de la galería):
  - Se superpone a pantalla completa y usa la imagen de análisis.
  - Precarga la pieza anterior y la siguiente.
  - Se navega con flechas en pantalla, con ← y → del teclado, con deslizamiento en pantallas táctiles y con un contador ("3 de 24"). Esc lo cierra.
  - Respeta el filtro y el orden de la galería.
  - La URL se sincroniza (`?pieza=…&vista=carrusel`), así que un enlace abre directamente esa pieza.
  - **Panel en escritorio, hoja inferior en celulares:**
    - Variante **interna:** tres estados, resumen de IA (hallazgos y cobertura), actividad del cliente, botones **Aprobar esta versión** y **Solicitar cambios**, y el enlace "Abrir en revisión detallada" al editor de tres paneles.
    - Variante **del cliente:** ficha del pedido, selector de versión (V2 actual · V1), comentarios con micrófono, y los botones **Aprobar** y **Solicitar cambios**.
- **Diferencia con el carrusel inferior que se descartó:** la galería y el carrusel son un **modo de vista aparte** (un selector "Revisión / Galería" en el header), sin tira de miniaturas. El editor de tres paneles sigue sin carrusel inferior.
- **Atajos:** ← y → navegan, Esc cierra y C abre el compositor. Ninguno actúa mientras se escribe en un campo, como en `use-piece-keyboard-navigation`. Aprobar nunca tiene atajo de una sola tecla.

### 23.10 Diseño responsive y PWA

| Ancho | Interno | Cliente |
| --- | --- | --- |
| ≥ 1280 px | Editor de tres paneles y galería de 4 a 6 columnas | Galería de 4 a 5 columnas. Carrusel con panel lateral de 380 px. |
| 1024–1279 px | El panel derecho se superpone y se puede plegar | Galería de 3 a 4 columnas. Carrusel con panel lateral de 340 px. |
| 768–1023 px | Galería y carrusel con hoja lateral. El editor de tres paneles se desaconseja. | Galería de 3 columnas. Carrusel con hoja inferior. |
| < 768 px | Galería de 2 columnas y carrusel con hoja inferior (revisión rápida) | Galería de 2 columnas. Carrusel a pantalla completa con hoja inferior en tres alturas: **mínima** (estado y botones), **media** (ficha) y **completa** (comentarios). |

- Los tokens de `review.css` se mueven a `qa-tokens.css` y se comparten. Se usan **container queries** (`@container`) en lugar de componentes duplicados para celulares.
- Áreas táctiles de al menos 44 px, `env(safe-area-inset-*)`, `100dvh` y nada que dependa solo de pasar el mouse. La etiqueta "Comentarios generales", que en escritorio aparece al pasar el mouse, en celulares se muestra en la hoja inferior.
- **Lista para PWA, sin implementarla todavía:**
  - Rutas estables por pieza.
  - Imágenes con URLs inmutables, que se pueden cachear con un service worker cache-first.
  - Sesión por cookie, que funciona en modo `standalone`.
  - Grabación compatible con iOS 16.4+ en modo standalone.
  - Ningún flujo principal depende de `window.open`.
- **Fase PWA futura:** `manifest.webmanifest`, íconos, caché del shell de la app y de las imágenes vistas, Web Push para "Nueva ronda para revisar" y lectura sin conexión de las piezas cacheadas. Los comentarios sin conexión **no** entran en esa fase.

### 23.11 Notificaciones

| Evento | Destinatarios | Canal |
| --- | --- | --- |
| Ronda publicada | Usuarios externos asignados a la campaña | Un email por ronda, con la cantidad de piezas y el enlace. Más un aviso en la app. |
| Comentario del cliente | Equipo interno de la campaña (por ahora, los `super_admin` que sigan la campaña) | Aviso en la app al instante y email en resumen cada 10 minutos. |
| Decisión del cliente | Equipo interno | Aviso en la app y email en resumen. "Cambios solicitados" se marca como prioritario. |
| Respuesta de la agencia al cliente | Autor del hilo del cliente | Email en resumen cada 30 minutos. |

Los envíos usan Workpool con reintentos y siguen el patrón de estados de email de `commentNotifications`.

### 23.12 Casos límite

| Caso | Comportamiento |
| --- | --- |
| El cliente comenta en V1 mientras se publica V2 | El comentario queda en V1, porque los hilos pertenecen a una versión. La agencia lo ve como "Comentario en una versión anterior". V2 muestra "Lo que pediste en V1". |
| Dos personas del cliente deciden a la vez | `expectedDecisionId` detecta el conflicto y la segunda ve la decisión vigente antes de confirmar la suya. |
| La agencia detecta un error después de la aprobación del cliente | No puede revertir la decisión. Sube la corrección, que pasa por IA y revisión interna, y la envía: se reabre la revisión del cliente con V+1. |
| Se revoca la aprobación interna de una versión ya enviada | El ítem sigue visible para el cliente. La agencia ve una alerta y puede retirarlo si todavía no tiene decisión. |
| La pieza se borra de Drive después de enviarla | El cliente la sigue viendo, porque las imágenes están en Convex Storage. La agencia ve que la pieza está `removed`. |
| Duplicados | Solo se pueden enviar piezas que no estén `excluded`. Un duplicado sin resolver no es elegible. |
| El Excel cambia después del envío | La ficha del cliente no cambia sola. La agencia ve "El pedido cambió después del envío" y puede usar **Actualizar ficha**. |
| El cliente no tiene permiso para aprobar | Ve los botones de comentario y el texto "La aprobación la realiza [equipo]". |
| Falla la subida del audio o se corta la conexión | La grabación se conserva en memoria con "Reintentar". El texto escrito no se pierde. |
| El micrófono no está disponible o se niega el permiso | Se oculta el botón o se explica cómo habilitarlo. Se puede seguir comentando por escrito. |
| La campaña se archiva | El portal muestra la campaña en modo lectura con "Revisión cerrada". No se aceptan comentarios ni decisiones. |
| Un usuario externo de otra empresa o de otra marca abre el enlace | "No encontrado". No se revela si la campaña existe. |
| Se intenta responder a un hilo interno desde el portal | `client/threads.reply` valida `audience === "client"` y, si no, responde "No encontrado". |
| Se retira una ronda completa | Los ítems sin decisión pasan a `withdrawn` y el cliente vuelve a ver la versión anterior activa, si la hay. Los ítems con decisión no se pueden retirar. |

### 23.13 Funciones

**Internas** (requieren `super_admin`):

| Función | Uso |
| --- | --- |
| `campaigns.configureClientReview` | Asociar cliente y marca, habilitar la revisión y definir aprobadores, etiqueta y campos de la ficha. |
| `deliveries.preview({ campaignId })` | Piezas elegibles y no elegibles con su motivo, más la ficha propuesta. |
| `deliveries.publish({ campaignId, pieceVersionIds, message?, requestId })` | Publicación idempotente. |
| `deliveries.withdrawItem` y `deliveries.withdrawRound` | Retirar ítems o rondas sin decisión. |
| `deliveries.updateBrief({ itemId })` | Volver a congelar la ficha con el pedido actual. |
| `deliveries.list({ campaignId, paginationOpts })` | Historial de rondas. |
| `threads.reply({ threadId, body?, audio?, visibility })` | Responder en un hilo. `visibility` es obligatorio en los hilos del cliente. |

**Del cliente** (`requireClientCampaign`):

| Función | Uso |
| --- | --- |
| `client/portal.campaigns()` | Campañas con revisión habilitada para el usuario, con su progreso. |
| `client/portal.gallery({ campaignId, filter, paginationOpts })` | Ítems `active`: imagen, título, formato, versión del cliente y estado. |
| `client/portal.piece({ itemId })` | Ficha, versiones anteriores de la pieza, hilos y comentarios del cliente, decisión y `canApprove`. |
| `client/portal.markViewed({ itemId })` | Idempotente. Registra solo la primera vista. |
| `client/threads.create`, `reply`, `edit`, `remove` | Solo sobre comentarios propios del cliente. |
| `client/decisions.decide({ itemId, decision, comment?, expectedDecisionId })` | Aprobar o solicitar cambios. |
| `client/audio.generateUploadUrl()` | URL de subida para un audio. |

### 23.14 Impacto en el resto del documento

| Sección | Cambio |
| --- | --- |
| §3.1 Carpetas | Se agregan `convex/qaVisual/client/`, `deliveries.ts`, `notifications.ts` y `transcriptionJob.ts` (Node), además de `model/clientBrief.ts` y `model/clientState.ts`. En el frontend, `app/workspace/reviews/` (con `layout.tsx` que exige el perfil externo, `page.tsx`, `[campaignId]/page.tsx`, `media/route.ts` y `audio/route.ts`) y los componentes y hooks de §23.9. |
| §3.2 Componentes | Se agrega `qaVisualTranscriptionPool` (paralelismo 2) y un pool de notificaciones (paralelismo 2). |
| §12.3 Decisión humana | Pasa a llamarse "decisión **interna**" (`party: "internal"`). La aprobación interna es un requisito para enviar al cliente, pero no es la aprobación final. |
| §12.4 Permisos | El acceso del cliente se resuelve con `clientUserAssignments`. No hace falta una tabla de miembros nueva para el cliente. |
| §13.1 Imágenes | Se agrega la variante de vista previa en WebP de 640 px. |
| §14 Seguridad | Nueva bandera `QA_VISUAL_CLIENT_REVIEW_ENABLED`, prueba de frontera de datos, límites de uso y control de propiedad de las subidas. |
| §15 Métricas | Tiempo desde el envío hasta la primera vista y hasta la decisión, rondas por pieza, porcentaje aprobado en la primera ronda y motivos de cambio (a partir de las transcripciones y los comentarios). |
| §16 Pruebas | Frontera de datos, permisos de cliente y marca, idempotencia de la publicación, numeración de versiones del cliente, conflicto de decisiones, grabadora (con `MediaRecorder` simulado), carrusel (teclado y deslizamiento) y pruebas visuales en celular. |

### 23.15 Plan por etapas, continuación de §18

| Etapa | Contenido | Criterios de aceptación |
| --- | --- | --- |
| **8. Galería y carrusel internos** | Variante de vista previa de 640 px, `PieceGallery`, `PieceCarousel` interno y selector Revisión / Galería. | Se recorren 61 piezas con ← y → sin esperas visibles. La URL abre la pieza exacta. El editor sigue sin carrusel inferior. |
| **9. Entregas y frontera del cliente** | Configuración de la revisión del cliente, `qaVisualDeliveries` y `qaVisualDeliveryItems`, `deliveries.*`, módulo `client/` con validadores de retorno y su prueba, rutas de medios del cliente y tercer estado en las tarjetas. | Un usuario externo asignado ve solo los ítems enviados. Uno de otra empresa o marca recibe "no encontrado". La prueba de frontera pasa. |
| **10. Portal del cliente** | `ClientShell`, galería y carrusel del cliente, ficha, comentarios con anclas, decisiones, versiones V1/V2 con "Lo que pediste en V1" y diseño para celulares con hoja inferior. | Flujo completo de V1 a cambios, V2 y aprobación en escritorio y en celular. Los comentarios del cliente aparecen al instante en el editor interno. |
| **11. Voz y notificaciones** | Grabadora, subida con propiedad verificada, transcripción, notificaciones en la app y por email, y cron de limpieza. | Un audio de 1 minuto grabado en iOS Safari y en Chrome Android se reproduce y se transcribe. Si se niega el micrófono, se puede seguir con texto. Llega un email por ronda. |
| **12. PWA (futuro)** | Manifest, service worker y Web Push. | Se instala en iOS y Android y abre directamente en el portal. |

### 23.16 Decisiones abiertas de la revisión del cliente

| # | Pregunta | Recomendación |
| --- | --- | --- |
| C1 | ¿Se puede enviar al cliente una pieza aprobada internamente con excepción? | Sí. La excepción es interna y el cliente no la ve. |
| C2 | ¿Qué campos de la ficha ve el cliente? | Producto, precio, vigencia, formato y medidas, canal y texto del CTA, configurables por campaña. Nunca celdas, CSV ni avisos. |
| C3 | ¿Quién aprueba del lado del cliente? | Una lista explícita de aprobadores por campaña. Si está vacía, cualquier usuario asignado. |
| C4 | ¿El cliente ve los nombres de las personas de la agencia? | "PTO99" más el nombre de pila, configurable. |
| C5 | ¿Recordatorios automáticos al cliente? | Opcional: un recordatorio a las 48 horas si quedan piezas por revisar. Por defecto, apagado. |
| C6 | ¿El cliente puede descargar el original? | Desactivado por defecto. Se habilita por campaña. |
| C7 | ¿Se puede usar la IA para verificar que una versión nueva atendió los comentarios del cliente? | Sí, como mejora posterior: un control "Cambios pedidos en V1" que compara las transcripciones y comentarios con la imagen nueva. No reemplaza a la revisión interna. |
| C8 | ¿Cuánto tiempo se conservan los audios? | Mientras exista la campaña. Al archivarla, se aplica la misma retención que al resto (§22, punto 9). |

---

## 24 Estado de implementación en el código

**Revisión: 12 de noviembre de 2026, rama `feat/qa-visual`.** Este inventario refleja el código presente en el directorio de trabajo, incluidos los cambios locales de la etapa 2 todavía sin commit/push. No representa el estado del despliegue. Las pantallas de Campañas y Agregar campaña ya fueron probadas por el usuario; la nueva importación de la etapa 2 todavía requiere publicación y validación en el entorno correspondiente. Se mantiene la indicación de no desplegar por ahora.

Las casillas marcadas identifican funcionalidades implementadas dentro del alcance descrito. Una etapa con avances parciales sigue pendiente hasta completar sus contratos y criterios de aceptación; la existencia de tablas o funciones no equivale a un flujo completo para el usuario.

### 24.1 Funcionalidades completas en el código actual

- [x] **Diseños 1 y 2: Campañas y Agregar campaña, conectados con Convex.** Listado paginado de activas y archivadas, tarjetas con estado y resumen, verificación de carpeta antes de confirmar, selección de fuentes ambiguas, registro y actualización desde Drive. Código: `app/components/qa-visual/campaigns/`, `campaignRegistration.ts` y `campaigns.ts`.
- [x] **Vinculación y requisitos de la etapa 1.** Lectura de Excel con celdas combinadas y fechas, CSV con BOM y separadores, asociación de oferta y precio por numeral, coincidencias exactas y por conectores, ambigüedades explícitas y confirmaciones manuales. Cada requisito conserva estado, base y procedencia; el hash se calcula por pieza. Código: `convex/qaVisual/model/`, `clientMatrix.node.ts`, `analysisInput.node.ts` y `overrides.ts`. La extracción conserva algunos archivos anteriores; su reorganización final sigue pendiente.
- [x] **Dictamen con cobertura y vigencia.** La política `qa-visual-4` exige referencias del cliente, controles solicitados cumplidos y evidencia del modelo para los visuales. Conflictos, advertencias relevantes y controles sin verificar impiden el verde. Un resultado anterior cuyo hash o política cambió aparece desactualizado. Código: `model/verdict.ts`, `worker.ts`, `runs.ts`, `editor.ts` y `decisions.ts`.
- [x] **Datos e importación de la etapa 2, implementados localmente.** Tablas `qaVisualSourceFiles`, `qaVisualImports` y `qaVisualImportPieces`; originales e interpretación guardados en Storage; `qaVisualImportPool` exclusivo, con dos importaciones simultáneas y reintentos. Los lotes de hasta 50 piezas y 650 KB preparan datos privados y piezas/versiones `staged`. La publicación cambia lo visible en una sola transacción. Código: `tables.ts`, `sourceFiles.ts`, `importPool.ts`, `importJob.ts` e `imports.ts`.
- [x] **Reutilización, reprocesamiento y recuperación de importaciones.** La huella permite reutilizar una importación sin duplicar piezas ni versiones. Las confirmaciones reprocesan las fuentes guardadas en Storage. Los lotes toleran reintentos, los trabajadores vencidos quedan invalidados antes de limpiar y una importación fallida conserva la última revisión publicada. Hay un cron de recuperación de importaciones y una operación paginada para actualizar campañas al nuevo parser. Código: `imports.ts`, `importJob.ts`, `sourceFiles.ts` y `convex/crons.ts`.
- [x] **Identidad, versiones y resolución de duplicados.** Se busca primero por ID de Drive; un reemplazo crea una versión y dos archivos simultáneos producen piezas separadas. Renombrar conserva identidad. Desde Detalles se puede marcar la entrega definitiva, fusionar como versiones y revocar la confirmación, conservando decisiones e historial. Una imagen nueva empieza sin aprobación heredada. Código: `model/identity.ts`, `imports.ts`, `overrides.ts` y `app/components/qa-visual/piece/DuplicateResolution.tsx`.
- [x] **Análisis de contenido y localización tolerante a fallos.** El modelo lee precio y vigencia y el código compara; formato y dimensiones se verifican de forma determinista. Los hallazgos conservan la conclusión si falla la localización y se muestran como comentarios generales. Código: `worker.ts`, `model/controls.ts`, `commentLocations.ts` y `commentLocalization.ts`. Esto ya funciona con el ejecutor anterior; no implica que la etapa 4 esté terminada.
- [x] **Persistencia de la revisión humana interna.** Comentarios, respuestas, anclas, resolución/reapertura, decisiones y versiones están guardados en Convex e integrados con el editor. Se controla la autoría, el conflicto entre decisiones y la aprobación con excepción cuando no existe una validación vigente. Código: `threads.ts`, `decisions.ts`, `editor.ts`, `use-piece-review.ts` y `use-review-session.ts`. El historial visible tiene límites de carga; su paginación sigue pendiente.
- [x] **Controles de acceso internos y lectura de Drive.** QA exige un administrador interno, excluye perfiles externos y usa acceso de solo lectura a Drive. Código: `access.ts`, `driveClient.ts` y `app/lib/qa-visual/server/access.ts`. La habilitación general para producción todavía no está implementada.
- [x] **Pruebas automatizadas de estas funcionalidades.** Hay pruebas de dominio, cobertura, precios, localización, colaboración, campañas e importaciones, incluidas publicación atómica, reintentos, duplicados, 1000 piezas y registro del componente Workpool. Código: `tests/qaVisual*.test.ts`; comando: `npm run test:qa-visual`. Las 61 piezas del ensayo de importación son sintéticas: no sustituyen la evaluación con imágenes reales y proveedores reales.

### 24.2 Etapas 3 a 11: implementadas en esta tanda

**Actualización del 12 de noviembre de 2026 (segunda tanda).** Todo lo de esta sección está en el directorio de trabajo, sin commit ni despliegue. Compila con `tsc --noEmit` y la suite `npm run test:qa-visual` pasa (93 pruebas). Las pruebas nuevas son solo dos puntuales: la política de reintentos y el cupo de 4 piezas por corrida en el pool. Falta la validación real en Convex Dev con una carpeta, Gemini y el respaldo.

- [x] **Etapa 3: imágenes.**
  - Nuevo `qaVisualImagePool` (4 en paralelo, 4 intentos con espera exponencial). Cada imagen es un trabajo; `imageWarmup.enqueuePage` encola de a 100 piezas con una mutación que se reprograma.
  - Se eliminó la espera activa: si otra tarea tiene la reserva, la acción falla con `image_busy` y el pool la reintenta.
  - Tercera variante: vista previa WebP de 640 px para galería y portal (las copias anteriores usan la imagen de análisis como respaldo).
  - Las imágenes se sirven con `ETag` y responden 304. El proxy de Next conserva `immutable` y reenvía `If-None-Match`, así la segunda visita no descarga nada.
  - Un error definitivo queda en la copia (`error`) y la pieza muestra el motivo en lugar de "Preparando imagen…". `imageWarmup.retryImage` permite reintentarlo.
  - Código: `imagePool.ts`, `imageWarmup.ts`, `prepareImages.ts`, `imagePreparation.node.ts`, `preview.node.ts`, `imageCopies.ts`, `mediaHttp.ts`, `app/lib/qa-visual/server/media-proxy.ts`.
- [x] **Etapa 4: análisis con Workpool y el límite global de §10.1.**
  - `qaVisualAnalysisPool` con concurrencia global configurable por entorno: `QA_VISUAL_ANALYSIS_CONCURRENCY` (entero de 1 a 100; si no se define, 24). El valor por defecto solo evita esperas mientras se mide. Hay que ajustarlo con las cuotas reales, como pide §10.1. El cupo de 4 piezas por corrida se mantiene.
  - Máquina de estados en `qaVisualReviews` (`runner.ts`): `queued → preparing/analyzing → retrying* → completed | failed | cancelled`. `fillSlots` arranca piezas a medida que se liberan lugares y cada resultado se guarda apenas termina la pieza.
  - `onAttemptComplete` es idempotente: ignora callbacks de un `workId` que ya no es el vigente.
  - `model/retryPolicy.ts` implementa §10.3: 3 intentos con Gemini y 2 con el respaldo, `Retry-After` en 429, errores de entrada fatales y errores de configuración o seguridad que pasan directo al respaldo.
  - La pieza individual entra al frente de la corrida en curso (§10.4). **Detener** cancela lo que está en cola y cancela en el pool lo que está corriendo.
  - Cron `recover qa visual analysis` cada 10 minutos (`runner.sweep`).
  - Modelos exclusivos de QA en `qaModels.ts`: `QA_VISUAL_GEMINI_MODEL` (por defecto `gemini-3.7-flash`) y `QA_VISUAL_OPENAI_MODEL` (por defecto `gpt-6-luna`). La configuración compartida del agente de brief no se tocó.
  - Las corridas iniciadas con el ejecutor anterior (workflow) terminan con su código, que se conserva solo para esa transición.
- [x] **Etapa 5: editor.**
  - **Analizar piezas** es un botón dividido: pendientes y desactualizadas (con su cantidad), reintentar fallidas y reanalizar todas.
  - La barra de progreso tiene **Detener** y cuenta las piezas detenidas.
  - El bloque de IA tiene **Volver a analizar esta versión**.
  - Enlaces profundos `?pieza=&v=&hilo=` y `?vista=galeria`.
  - La barra del visor muestra un tercer estado, Cliente, cuando la pieza ya se envió.
- [x] **Etapa 7 (parcial): bandera de habilitación.**
  - Next habilita QA en desarrollo o con `QA_VISUAL_ENABLED=true`.
  - En Convex, `QA_VISUAL_ENABLED=false` apaga todas las funciones de QA.
- [x] **Etapa 8: galería y carrusel internos.**
  - Selector Revisión/Galería en el header.
  - `InternalGallery`, con los tres estados por pieza, filtros por IA, interna y cliente, y selección de versiones aprobadas para enviar.
  - `InternalCarousel`, con ← → para navegar, Esc para cerrar y deslizamiento táctil, sin tira de miniaturas. Muestra los tres estados, las conversaciones con el cliente y los accesos a aprobar y a la revisión detallada.
- [x] **Etapa 9: entregas.**
  - `SendToClientDialog`: configuración del cliente (cliente, marca, etiqueta de agencia, aprobadores y campos de la ficha), piezas elegibles y bloqueadas con su motivo, mensaje y publicación idempotente.
  - Backend nuevo: duplicados sin resolver bloqueados, `withdrawRound`, `updateBrief` y `briefFields`.
  - Estado del cliente en tarjetas, galería y visor, más el filtro "Revisión del cliente" en la lista.
- [x] **Etapa 10: portal del cliente.**
  - Rutas: `/workspace/reviews` (lista de campañas), `/workspace/reviews/[campaignId]` (galería por pestañas y carrusel) y `/workspace/reviews/media`.
  - El carrusel incluye la ficha, las versiones V1/V2 (las anteriores en modo lectura), "Lo que pediste en la versión anterior", comentarios generales o sobre un punto de la imagen, respuestas, y las acciones Solicitar cambios y Aprobar pieza.
  - En pantallas angostas el panel pasa a hoja inferior.
  - Un `super_admin` puede abrir la vista previa en modo lectura ("Ver como el cliente").
- [x] **Etapa 11 (parcial): voz.**
  - Grabadora con `MediaRecorder` (webm/opus o mp4), onda en vivo, corte a los 3:00 y escucha previa.
  - Subida a Storage; si el comentario falla, el audio subido se reutiliza al reintentar.
  - Reproductor con transcripción en el portal y en el editor.
  - Respuestas internas por voz y el selector **Nota interna / Responder al cliente** en hilos del cliente.

### 24.3 Pendiente

- **Validación real:** publicar en Convex Dev (esquema, funciones y los dos componentes Workpool nuevos) y probar el flujo completo con una carpeta real: importar, analizar, aprobar, enviar al cliente, revisar como usuario externo y comentar por voz. Después, medir cuotas y latencias para fijar `QA_VISUAL_ANALYSIS_CONCURRENCY` (§10.1).
- **Etapa 4:** guardar la respuesta cruda del modelo en Storage por intento (`rawId`).
- **Etapa 6:** historial paginado y actualizaciones optimistas.
- **Etapa 7:** dataset de evaluación con piezas reales, métricas, alertas y migración final de las tablas y ejecutores anteriores (§17).
- **Etapa 11:**
  - Pool de transcripción con recuperación (hoy se lanza con el scheduler y, si falla, queda "No se pudo transcribir" sin perder el audio).
  - Notificaciones de QA por app y email.
  - Limpieza de audios subidos y no usados. **No se implementó a propósito**: identificarlos exige recorrer `_storage`, donde también hay archivos de otras funcionalidades, y no se debe arriesgar a borrarlos. Hace falta registrar la subida antes de que exista el `storageId`, o un prefijo propio.
  - Pruebas de grabación en iOS Safari y Chrome Android.
- **Acceso del cliente desde el email:** la ruta `/workspace/reviews` funciona con sesión iniciada. Hoy el login externo redirige a `/workspace` al terminar, así que el enlace del email no lleva directo a la revisión si no había sesión. Ajustarlo requiere tocar el flujo de login compartido, que quedó fuera de este alcance.
- **Etapa 12:** PWA.

### 24.4 Variables de entorno nuevas

| Variable | Dónde | Valor |
| --- | --- | --- |
| `QA_VISUAL_ANALYSIS_CONCURRENCY` | Convex | Concurrencia global de análisis (1–100; por defecto 24). |
| `QA_VISUAL_GEMINI_MODEL` | Convex | Modelo principal de QA (por defecto `gemini-3.7-flash`). |
| `QA_VISUAL_OPENAI_MODEL` | Convex | Modelo de respaldo de QA (por defecto `gpt-6-luna`). |
| `QA_VISUAL_ENABLED` | Next | `true` habilita QA fuera de desarrollo. |
| `QA_VISUAL_ENABLED` | Convex | `false` desactiva todas las funciones de QA. |

Las transcripciones usan `SPEECH_KEY` y `SPEECH_REGION`, que la app ya tiene configuradas para Azure.

### 24.5 Corrección de clasificación de contenido legible (13/11/2026)

- Implementada la política de §9.2.1 en `model/controls.ts`, `model/visibleDate.ts`, `model/prompt.ts` y `worker.ts`: omisión legible o ausencia confirmada → hallazgo; evidencia realmente insuficiente → no verificable; formato no soportado → evaluación semántica.
- Se guarda el método final y la evidencia (`evidenceStatus`, `missingElements`) en los hallazgos. Un fallo de localización no cambia el resultado.
- `ANALYSIS_POLICY_VERSION` pasa de `qa-visual-4` a `qa-visual-5`. Las revisiones anteriores se conservan como historial y quedan desactualizadas; no se reescriben sus dictámenes ni se reclasifican solo en la UI. Para aplicar la política a una campaña existente, **Actualizar desde Drive** genera entradas con la política nueva y luego se deben volver a analizar las piezas. Este cambio no ejecuta análisis automáticamente.
- Pruebas de regresión en `qaVisualControls.test.ts`, `qaVisualDomain.test.ts` y `qaVisualVerdict.test.ts`: omisión de mes, componentes de fecha, formatos equivalentes, cantidades y CTA faltantes, ausencia frente a ilegibilidad, evaluación semántica de formatos no soportados, prioridad de hallazgos y conteo en la UI.
- La evaluación con imágenes reales de §16 sigue siendo necesaria para medir errores de lectura y clasificación del modelo. Las pruebas deterministas no sustituyen esa evaluación visual.

## 25 Plan: QA Visual para cualquier tipo de pieza gráfica

> Plan sin implementar (13/11/2026). Objetivo: que QA Visual analice cualquier pieza gráfica sin suponer que tiene precio, fecha, producto u oferta. Lo único fijo es la estructura de carpetas y archivos de la campaña. El diseño de las piezas y el contenido del pedido pueden cambiar.

### 25.1 Diagnóstico: dónde está acoplado hoy

Hoy el sistema funciona bien con piezas promocionales de comida rápida: una oferta numerada, un precio, una fecha o "HOY", un canal (Domicilio, Express o Auto Rápido) y, a veces, un CTA. Ese supuesto aparece en todas las capas:

| Capa | Archivo | Supuesto fijo | Qué pasa con otra pieza |
| --- | --- | --- | --- |
| Catálogo de controles | `convex/qaVisual/model/requirements.ts` (`ids`), `analysisInput.node.ts` (`baseline`) | Siempre los mismos 6 controles: `format`, `dimensions`, `product`, `price`, `date`, `cta`. | Una pieza institucional, de marca o de evento queda con `product`, `price` y `date` en "sin referencia" o "no verificable". El veredicto sale "incompleta" aunque la pieza esté bien, y no se controla lo que sí importa (titular, legales, logo, hashtag, URL, dirección, horario). |
| Lectura de la matriz | `requirements.ts`, `clientMatrix.node.ts` | Pestañas `PRODUCCION`, `LEYENDA` y `REGLAS`, y celdas fijas: A–E identidad de la fila, G formato, I/J dimensiones, K ofertas numeradas, L precios numerados, P notas/CTA, `LEYENDA!C11` y `REGLAS!B6`. | Si la matriz de otro cliente u otra campaña usa otras columnas u otro idioma, los requisitos quedan vacíos o, peor, se leen de una columna equivocada. |
| Lectura del CSV | `model/productionCsv.ts` | Columnas `TXT_PRODUCTO`, `TXT_PRECIO`, `SLOT_CTA`, `SLOT_FECHA`, `CAMPAÑA`, `FASE`, `CANAL`, `MEDIO_PLATAFORMA`, `FORMATO_TIPO`, `ANCHO_PX` y `ALTO_PX`, mapeadas a un tipo `ProductionFields` cerrado. | Cualquier otra columna del CSV (`TXT_TITULAR`, `TXT_LEGAL`, `URL`, `HASHTAG`…) se ignora. |
| Vinculación de oferta | `model/linking.ts`, `model/offers.ts`, `model/normalize.ts` | Ofertas como lista numerada `1. …`, prefijos de canal `DOMICILIO\|EXPRESS\|AUTORAPIDO` y fechas en español (`temporal`, meses en español). | Sin lista numerada no hay vínculo. Otros canales u otros idiomas no se reconocen. |
| Comparadores deterministas | `model/controls.ts`, `model/offers.ts` (`priceAmount`), `model/visibleDate.ts` | Solo `price` (formato `$8,99`) y `date` (día/mes en español). | Montos con miles, otras monedas, porcentajes ("-30 %"), cuotas ("12 cuotas sin interés") o rangos horarios no tienen comparador. |
| Prompt | `model/prompt.ts` | Rol de "piezas publicitarias" con ejemplos de precio, fecha, "JUEVES 15", la app y "descargar". | El modelo recibe instrucciones irrelevantes y sesgos ("mencionar la app no equivale a invitar a descargarla") en piezas que no tienen nada de eso. |
| Veredicto | `model/verdict.ts` | Un control es visual si no es `format` ni `dimensions`. | Un control técnico nuevo (peso, perfil de color, transparencia) se contaría como visual. |
| Ficha del cliente | `model/clientBrief.ts` | Campos `product`, `price`, `date`, `cta` y canales `DOMICILIO/EXPRESS/AUTORAPIDO` para título y canal. | La ficha queda vacía o con títulos mal armados. |
| Frontend | `app/lib/qa-visual/piece-inventory.ts`, `review-model.ts`, `PieceDetails.tsx`, `CommentCard.tsx`, `FilesPanel.tsx` | El tipo de pieza tiene `product`, `price`, `validity`, `cta`, `channel` y `phase`, con etiquetas fijas ("Oferta del cliente", "Precio solicitado", "Vigencia solicitada"). La selección manual de candidatos se llama "Oferta del cliente". | Los paneles muestran "—" en campos sin sentido para la pieza y no muestran los requisitos reales. |
| Configuración heredada | `QA_VISUAL_RULES_JSON` + `QA_VISUAL_GOOGLE_FOLDER_ID` | Reglas extra por variable de entorno y para una sola carpeta. | No escala a varias campañas ni a varios clientes. |

Lo que **no** está acoplado y se conserva tal cual: lectura de Drive en solo lectura, inventario de carpetas, identidad de piezas y versiones por `contentHash`, preparación de imágenes, los pools de análisis y el runner, la política de reintentos, la localización de comentarios (`box_2d` → región), los hilos, las aprobaciones, la revisión del cliente, la galería y el carrusel.

### 25.2 Contrato estable: qué se puede seguir asumiendo

1. **Carpetas:** la campaña tiene `RECURSOS`, `EDITABLES` y `DESPLIEGUE`. Las piezas finales están en `DESPLIEGUE`.
2. **Archivos de referencia:** en `RECURSOS` hay una matriz del cliente (`.xlsx`) y un CSV de producción (`*_CONVERTED.csv`). El CSV tiene una columna de identidad de pieza (hoy `ID_PIEZA`) que coincide con el nombre del archivo de la pieza.
3. **Pieza:** una imagen (hoy PNG o JPEG) por archivo, con dimensiones y formato reales que se pueden leer sin IA.

Todo lo demás pasa a ser **configuración por campaña** o **contenido extraído del pedido**: nombres de columnas, pestañas, qué elementos se piden, cómo se comparan y cómo se muestran.

### 25.3 Principios del rediseño

1. **El pedido define los controles; el código no.** Una pieza se evalúa contra los elementos que el pedido exige para *esa* pieza, no contra una lista fija. Si el pedido no pide precio, no existe el control de precio (ni siquiera como "no aplica").
2. **Tipos de control, no controles con nombre de dominio.** El código conoce *tipos* genéricos (texto requerido, importe, fecha o vigencia, llamado a la acción, logo o marca, texto legal, URL o contacto, elemento visual, técnico…). Cada requisito de una pieza es una *instancia* de un tipo, con una etiqueta legible que viene del pedido ("Titular", "Precio", "Hashtag de la campaña").
3. **Mapeo de fuentes declarativo.** Cómo se lee la matriz y el CSV se describe en un **perfil de fuentes** (datos), no en `if` con letras de columna. El comportamiento actual pasa a ser el perfil `promo-ofertas-v1`.
4. **Determinista cuando se puede, semántico cuando no.** Los comparadores deterministas quedan como *mejoras opcionales* por tipo. Si no reconocen el formato, se conserva la evaluación del modelo (misma política de §9.2.1).
5. **Prompt compuesto.** Un prompt base sin ejemplos de dominio, más bloques por tipo de control presente en la pieza. Nada de "la app", "descargar" ni "JUEVES 15" en el prompt base.
6. **Mismo contrato de salida.** El modelo sigue devolviendo un control por `ruleId` con `outcome`, `evidenceStatus`, `visibleText`, `missingElements` y `box_2d`. El runner, la validación de salida y la localización no cambian.
7. **Paso a paso y reversible.** La primera etapa reproduce exactamente el comportamiento actual con la arquitectura nueva; las pruebas existentes deben seguir pasando sin cambios de resultado.
8. **Alcance QA Visual.** No se toca la lógica de agentes que crean briefs y publicaciones del resto del proyecto. Si en el futuro se quiere usar ese brief como fuente, se lee como una fuente más en solo lectura (§25.6.4), sin modificar esos agentes.

### 25.4 Catálogo de tipos de control

Archivo nuevo: `convex/qaVisual/model/controlTypes.ts`. Cada tipo declara:

```ts
type ControlType = {
  kind: string;                    // "text" | "amount" | "date" | ...
  family: "technical" | "visual";  // reemplaza el if de verdict.ts
  defaultSeverity: "warning" | "blocking";
  defaultLabel: string;            // "Texto requerido"
  promptBlock: string;             // instrucciones específicas del tipo (§25.7)
  compare?: (expected: string, visible: string, ctx: CompareContext) => Comparison | undefined;
  technical?: (expected: string, snapshot: ImageSnapshot) => { outcome: "pass" | "fail"; observed: string };
};
```

Tipos iniciales:

| `kind` | Familia | Qué controla | Comparador determinista | Notas |
| --- | --- | --- | --- | --- |
| `format` | technical | Formato real del archivo | Sí (actual) | Igual que hoy. |
| `dimensions` | technical | Ancho × alto reales | Sí (actual) | Igual que hoy. Admitir tolerancia opcional. |
| `fileSize` | technical | Peso máximo | Sí | Opcional, desde el perfil o una regla de la campaña. |
| `text` | visual | Un texto que debe aparecer (titular, subtítulo, hashtag, nombre de producto o servicio) | Normalización opcional (mayúsculas, tildes, espacios) | `params.match`: `semantic` (por defecto), `exact` o `contains`. |
| `amount` | visual | Importes, precios, porcentajes, cuotas, cantidades | Sí, con locale y moneda | Generaliza `priceAmount`: separadores de miles, `$`, `USD`, `€`, `%`, "x2". |
| `date` | visual | Fecha, rango, vigencia, horario | Sí, con locale | Generaliza `visibleDate`: meses en varios idiomas, rangos "del 1 al 15", horarios. Mantiene la regla "no inferir el mes o año ausente". |
| `cta` | visual | Llamado a la acción por intención | No | Evalúa la intención pedida (comprar, descargar, reservar, visitar). Sin ejemplos de dominio fijos. |
| `legal` | visual | Texto legal, condiciones, bases | Opcional (presencia de frases clave) | Suele ser chico: el bloque del prompt pide indicar `unreadable` si no se puede leer y no inventar. |
| `contact` | visual | URL, teléfono, dirección, @usuario | Sí (normalización de URL y teléfono) | |
| `brand` | visual | Presencia de un logo o marca | No | Sin imagen de referencia, se evalúa por descripción ("logo de la marca X arriba a la derecha"). Con referencia, ver §25.6.3. |
| `visual` | visual | Un elemento visual pedido ("foto del producto", "mostrar a dos personas") | No | Evaluación semántica pura. |
| `prohibited` | visual | Algo que **no** debe aparecer (precio viejo, marca competidora, texto de otra campaña) | Opcional | Invierte la lógica: presencia confirmada = `fail`. |

El `ruleId` de cada requisito pasa a ser un identificador estable por pieza (`text:titular`, `amount:precio`, `legal:bases`), y el `kind` determina el tipo. Los `ruleId` actuales (`product`, `price`, `date`, `cta`) se conservan en el perfil `promo-ofertas-v1` como alias de `text`, `amount`, `date` y `cta` para no invalidar el historial.

### 25.5 Modelo de requisito genérico

Cambios en `model/contracts.ts`:

```ts
requirement = {
  ruleId: string,             // estable dentro de la pieza
  kind: string,               // tipo del catálogo (§25.4)
  label: string,              // "Titular", "Precio", "Bases legales": viene del perfil o del pedido
  criterion?: string,         // instrucción específica opcional ("debe invitar a reservar")
  params?: Record<string, string | number | boolean>, // match, locale, moneda, tolerancia
  status, basis, expected, display, expectedAlternatives, sources, issueIds, // sin cambios
  severity?: "warning" | "blocking", // si falta, se usa defaultSeverity del tipo
}
```

- `source.file` suma `"brief"` (§25.6.4) y `"profile"` (valor fijo del perfil).
- `issue.affects` sigue usando `ruleId`; las etiquetas para la UI salen de `requirement.label`.
- `ANALYSIS_POLICY_VERSION` pasa a `qa-visual-6` y `PARSER_VERSION` a `6`. Las revisiones anteriores quedan como historial desactualizado (igual que en §24.5). La UI usa un mapa de compatibilidad (`product` → "Producto", `price` → "Precio"…) para mostrar resultados viejos sin `label`.
- `qaVisualRuleSets` guarda la lista de `{ ruleId, kind, label, criterion, severity }` efectiva por campaña. La pieza solo recibe los que su pedido exige.

### 25.6 Fuentes del pedido: perfiles de lectura

#### 25.6.1 Perfil de fuentes

Tabla nueva `qaVisualSourceProfiles` (o un campo `sourceProfile` en la campaña, si el perfil es propio de cada campaña):

```ts
{
  key: "promo-ofertas-v1",
  label: "Promoción con ofertas numeradas",
  csv: {
    pieceIdColumn: "ID_PIEZA",
    identity: { campaign: "CAMPAÑA", phase: "FASE", channel: "CANAL", platform: "MEDIO_PLATAFORMA", format: "FORMATO_TIPO", width: "ANCHO_PX", height: "ALTO_PX" },
    fields: [ // cada columna con contenido se convierte en un requisito de basis "production"
      { column: "TXT_PRODUCTO", ruleId: "product", kind: "text", label: "Producto" },
      { column: "TXT_PRECIO",   ruleId: "price",   kind: "amount", label: "Precio" },
      { column: "SLOT_FECHA",   ruleId: "date",    kind: "date", label: "Vigencia" },
      { column: "SLOT_CTA",     ruleId: "cta",     kind: "cta", label: "Llamado a la acción" },
    ],
  },
  matrix: {
    sheet: "PRODUCCION",
    headerMatch: { column: "A", text: "CAMPAÑA" },
    rowKey: [ { column: "A", csv: "campaign" }, { column: "B", csv: "phase" }, { column: "C", csv: "channel" }, { column: "D", csv: "platform" }, { column: "E", csv: "format", normalize: "formatLabel" } ],
    fields: [
      { column: "G", ruleId: "format", kind: "format" },
      { columns: ["I", "J"], ruleId: "dimensions", kind: "dimensions" },
      { column: "K", strategy: "numberedList", ruleId: "product", kind: "text", label: "Producto", linkBy: ["channel", "date"] },
      { column: "L", strategy: "numberedList", ruleId: "price", kind: "amount", label: "Precio", sameOrdinalAs: "product" },
      { column: "P", strategy: "linesMatching", pattern: "call to action|\\bcta\\b|^cpa\\s*:|^tagline\\s*:", ruleId: "cta", kind: "cta" },
    ],
    checks: [ "dimensionsLegend:LEYENDA!C11", "storiesWithoutOffer:REGLAS!B6" ],
  },
  vocabulary: { channels: ["DOMICILIO", "EXPRESS", "AUTORAPIDO"], language: "es", currency: "USD" },
}
```

Puntos clave:

- **Estrategias de lectura** reutilizables en `model/sourceStrategies.ts`: `cell` (valor directo), `numberedList` (lo que hoy hace `numbered` + `linkOffer`), `linesMatching` (lo que hoy hace la búsqueda de CTA en la columna P), `freeText` (texto completo como criterio, para notas libres) y `csvColumn`. `linking.ts` y `offers.ts` pasan a ser la implementación de `numberedList`, sin canales fijos: los prefijos se toman de `vocabulary.channels`.
- **Columnas del CSV por convención:** además del mapeo explícito, toda columna con prefijo `TXT_` que no esté mapeada genera un requisito `kind: "text"` con la etiqueta derivada del nombre (`TXT_TITULAR` → "Titular"). Así, una campaña nueva con más textos en el CSV funciona sin tocar código. Las columnas `SLOT_*` (nombres de assets) siguen siendo solo referencia, no texto esperado.
- **Chequeos del perfil**, como la leyenda de dimensiones o la regla de Stories sin oferta, quedan como funciones con nombre que el perfil activa. No se ejecutan en campañas que no las declaran.
- `normalize.offerChannel`, `clientBrief.pieceChannel` y los regex de prefijos de `linking.ts` leen `vocabulary.channels` en lugar de la constante fija.
- `ProductionFields` pasa de un tipo cerrado a `{ pieceId, identity: {...}, values: Record<string, string>, csvLine, duplicates }`.

#### 25.6.2 Selección del perfil al dar de alta la campaña

- En la verificación de la carpeta (`campaignRegistration.ts`, `driveSource.node.ts`) se **detecta** el perfil: se prueban los perfiles conocidos contra los encabezados del CSV y las pestañas y encabezados de la matriz, y se elige el de mayor coincidencia.
- Si ninguno supera el umbral, la campaña se registra con el perfil `generico-csv-v1`: solo controles técnicos más las columnas `TXT_*` del CSV, más la extracción asistida de §25.6.3 si está habilitada.
- La lista de verificación del alta suma una línea "Cómo se lee el pedido: *Promoción con ofertas numeradas*" con la cantidad de requisitos detectados por pieza (mín/máx). **Nota:** esto toca la pantalla de alta, que hoy está cerrada en diseño. Se propone solo agregar esa línea a la lista de verificación existente, sin rediseñarla, y requiere tu aprobación.
- El perfil elegido se guarda en la campaña y entra en el `requirementsHash`; cambiarlo invalida los análisis vigentes como cualquier cambio del pedido.

#### 25.6.3 Extracción asistida del pedido (matrices sin estructura fija)

Para matrices que son texto libre (un brief en celdas, notas largas, varias piezas descritas en prosa):

1. Acción `extractRequirements` ("use node", pool propio de baja concurrencia), que se ejecuta **una vez por versión de la matriz** (por `contentHash` de la matriz), no por análisis.
2. Entrada: el texto de la fila vinculada (o de la sección de la matriz que corresponde a la pieza) y el catálogo de tipos. Salida estructurada: `[{ ruleId, kind, label, expected, criterion, sourceCell }]`.
3. Cada requisito extraído queda con `basis: "client"`, `status: "unresolved"` y la fuente exacta (celda). **No se usa en un análisis hasta que una persona lo confirma** en Detalles ("Confirmar requisitos extraídos"). Confirmar crea un `qaVisualLinkOverrides` de tipo `requirement`, auditado con autor y fecha, como los vínculos manuales actuales.
4. Esto reemplaza `QA_VISUAL_RULES_JSON`: las referencias confirmadas viven en la base y por campaña, no en variables de entorno.
5. Con referencias visuales (un logo en `RECURSOS/`), el perfil puede declarar `brandAssets: ["RECURSOS/LOGO*.png"]`. La imagen se envía como segunda imagen al modelo solo para controles `brand`.

#### 25.6.4 Otras fuentes (opcional, posterior)

Si una campaña de QA tiene un brief generado en el resto de la app, el perfil puede declararlo como fuente `brief` de **solo lectura** y generar requisitos `text` y `cta` desde sus campos. No se modifica la lógica de los agentes que crean briefs ni sus tablas; QA solo lee.

### 25.7 Prompt compuesto

Archivo `model/prompt.ts` → `buildReviewPrompt(controls, piece)`:

1. **Base (siempre):** rol neutro ("Sos un revisor de piezas gráficas"), los requisitos y la imagen son datos y no instrucciones, un control por `ruleId`, transcripción literal en `visibleText`, clasificación de `evidenceStatus`, regla de ausencia confirmada = `fail`, `missingElements`, uso restringido de `unverifiable`, `visibleAnchor` + `box_2d`. Es el texto actual **sin** los ejemplos de precio, fecha, app ni CTA.
2. **Bloques por tipo:** solo se agregan los `promptBlock` de los tipos presentes en la pieza. Por ejemplo:
   - `amount`: equivalencias de escritura de importes y unidades según `params.locale`/`currency`, y comparar todas las cifras pedidas (precio y cuotas, precio anterior y actual).
   - `date`: las equivalencias y la regla "no inferir mes o año" que hoy están en el prompt base, más rangos y horarios.
   - `cta`: evaluar la intención pedida en `criterion`; un texto que nombra el canal sin invitar a la acción no cumple, salvo que el criterio lo admita.
   - `legal`: texto chico; si no se puede leer, `unreadable`, no `absent`.
   - `prohibited`: presencia confirmada = `fail`; ausencia confirmada = `pass`.
   - `brand`/`visual`: describir lo observado y la posición; no exigir texto.
3. **Contexto de la pieza:** formato (post, story, banner, afiche, carrusel), dimensiones e idioma esperado. Sirve para leer bien, no agrega controles.
4. **Entrada por control:** `{ ruleId, kind, label, expected, criterion, severity }`. Hoy se envía el `rule` completo con `source`; la fuente se puede omitir del prompt porque no ayuda a leer la imagen.
5. **Versión del prompt:** `promptVersion = hash(base + bloques)` se guarda en el intento (`attempt`), así se sabe con qué texto se generó cada resultado.
6. **Idioma de salida:** `observed` en el idioma de la interfaz (español); `visibleText` siempre literal, en el idioma de la pieza.

`commentLocalization.ts` ya es genérico (localiza un texto citado); solo hace falta pasarle la etiqueta del control en lugar del `ruleId`.

### 25.8 Comparadores deterministas por tipo

- `model/comparators/amount.ts`: generaliza `priceAmount` con locale (`1.299,90` y `1,299.90`), moneda opcional, porcentajes y "N cuotas de $X". Devuelve `undefined` ante formatos no reconocidos, y entonces se conserva la evaluación del modelo.
- `model/comparators/date.ts`: generaliza `visibleDate`/`temporal` con meses y días en `es`, `en` y `pt`, rangos ("del 1 al 15 de octubre", "1–15/10"), "hasta el …" y horarios. Mantiene el chequeo de componentes omitidos (día, mes, año).
- `model/comparators/text.ts`: normalización (tildes, mayúsculas, espacios, comillas tipográficas) para `match: "exact" | "contains"`. Con `semantic` no hay comparador.
- `model/comparators/contact.ts`: URL (sin protocolo, sin `www`, sin barra final) y teléfono (solo dígitos).
- `resolveVisualControl` (`controls.ts`) cambia `["price", "date"].includes(ruleId)` por `controlTypes[kind].compare`, sin cambiar la política de §9.2.1.
- `worker.ts` cambia `rule.id === "dimensions" || rule.id === "format"` por `controlTypes[kind].family === "technical"` y llama a `technical()`.

### 25.9 Controles generales sin pedido (opcional por campaña)

Hay errores que importan en cualquier pieza aunque el pedido no los mencione: faltas de ortografía, texto cortado por el borde, texto ilegible por contraste, elementos fuera de la zona segura de Stories, o adaptaciones de la misma pieza con textos distintos.

- Se agregan como **observaciones de calidad**, separadas de los controles del pedido: `generalChecks: ["spelling", "cutText", "contrast", "safeArea"]` en la campaña.
- El modelo los devuelve en un arreglo aparte `observations[]` (`{ kind, observed, visibleAnchor, box_2d, confidence }`), en la misma llamada.
- **No cambian el veredicto** (Validada, Con hallazgos, Incompleta) salvo que la campaña los marque como bloqueantes. En la UI se muestran como comentarios del agente con la etiqueta "Calidad" y se pueden descartar.
- Zona segura: depende del formato (por ejemplo, Story 1080 × 1920 con márgenes superior e inferior). Se define en el perfil por formato y se envía como contexto.
- **Consistencia entre adaptaciones** (post y story de la misma oferta con textos distintos): se resuelve después, comparando los `visibleText` ya guardados de piezas del mismo grupo, sin otra llamada al modelo. Queda para una etapa posterior.

### 25.10 Veredicto y cobertura

- `verdict.ts`: `visual = controlTypes[requirement.kind].family === "visual"`. El resto del cálculo no cambia.
- Las razones del veredicto usan `requirement.label` ("Falta el titular", "El precio no coincide") en lugar de nombres fijos.
- Una pieza **sin requisitos visuales** (solo técnicos) sigue pudiendo quedar Validada. La UI debe aclararlo: "Solo se verificaron formato y dimensiones: el pedido no indica contenido para esta pieza". Así se evita que "Validada" parezca una revisión de contenido.

### 25.11 Cambios en el frontend (solo QA Visual)

| Archivo | Cambio |
| --- | --- |
| `app/lib/qa-visual/review-model.ts`, `piece-inventory.ts` | Se reemplazan `product`, `price`, `validity`, `cta`, `channel` y `phase` por `attributes: { key, label, value }[]` (identidad de la fila: campaña, fase, canal, plataforma, si el perfil los define) y `requirements: { ruleId, label, expected }[]`. El título de la pieza sale de una plantilla del perfil (`titleTemplate: "{product} · {channel}"`) o, si falta, del nombre del archivo. |
| `piece/PieceDetails.tsx` | La lista "Qué se pidió" se arma dinámicamente con `label` + `expected` + cadena de origen. Se eliminan las etiquetas fijas "Oferta del cliente", "Precio solicitado" y "Vigencia solicitada". |
| `comments/CommentCard.tsx` | "Afecta: …" usa las etiquetas de los requisitos. El selector de candidatos ("Oferta del cliente") pasa a "Elegí la referencia correcta" y solo aparece si la estrategia es `numberedList`. |
| `campaign/FilesPanel.tsx`, galería | Los filtros por canal y fase se generan a partir de los `attributes` presentes. Si la campaña no tiene canal, el filtro no aparece. |
| `model/clientBrief.ts` + portal del cliente | La ficha del pedido muestra los requisitos `basis: "client"` listos con su `label`, sin la lista fija `product/price/date/cta`. `availableFields` se calcula desde los requisitos de las piezas enviadas. |
| Bloque IA del editor y del carrusel | El detalle "5 de 6 controles cumplen" no cambia. El texto de los controles agrupados ("formato, dimensiones, producto, precio y vigencia") se arma con las etiquetas reales. |
| Detalles → requisitos extraídos | Bloque nuevo "Requisitos sugeridos por IA, sin confirmar" con **Confirmar** / **Descartar** por requisito (§25.6.3). |

### 25.12 Formatos de pieza

- Hoy: PNG y JPEG. Agregar **WEBP** (misma preparación de imagen) en la primera etapa.
- **PDF de una página** (afiches, flyers): rasterizar la primera página en la preparación (`imagePreparation.node.ts`) y tratarla como imagen. Si tiene varias páginas, cada página es una pieza o el perfil declara "solo la página 1". Hay que decidir cuál.
- **Carruseles:** hoy cada imagen es una pieza. Agrupar las placas de un carrusel por prefijo de nombre (`…_CARRUSEL_01`, `_02`) para mostrarlas juntas y evaluar requisitos que aplican al conjunto ("el precio aparece en alguna placa"). Es una etapa posterior: requiere un control de alcance `group`.
- **GIF o video:** fuera de alcance. Se listan en el inventario como "formato no admitido para análisis", sin error de importación.

### 25.13 Evaluación (requisito antes de activar)

Ampliar el dataset de §16 y de la etapa 7 con piezas **distintas** a las de prueba actuales:

| Grupo | Ejemplos | Qué mide |
| --- | --- | --- |
| Promoción con precio (actual) | Las piezas de Semana de Locura | Que la etapa A no cambie resultados (regresión). |
| Marca o institucional sin precio | Titular + logo + claim | Que no aparezcan controles de precio o fecha y que se evalúe el titular. |
| Evento | Fecha y hora, lugar, URL de entradas | `date` con horario, `contact`. |
| Financiera o retail | "12 cuotas sin interés", "-30 %", precio anterior tachado | `amount` con varias cifras, `prohibited`. |
| Legales largos | Bases y condiciones en letra chica | `legal` con `unreadable` correcto. |
| Otro idioma | Pieza en inglés o portugués | Locale de comparadores y `visibleText` literal. |
| Sin pedido | Pieza sin fila en CSV ni matriz | Solo técnicos + aviso claro, sin "Incompleta" engañosa. |
| Story con zona segura | Texto pegado al borde | Observación `safeArea` (§25.9). |

Métricas por **tipo de control**: falsos positivos (`fail` en pieza correcta), falsos negativos, tasa de `unverifiable`, precisión de `box_2d` y costo y latencia por pieza. Un cambio de prompt o de comparador solo se activa si no empeora ninguna métrica del grupo de regresión.

Pruebas deterministas nuevas: `qaVisualControlTypes.test.ts` (catálogo y familias), `qaVisualSourceProfiles.test.ts` (perfil `promo-ofertas-v1` = resultados idénticos a los de hoy sobre las matrices de prueba; perfil genérico con columnas `TXT_*`), `qaVisualComparators.test.ts` (importes y fechas por locale) y `qaVisualPrompt.test.ts` (el prompt de una pieza sin precio no contiene el bloque `amount`).

### 25.14 Etapas de implementación

Cada etapa se puede publicar sola y no rompe las campañas existentes.

| Etapa | Contenido | Archivos principales | Criterio de terminado |
| --- | --- | --- | --- |
| **A. Refactor sin cambio de comportamiento** | Catálogo de tipos (§25.4) con `format`, `dimensions`, `text`, `amount`, `date` y `cta`. Requisito con `kind` y `label`. Perfil `promo-ofertas-v1` que reproduce las reglas actuales (columnas, `numberedList`, chequeos de LEYENDA y REGLAS). `verdict.ts`, `controls.ts` y `worker.ts` despachan por `kind`. | `model/controlTypes.ts`, `model/sourceProfiles.ts`, `model/sourceStrategies.ts`, `requirements.ts`, `productionCsv.ts`, `controls.ts`, `verdict.ts`, `worker.ts`, `contracts.ts` | Todas las pruebas QA actuales pasan sin cambiar los resultados esperados. La política pasa a `qa-visual-6`. |
| **B. Prompt compuesto** | Prompt base neutro + bloques por tipo + contexto de pieza + `promptVersion`. | `model/prompt.ts`, `worker.ts`, `commentLocalization.ts` | Prueba de prompt por tipo. Evaluación del grupo de regresión sin empeorar. |
| **C. UI dinámica** | `attributes`/`requirements` en el modelo de pieza, Detalles, comentarios, filtros, ficha del cliente y título por plantilla. Compatibilidad con resultados viejos. | §25.11 | Una campaña con perfil genérico se ve sin campos "—" ni etiquetas de oferta. |
| **D. Perfiles configurables y detección** | Tabla de perfiles, detección en el alta, perfil `generico-csv-v1`, columnas `TXT_*` por convención, vocabulario de canales. | `tables.ts`, `campaignRegistration.ts`, `driveSource.node.ts`, `analysisInput.node.ts` | Una carpeta con otro CSV (otras columnas `TXT_*`) genera requisitos correctos sin tocar código. |
| **E. Tipos nuevos y comparadores** | `legal`, `contact`, `brand`, `visual`, `prohibited`, `fileSize`. Comparadores por locale. WEBP. | `model/comparators/*`, `controlTypes.ts`, `imagePreparation.node.ts` | Pruebas de comparadores y evaluación de los grupos Evento, Financiera y Otro idioma. |
| **F. Extracción asistida y confirmación** | `extractRequirements` + bloque de confirmación en Detalles. Retiro de `QA_VISUAL_RULES_JSON`. | `extractRequirements.ts` (nuevo), `overrides.ts`, `PieceDetails.tsx` | Una matriz en texto libre produce requisitos sugeridos que, una vez confirmados, se analizan. Sin confirmación no se usan. |
| **G. Controles generales** | `observations[]`, zona segura por formato, opción por campaña. | `prompt.ts`, `worker.ts`, `validators.ts`, UI de comentarios | Las observaciones no cambian el veredicto salvo que estén configuradas como bloqueantes. |
| **H. Posterior** | PDF, carruseles agrupados, consistencia entre adaptaciones, brief de la app como fuente de solo lectura. | — | Según §25.15. |

Orden recomendado: A → B → C (con eso, piezas sin precio ya se ven y se evalúan bien con las columnas actuales) → D → E → F → G.

### 25.15 Riesgos y decisiones abiertas

1. **Matrices sin estructura:** si la matriz de otro cliente no tiene filas por pieza, la única vía es la extracción asistida (§25.6.3). Su calidad depende del modelo y siempre requiere confirmación humana, lo que suma trabajo al equipo. Decisión: ¿se acepta ese paso manual o se exige al cliente una plantilla mínima?
2. **Columnas `TXT_*` por convención:** es simple y potente, pero una columna con texto interno (notas de producción) se convertiría en requisito. Mitigación: el perfil puede excluir columnas y la lista de verificación del alta las muestra.
3. **Controles generales y ruido:** la ortografía y el contraste generan falsos positivos. Por eso son observaciones descartables y no cuentan para el veredicto por defecto.
4. **Costo:** más tipos y bloques significan prompts algo más largos, pero se envían solo los bloques presentes. La extracción asistida corre una vez por versión de la matriz, no por análisis.
5. **Compatibilidad:** los resultados con `qa-visual-5` se conservan como historial. No se reclasifican; se vuelve a analizar como en §24.5.
6. **Alta de campaña:** la detección de perfil agrega una línea a la lista de verificación existente. Hay que confirmar si se acepta ese cambio mínimo en una pantalla ya cerrada.
7. **PDF multipágina y carruseles:** hay que decidir si cada página o placa es una pieza o si se agrupan.
