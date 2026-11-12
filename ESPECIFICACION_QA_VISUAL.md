# Especificación del sistema QA Visual para diseñar su arquitectura

Fecha de referencia: 12 de noviembre de 2026.

QA Visual debe permitir a un equipo de agencia revisar las piezas publicitarias de cada campaña contra el pedido original del cliente, mostrar la evidencia de cada observación y registrar una decisión humana por pieza y versión. La usuaria quiere una herramienta operativa, integrada en `agent-core-new`, con el diseño que ya aprobó, acceso a los archivos desde Google Drive y resultados de IA que aparezcan progresivamente mientras se procesa la campaña.

Este documento reúne los requisitos expresados por la usuaria, el funcionamiento del código actual y los problemas pendientes. Está dirigido a un LLM que debe proponer la arquitectura y la evolución de esa implementación. Las decisiones actuales de código describen el punto de partida, no una obligación de conservar sus defectos.

La documentación inicial `01-alcance.md` a `07-dudas-para-el-cliente.md` contiene propuestas anteriores a varias decisiones de esta conversación. Cuando difieran, las decisiones más recientes recogidas aquí son las que deben orientar la arquitectura. En particular, el ingreso por Drive, la separación de tareas, las campañas múltiples, Convex, las imágenes preparadas y la cola de cuatro piezas ya forman parte del alcance actual.

## 1 Cómo interpretar los requisitos y el estado actual

Se utilizan estas distinciones a lo largo del documento:

- **Requisito de la usuaria**: comportamiento que solicitó o aceptó explícitamente.
- **Implementado**: comportamiento presente en el código revisado de la rama `feat/qa-visual` de `agent-core-new`, incluidos cambios todavía sin commit.
- **Problema conocido**: comportamiento observado o derivado directamente del código que contradice el objetivo funcional o limita su cumplimiento.
- **Pendiente de diseño**: decisión que la arquitectura deberá desarrollar. No debe presentarse como una funcionalidad ya terminada o aprobada en todos sus detalles.

No se consultó ni modificó producción para preparar este documento. Los casos de pruebas y diagnósticos mencionados corresponden a Convex Dev y a la conversación previa. Las cantidades de registros de una corrida son antecedentes de prueba, no datos que deban quedar fijos en el producto.

## 2 Qué quiere lograr la usuaria

### 2.1 Resultado funcional

El equipo debe poder agregar una campaña mediante la URL de una carpeta de Drive, abrir sus piezas en un editor visual, consultar el pedido y sus reglas, iniciar una revisión automática y ver los resultados de cada pieza en cuanto estén disponibles.

La revisión debe responder con precisión:

1. Qué pidió el cliente para esa pieza.
2. Cómo quedó representado ese pedido en el CSV de producción.
3. Qué contiene realmente la imagen final.
4. Qué cumple, qué incumple y qué no puede verificarse.
5. De qué archivo, pestaña, celda y oferta numerada proviene cada requisito.
6. Dónde está en la imagen el elemento sobre el que se hizo una observación.
7. Qué decidió la persona que revisa esa versión.

La herramienta debe ayudar a encontrar errores reales. Un fallo de asociación de nuestros datos no debe presentarse como un error de la gráfica ni como una observación que supuestamente hizo el modelo.

### 2.2 Condiciones expresas

- Implementar dentro del proyecto existente `agent-core-new`.
- Mantener la funcionalidad separada y mantenible dentro de las carpetas existentes del proyecto.
- No crear una carpeta genérica `feature` o `features` para agrupar todo.
- Colocar componentes en `app/components/qa-visual`, hooks en `app/hooks/qa-visual` y utilidades en las carpetas correspondientes con su subcarpeta `qa-visual`.
- Dividir los componentes por responsabilidad. Evitar archivos monolíticos difíciles de mantener.
- No vincular QA Visual a las tareas. No modificar el flujo de tareas ni usar adjuntos de tareas como fuente.
- Obtener los archivos desde Google Drive por medio de Convex.
- Mantener Drive estrictamente en modo de lectura. Nunca editar, renombrar, mover ni borrar archivos o carpetas allí.
- Admitir varias campañas con carpetas diferentes. Semana de Locura es la campaña de prueba, no una campaña fija del sistema.
- Conservar el diseño aprobado en temas claro y oscuro.
- Mantener el header, las tabs de administrador y la navegación originales de `agent-core-new`.
- Mantener por ahora el acceso de QA Visual restringido a usuarios internos `super_admin`.
- Usar datos reales, sin estados, comentarios o aprobaciones inventados para que la interfaz se vea completa.
- No escribir en la interfaz que los casos son simulados, ejemplos o pruebas.
- Separar el resultado de la IA de la aprobación humana.
- Mostrar en verde tanto la validación de IA como la aprobación humana cuando corresponda.
- Mostrar la revisión progresivamente, sin esperar el final de toda la campaña.
- Poder repetir análisis y recuperar fallos. Debe contemplarse también la revisión individual de una pieza.
- No implementar aprobación final automática ni corrección automática de las gráficas.

Las primeras diez piezas fueron un límite temporal de prueba. Ya se habilitó el análisis de todas las piezas de la campaña. El botón debe decir **Analizar piezas**, sin mencionar diez piezas.

## 3 Evolución del alcance

| Etapa | Decisión o aprendizaje |
| --- | --- |
| Documentación inicial | Se estudió el pedido, el CSV y una pieza de KFC para entender el problema de QA. |
| Maqueta independiente | Se diseñó un editor inspirado en Ziflow con datos de demostración. |
| Diseño aprobado | Se ajustaron headers, tabs, estados, comentarios sobre la imagen y temas claro y oscuro. |
| Integración real | Se incorporó una página propia en `agent-core-new`, separada de tareas. |
| Fuente local temporal | Se leyó una carpeta de Drive sincronizada en la Mac mientras se preparaban credenciales. |
| Conexión actual | Convex accede a Google Drive con una cuenta de servicio. La lectura desde la Mac dejó de ser la solución vigente. |
| Campañas múltiples | Se agregó una pantalla de campañas y un diálogo para registrar carpetas por URL. |
| Persistencia de fuentes | Se guardan Excel, CSV, celdas del cliente y datos procesados por pieza en Convex. |
| Imágenes preparadas | Se generan una miniatura y una imagen para análisis. El visor central usa la imagen para análisis. |
| Análisis operativo | Gemini como proveedor principal, OpenAI como respaldo, resultados por pieza, reintentos y cola de cuatro. |
| Correcciones recientes | Asociación de precios por numeral, Stories con aviso sin bloqueo, coordenadas de IA y navegación con flechas. |
| Problema pendiente actual | Una diferencia entre `FESTIN LOCURA` y `FESTIN DE LOCURA` deja fuera del análisis visual a una pieza que sí tiene referencias identificables. |

La presencia de un control en la interfaz no implica que todo su flujo esté persistido en backend. La separación entre UI funcional y persistencia pendiente se detalla en la sección 16.

## 4 Conceptos que debe manejar la arquitectura

| Concepto | Significado en este sistema |
| --- | --- |
| Campaña de QA Visual | Registro que representa una carpeta raíz de Drive, con su nombre, inventario e importaciones. |
| Campaña del CSV o Excel | Identificador de una línea de comunicación dentro de los documentos. Una sola carpeta de QA puede contener varios identificadores de campaña de producción. |
| Pieza | Imagen final concreta que debe revisarse. No equivale a una tarea. |
| Versión de archivo de Drive | Versión técnica del archivo en Drive. Se usa para detectar cambios y reutilizar imágenes preparadas. |
| Versión de revisión creativa | Entrega anterior o corregida de una pieza. Su modelo completo todavía está pendiente. |
| Snapshot de campaña | Importación publicada del inventario, fuentes y requisitos procesados. No es una captura de pantalla. |
| Corrida de análisis | Ejecución que solicita revisar un conjunto de piezas contra un snapshot determinado. |
| Revisión de pieza | Resultado y estado de procesamiento de una pieza dentro de una corrida. |
| Regla | Criterio de evaluación, por ejemplo comparar el precio visible con el solicitado. |
| Requisito | Valor concreto que esa regla debe verificar para una pieza. |
| Hallazgo | Diferencia o incumplimiento detectado al aplicar una regla. |
| Aviso de fuente | Inconsistencia del Excel, CSV o vinculación. No demuestra por sí sola un defecto visual. |
| No verificable | Control que no puede concluir por falta de evidencia, ambigüedad u otro impedimento concreto. |
| No aplica | Control que no se exige para esa pieza según el pedido vinculado. |
| CTA | Llamado a la acción, por ejemplo pedir, descargar una app o acercarse a un canal. Un nombre de asset no demuestra su texto real. |
| Oferta numerada | Entrada dentro de una celda que contiene una lista de ofertas. Su número se debe asociar con el mismo número de la lista de precios. |
| Post | Pieza de publicación. En los ejemplos hay posts cuadrados de 1080 × 1080. |
| Story | Pieza vertical para historias. En los ejemplos hay Stories de 1080 × 1920. |
| Expectativa | Línea de comunicación que anticipa una promoción. No es un estado de procesamiento. |
| Heavy Up | Nombre de otra línea o refuerzo de comunicación de la campaña. No es una instrucción técnica ni un estado de IA. |
| Autorápido | Canal de atención en automóvil. Se diferencia de Domicilio y Express. |
| HOY | Variante temporal solicitada en algunas ofertas. Debe distinguirse de una variante con fecha específica. |

Los significados comerciales de fases y campañas deben confirmarse con el equipo cuando afecten reglas. El sistema no debe inventarlos a partir del nombre.

## 5 Archivos de entrada y Google Drive

### 5.1 Estructura de la carpeta

La estructura actual esperada es:

```text
Carpeta de campaña
├── RECURSOS
│   └── Matriz del cliente.xlsx
├── EDITABLES
│   ├── CSV de producción.csv
│   └── Otros archivos de producción y assets
└── DESPLIEGUE
    └── Imágenes finales PNG o JPEG
```

El código actual busca esas tres subcarpetas por su nombre exacto y exige una única coincidencia accesible para cada una. Lista los archivos directamente contenidos en ellas. No hay un recorrido recursivo general de subcarpetas.

La carpeta de prueba es `AUTO SEMANA DE LOCURA`:

```text
https://drive.google.com/drive/folders/1XegTebQKoeGfcB2_vUfp1i_kI7L6XsTH
```

El acceso a las campañas de la agencia se preparó desde la cuenta `digital@pto99.com`, que dispone de acceso a las carpetas pertinentes. Esto no significa que el backend deba iniciar sesión interactivamente como esa persona.

### 5.2 Autenticación y responsabilidad de cada servidor

**Implementado:** Convex realiza la autenticación con Google y las llamadas a Drive. Usa una cuenta de servicio, un JWT firmado y el alcance `drive.readonly`. La carpeta de cada campaña debe compartirse con esa cuenta como **Lector**. El acceso efectivo a las subcarpetas se valida.

La credencial se configura en el entorno del despliegue de Convex mediante `QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON`. Su contenido es secreto y no debe estar en un archivo versionado, en una variable pública de Next.js o en el navegador.

El código también admite `QA_VISUAL_GOOGLE_FOLDER_ID` y `QA_VISUAL_RULES_JSON` para referencias confirmadas opcionales de una carpeta específica. Ese mecanismo es una configuración adicional heredada del piloto. Las campañas normales se identifican por el enlace registrado en la base de datos, no por un único ID global.

El servidor de Next.js conserva una función de proxy autenticado para servir las imágenes al navegador. Reenvía el token de la sesión hacia Convex. No es el responsable de poseer la cuenta de servicio ni de procesar el Excel.

El token de Google se reutiliza en memoria mientras sigue vigente. Una comprobación de integridad de descarga compara tamaño y, cuando Drive lo aporta, MD5.

### 5.3 Selección actual de documentos

- En `RECURSOS` se busca un único `.xlsx`, excluyendo archivos temporales cuyo nombre empieza con `~$`.
- En `EDITABLES` se prefieren los CSV con sufijo `_CONVERTED` o `_CONVERTED_vN`.
- Si no existen esos candidatos, se toman otros CSV excluyendo los que se identifican como `BUILDER`.
- Si queda más de un candidato o no hay ninguno, la importación informa el problema. No debe escoger arbitrariamente una matriz o un CSV.
- En `DESPLIEGUE` se consideran PNG y JPEG con extensión y MIME compatibles y versión de Drive disponible.
- Los nombres duplicados de imágenes se rechazan porque la vinculación actual depende de ellos.
- Los archivos Illustrator y los reportes de biblioteca pueden existir en la carpeta, pero actualmente no se realiza una interpretación completa de su contenido.

### 5.4 Límites actuales de lectura

| Elemento | Límite del código actual |
| --- | --- |
| Matriz Excel | 500 000 bytes |
| CSV | 2 MiB |
| Imagen original | 20 MiB |
| Imagen decodificada | 32 millones de píxeles |
| Inventario importado | Hasta 1000 piezas |
| Piezas de una corrida de análisis | Hasta 200 |
| Reglas de un conjunto | Hasta 20 |

La diferencia entre importar 1000 y analizar 200 debe resolverse para campañas mayores. Estos límites no constituyen requisitos comerciales definitivos.

## 6 Qué contiene el Excel del cliente

El archivo usado como referencia es `MATRIZ_SEMANA DE LOCURA_OCTUBRE_ 2026.xlsx`. Tiene tres pestañas que deben conservarse y considerarse juntas.

### 6.1 PRODUCCION

Contiene las filas del pedido. Una fila puede agrupar muchas ofertas dentro de una celda, por lo que una fila del Excel no equivale necesariamente a una sola imagen final.

El código actual utiliza estas columnas:

| Columna | Uso actual |
| --- | --- |
| A | Campaña. Se busca la cabecera `CAMPAÑA` y luego filas de esa campaña. |
| B | Fase de comunicación. |
| C | Canal de la fila. Puede ser un agrupador como `PARAGUAS` u `OFFLINE`. |
| D | Medio o plataforma, por ejemplo `META`. |
| E | Tipo de pieza o formato, con normalización limitada para Post, Story y Carrusel. |
| G | Formato de archivo solicitado, por ejemplo `JPG/PNG`. |
| I y J | Ancho y alto solicitados. |
| K | Oferta de valor. Puede contener una lista numerada de productos y variantes. |
| L | PVP o precio solicitado, también con una lista numerada. |
| P | Comentarios o instrucciones adicionales, de donde se extraen ciertos requisitos de CTA. |

Existen otras columnas y datos en la matriz. Se conservan sus celdas cuando tienen contenido, pero eso no implica que todos sus significados estén implementados como controles.

### 6.2 LEYENDA

Explica el significado y el uso de campos de la plantilla. Puede indicar formatos, dimensiones, comentarios y cómo completar determinadas filas.

La implementación consulta referencias puntuales, entre ellas `LEYENDA!C11` para dimensiones, `LEYENDA!B9` para formato, `LEYENDA!B12` para Stories y `LEYENDA!C15` para CTA. Esta dependencia de posiciones fijas es una limitación de generalización a otras plantillas.

### 6.3 REGLAS

Contiene instrucciones de cómo completar y procesar la matriz. Hay reglas sobre ofertas numeradas, precios separados, nombres de medios, filas, canales y Stories.

Un ejemplo importante es `REGLAS!B6:D6`, que exige dejar vacía la oferta de la fila de Stories. En la campaña de prueba hay filas de Stories con ofertas completas. La decisión actual de la usuaria es **analizar esas imágenes igualmente y mostrar un solo aviso por pieza sobre la inconsistencia del Excel**.

### 6.4 Lectura real y alcance de interpretación

**Implementado:** se abren las tres hojas del XLSX, se conservan valores de celdas con su hoja y dirección y se construyen requisitos mediante código determinista.

**Límite importante:** no existe una interpretación semántica universal de todas las reglas del Excel. Leer y guardar una celda no equivale a convertirla en una regla ejecutable. La extracción actual reconoce determinadas columnas, posiciones y expresiones de esta plantilla.

El parser recorre el XML del XLSX. No implementa un motor de cálculo de Excel ni recalcula fórmulas. La arquitectura deberá decidir cómo tratar valores calculados, fórmulas sin resultado disponible, celdas combinadas, comentarios de celda y cambios de plantilla. Actualmente se guardan principalmente los valores encontrados, no toda la semántica del libro.

## 7 Qué contiene el CSV de la agencia

El CSV es la bajada operativa a producción. En el caso inicial se llama `SEMANA_DE_LOCURA_OCTUBRE_2026_CONVERTED_v1.csv` y contiene 61 registros.

| Campo | Significado y uso |
| --- | --- |
| `ID_PIEZA` | Identifica la salida y se vincula con el nombre del archivo sin extensión. |
| `TXT_PRODUCTO` | Texto o nombre del producto de esa pieza. |
| `TXT_PRECIO` | Importe que producción asignó a la pieza. |
| `SLOT_CTA` | Referencia al asset del llamado a la acción. |
| `SLOT_FECHA` | Referencia al asset de fecha, cuando existe. Puede estar vacía. |
| `CAMPAÑA` | Campaña de producción. |
| `FASE` | Fase de comunicación. |
| `CANAL` | Canal o agrupador de producción. |
| `MEDIO_PLATAFORMA` | Medio, por ejemplo META. |
| `FORMATO_TIPO` | Formato normalizado, por ejemplo POST o STORY. |
| `ANCHO_PX` y `ALTO_PX` | Dimensiones declaradas en producción. |

Se procesa como CSV con comillas, saltos de línea y comas dentro de campos. La vinculación actual normaliza Unicode NFC, pasa el ID a minúsculas y elimina la extensión conocida.

El CSV no reemplaza el pedido original. Si el precio del CSV contradice al del cliente, el sistema debe mostrar el conflicto y conservar ambos valores. Un asset llamado `CTA_10PRESAS.ai` no prueba que contenga un CTA de descarga.

**Problema a contemplar:** el parser actual construye un diccionario mediante `Object.fromEntries`. IDs duplicados en el CSV pueden sobrescribirse sin una validación explícita. La arquitectura debe detectar duplicados y hacer trazable la fila de CSV de origen, no solo conservar el texto procesado.

## 8 Flujo funcional completo requerido

### 8.1 Registrar una campaña

1. La persona entra en la tab QA Visual de la aplicación.
2. Ve una página de campañas, no el editor de una campaña fija.
3. Presiona **Agregar campaña**.
4. Se abre un diálogo con el campo de URL de Drive.
5. Pega el enlace de una carpeta previamente compartida como Lector con la cuenta de servicio.
6. El backend valida el enlace, los permisos y las tres subcarpetas.
7. Se registra la campaña sin duplicarla si la carpeta ya estaba registrada.
8. Se inicia la importación en segundo plano.
9. Aparece una tarjeta de campaña para entrar al editor.

La creación de la tarjeta no significa que ya terminaron de descargarse y procesarse todos los materiales. La interfaz debe distinguir campaña registrada, importación en curso, importación lista e importación fallida.

### 8.2 Preparar los materiales

1. Listar las tres carpetas.
2. Identificar inequívocamente Excel, CSV e imágenes finales.
3. Obtener versiones y metadatos de Drive.
4. Guardar los originales de Excel y CSV en Convex Storage.
5. Conservar las celdas de las tres hojas del Excel.
6. Procesar el CSV.
7. Vincular cada imagen con su registro de producción y con el pedido del cliente.
8. Desglosar ofertas, precios, fechas y condiciones aplicables.
9. Guardar los datos procesados que necesitará el editor.
10. Publicar la importación completa cuando termina correctamente.
11. Preparar las imágenes para la lista y para el análisis sin esperar a que la persona presione Analizar piezas.

### 8.3 Abrir y usar el editor

El editor debe leer el último snapshot listo desde Convex. Recargar, seleccionar otra pieza o abrir Detalles no debe descargar y volver a interpretar el Excel o el CSV desde Drive.

Las miniaturas se usan en el panel izquierdo. La imagen preparada para el modelo se usa en el centro. Los detalles se muestran con los valores procesados y sus fuentes. La persona puede recorrer las piezas, consultar requisitos y comentar.

### 8.4 Ejecutar el análisis

1. Presionar **Analizar piezas**, junto a Compartir.
2. Crear una corrida contra el snapshot que estaba abierto.
3. Reutilizar las imágenes preparadas disponibles.
4. Revisar hasta cuatro piezas en paralelo, tomando otra cuando se libera un lugar.
5. Guardar el resultado de cada pieza cuando termina.
6. Actualizar su tarjeta, comentarios, estado y progreso mediante la suscripción de Convex.
7. Reintentar automáticamente fallos recuperables.
8. Usar OpenAI si Gemini no puede completar el trabajo.
9. Mostrar errores individuales sin perder los resultados de las piezas que sí terminaron.
10. Finalizar la corrida cuando todas sus piezas estén en un estado terminal.

### 8.5 Revisar y decidir

La persona consulta los hallazgos, ve dónde están sobre la imagen, responde o agrega comentarios, solicita cambios o aprueba la versión. La decisión humana se aplica a la pieza seleccionada y se mantiene separada del dictamen de IA.

Si existen hallazgos o una revisión parcial, la UI actual pide una justificación para aprobar con excepción. El registro durable de esa decisión, su autoridad y su auditoría todavía necesitan completarse.

### 8.6 Actualizar la campaña

**Actualizar desde Drive** es una operación diferente de **Analizar piezas**:

- Actualizar importa o reutiliza las fuentes y vuelve a producir datos procesados si cambió la versión pertinente.
- Analizar aplica las reglas guardadas a las imágenes de una importación concreta.
- Reanalizar sin actualizar no corrige por sí solo un error que ya está persistido en la asociación de requisitos.
- Cambiar el código de interpretación exige invalidar correctamente el snapshot anterior, aunque los archivos en Drive sean idénticos.

## 9 Implementación actual de importación y reutilización

### 9.1 Registro y publicación

`campaignRegistration.add` valida la carpeta y llama a `campaigns.register`. El registro crea `qaVisualCampaigns` y programa `campaignSync.run` mediante `queueSync`.

La campaña mantiene un identificador de solicitud y un trabajo de sincronización. Las escrituras comprueban que la solicitud siga siendo la vigente, para que una importación vieja no reemplace una nueva.

`campaignSync.run` lista los archivos y calcula un fingerprint con la versión del importador, configuración adicional, versiones del Excel y CSV, carpeta de despliegue e inventario de imágenes.

- Si existe un snapshot con ese fingerprint, se reutiliza.
- Si no existe, se leen las fuentes, se procesan y se publican un snapshot y sus piezas.
- Si falla la importación, se conserva el último snapshot listo y se informa el error.

Los originales se deduplican por campaña, tipo de documento, ID y versión de Drive. No se duplica el mismo Excel o CSV en cada recarga del editor.

### 9.2 Qué se guarda y qué se calcula al abrir

**Se guarda:** originales, celdas del Excel, metadatos, producción por pieza, requisitos, avisos, valores confirmados para análisis, hashes de contexto, imágenes preparadas y resultados de IA.

**Se calcula al abrir:** adaptación de esos registros a etiquetas y estructuras de UI, estado visible, conteo de comentarios y consulta de resultados actuales. El viewer consulta si están listas las imágenes preparadas y solicita completar su preparación cuando corresponde.

Las URLs de imágenes siguen ocasionando peticiones HTTP para servir bytes desde Storage. Esto no equivale a recalcular los requisitos. El proxy y el endpoint de imágenes tienen actualmente `Cache-Control: private, no-store`, de modo que falta una política más eficiente de caché privada del navegador si se desea reutilizar bytes entre visitas.

### 9.3 Identidad y versiones internas

- `reviewKey`: hash derivado de la carpeta de Drive, usado como ámbito de análisis.
- `fingerprint`: identifica una importación de campaña.
- `ruleVersion`: hash del conjunto de reglas, configuración confirmada, Excel, producción e inventario.
- `contextKey`: hash de la política, reglas, archivo y contexto que identifica para qué datos es válido un resultado.
- `driveVersion`: versión técnica de un archivo.

Al momento de esta especificación, `campaignSync.ts` usa `importVersion = 3` y `analysisInput.node.ts` incorpora `extraction: 3` y `reviewPolicy: 2` en sus hashes. Son versiones de implementación, no versiones creativas. Una corrección de vinculación debe actualizar las versiones necesarias para impedir la reutilización del procesamiento defectuoso.

### 9.4 Tecnologías que ya utiliza el proyecto

El `package.json` revisado declara las siguientes dependencias. Los rangos indicados son los del proyecto, no versiones impuestas para una reescritura:

| Responsabilidad | Dependencia declarada |
| --- | --- |
| Aplicación y rutas | Next.js `^16.1.1`, React y React DOM `^19.2.3`, TypeScript `^5.9.3`. |
| Backend y datos reactivos | Convex `^1.31.2` y autenticación existente con `@convex-dev/auth`. |
| Orquestación | `@convex-dev/workflow` `^0.3.4` y `@convex-dev/workpool` `^0.3.1`. |
| Llamadas estructuradas a modelos | AI SDK `^6.0.13`, `@ai-sdk/google` `^3.0.4`, `@ai-sdk/openai` `^3.0.30`. |
| Validación de respuestas | Zod `^3.25.76` y validadores de Convex. |
| Lectura del libro XLSX | JSZip y `@xmldom/xmldom`. |
| Procesamiento de imágenes | Sharp `^0.34.5`. |
| Interfaz | CSS de QA, componentes existentes de la aplicación, Tailwind CSS 4 e iconos Lucide. |

Las llamadas de red y el procesamiento con librerías de Node se realizan en acciones de Convex compatibles con ese runtime. Las mutaciones conservan las escrituras transaccionales y las consultas alimentan la UI reactiva. Debe evitarse trasladar trabajo pesado a consultas del editor o hacer que el navegador procese los originales para cada visita.

## 10 Modelo de datos existente en Convex

Las definiciones están en `convex/qaVisual/tables.ts` y `validators.ts`. Los documentos incluyen además `_id` y `_creationTime` de Convex.

### 10.1 Tablas de campaña y fuentes

| Tabla | Qué conserva | Campos principales y relaciones |
| --- | --- | --- |
| `qaVisualCampaigns` | Campaña registrada y estado de sincronización. | `name`, `driveFolderId`, `reviewKey`, `status`, `createdBy`, `currentSnapshotId`, `sync`, `lastSyncedAt`, `syncError`. |
| `qaVisualSourceDocuments` | Metadatos y referencia de Storage del Excel o CSV original. | `campaign`, `kind`, `name`, `hash`, `driveFileId`, `driveVersion`, `bytes`, `updatedAt`, `storageId`, `mappingVersion` opcional. |
| `qaVisualClientRequirements` | Celdas extraídas del libro, vinculadas al documento original. | `documentId`, `cell: { sheet, cell, text }`. Admite también `piece` y `requirement` opcionales de estructuras previas. |
| `qaVisualCampaignSnapshots` | Importación publicada, fuentes exactas y conjunto de reglas. | `campaignId`, `fingerprint`, `excelDocumentId`, `csvDocumentId`, `deploymentFolderId`, `ruleVersion`, `rules`, `notices`, información de preparación de imágenes. |
| `qaVisualCampaignPieces` | Datos procesados de cada pieza dentro de un snapshot. | `snapshotId`, `order`, `file` e `input`. Aquí están los requisitos por pieza que consume el editor. |

Que `qaVisualClientRequirements` conserve las celdas de PRODUCCION no significa que ya exista una vinculación correcta de cada imagen con la oferta concreta dentro de una celda. Esa asociación se materializa en `qaVisualCampaignPieces.input` y puede contener defectos propios.

### 10.2 Imágenes y análisis

| Tabla | Qué conserva | Campos principales y relaciones |
| --- | --- | --- |
| `qaVisualImageCopies` | Copias derivadas reutilizables por archivo y versión de Drive. | `campaign`, `driveId`, `driveVersion`, `lease`, `files.thumbnailId`, `files.analysisId`, `files.snapshot`. |
| `qaVisualRuleSets` | Conjunto de criterios de una versión de análisis. | `campaign`, `version`, `rules`, `sourceDocumentId`. |
| `qaVisualRuns` | Corrida por lote, por pieza o por reintento. | `campaign`, `requestedBy`, `snapshotId`, `ruleSetId`, `kind`, `state`, `requestId`, `activeBatch`, `rollingQueue`. |
| `qaVisualReviews` | Trabajo, intentos y resultado de una pieza en una corrida. | `runId`, `campaign`, `input`, `order`, `status`, `assetId` o `copyId`, `attempts`, `findings`, `error`, `verdict`. |
| `qaVisualAssetVersions` | Almacenamiento del flujo anterior de preparación por análisis. | `campaign`, `input`, `snapshot`, `storageId`. El flujo actual usa normalmente `qaVisualImageCopies`; la compatibilidad anterior sigue presente. |

Los comentarios de IA visibles se construyen a partir de `qaVisualReviews.findings`. Actualmente no hay una tabla independiente que persista el hilo completo de colaboración humana.

### 10.3 Estructuras relevantes

`file` conserva nombre, bytes, fecha de modificación, ID y versión de Drive.

`input` conserva:

```text
name
revision
contextKey
production
requirements[] = { id, expected, source, pending? }
notices[] = { id, message, source }
matrixLinked
expected = { ruleId: valor confirmado para el análisis }
```

`requirements` representa lo extraído y puede incluir controles pendientes. `expected` incluye únicamente valores disponibles para la revisión, salvo las referencias adicionales configuradas explícitamente. La UI no debe confundir un requisito pendiente con un valor esperado confirmado.

Cada `finding` conserva:

```text
ruleId
outcome = pass | fail | unverifiable | notApplicable
expected
observed
source
severity = warning | blocking
region? = { x, y, width, height }
visibleAnchor?
locationStatus? = located | absent | unreadable
```

Cada intento conserva proveedor, modelo, duración, código y tokens de entrada y salida cuando están disponibles. No se persiste actualmente un registro completo y versionado del prompt y la respuesta cruda por llamada.

### 10.4 Índices y alcance

Las búsquedas usan índices por carpeta de Drive, campaña activa, versión de documento, snapshot y orden de pieza, archivo y versión de imagen, campaña y versión de reglas, corrida y estado de revisión, pieza y `contextKey`.

`campaign` en varias tablas es el `reviewKey` de tipo string, mientras que `campaignId` en otras es un ID de `qaVisualCampaigns`. La arquitectura debe mantener clara esa diferencia y evaluar si conviene unificar referencias sin perder compatibilidad.

No se debe mezclar una revisión de una campaña con otra que tenga un nombre de archivo igual. Tampoco debe asumirse que el nombre del archivo es una identidad creativa estable ante renombrados.

## 11 Cómo se construyen y aplican las reglas

### 11.1 Criterios actuales

| Control | De dónde sale el requisito | Cómo se comprueba actualmente |
| --- | --- | --- |
| Formato | PRODUCCION, columna G. | Código compara formato real decodificado, admitiendo equivalencia JPG/JPEG y alternativas declaradas. |
| Dimensiones | PRODUCCION, columnas I y J, con contraste puntual con LEYENDA. | Código compara ancho y alto reales del original. |
| Producto | Oferta seleccionada dentro de K. | Modelo compara el texto visible con el producto solicitado. |
| Precio | Entrada de L con el mismo numeral que la oferta seleccionada de K. | Validación documental previa y comparación visual mediante modelo. |
| Vigencia | Fecha o HOY extraídos de la oferta seleccionada. | Modelo contrasta el texto visible con la referencia. |
| CTA | Líneas pertinentes de P y referencias de leyenda. | Modelo evalúa el texto o criterio confirmado. |

Las instrucciones de revisión tienen dos niveles:

1. Criterios y prompt escritos en código, en `analysisInput.node.ts` y `worker.ts`.
2. Valores concretos, contexto y fuentes extraídos del Excel y del CSV.

La IA recibe una imagen y la lista de controles visuales preparados para esa pieza. No recibe actualmente todo el libro para decidir libremente qué regla aplicar. Por eso un defecto en la preparación puede impedir la revisión antes de llegar al modelo.

### 11.2 Ausencia de un requisito

La usuaria indicó que **si el cliente no pidió un CTA u otro control, su ausencia no debe volver incompleta la revisión**.

El comportamiento requerido distingue:

- No solicitado en el pedido vinculado: **No aplica**.
- Solicitado y visible: comparar con el pedido.
- Solicitado y ausente en la imagen: posible incumplimiento, con evidencia del pedido.
- Existe pedido pero nuestro sistema no pudo vincularlo: problema de preparación, no ausencia de pedido.
- Requisito contradictorio o evidencia ilegible: no verificable en el control afectado.

El código actual usa `matrixLinked` y la existencia de un requisito para distinguir algunos de estos casos. `matrixLinked` es hoy un booleano basado en que se hayan extraído requisitos. No representa por sí solo la calidad de la asociación de oferta, precio o fecha.

### 11.3 Números y precios

La usuaria destacó la gravedad de asignar un precio equivocado. Debe mantenerse la relación **oferta 1 con precio 1, oferta 2 con precio 2**, etc.

Corrección ya implementada:

- Respetar el numeral original, no la posición después de filtrar líneas vacías.
- Conservar una entrada como `1.` sin precio, para que no desplace los siguientes importes.
- Exigir un único precio con el mismo numeral.
- Detectar numerales duplicados y precios inválidos.
- Normalizar importes equivalentes, como `8,99`, `8.99` o ceros finales.
- Comparar contra `TXT_PRECIO` y dejar pendiente un conflicto entre Excel y CSV.
- No tomar un precio de una oferta vecina como alternativa.

Estos controles evitan la desalineación detectada anteriormente. No garantizan por sí solos que la oferta seleccionada sea la correcta. El problema de la pieza 16 se produce en ese paso anterior.

### 11.4 Condiciones necesarias para una vinculación robusta

**Pendiente de diseño:** representar explícitamente la oferta seleccionada, su numeral, sus celdas, el producto original y normalizado, canal, temporalidad, precio, método de vinculación y avisos.

Las equivalencias deben ser controladas y auditables. Diferencias de mayúsculas, tildes, espacios o expresiones aprobadas pueden normalizarse. No debe usarse una coincidencia aproximada irrestricta que confunda productos, cantidades, canales o promociones.

Cuando hay una equivalencia segura que deja una única oferta candidata, la pieza debe analizarse y conservar un aviso de nomenclatura si corresponde. Cuando hay dos candidatos plausibles, no debe inventarse una elección ni bloquear controles independientes que sí tienen referencia.

## 12 Ejecución de IA y resultados en vivo

### 12.1 Inicio y concurrencia

`runs.start` comprueba permisos, campaña activa, snapshot vigente, selección y `requestId`. Un doble envío con el mismo identificador no crea otra corrida. Si hay una corrida activa de esa campaña, devuelve la existente.

Se crean una corrida y una revisión por pieza. El pipeline conserva el snapshot y las reglas de esa solicitud. No debe cambiar las referencias a mitad de una corrida si alguien actualiza Drive.

La cola actual mantiene **cuatro revisiones simultáneas por corrida**. Cuando una termina, se libera su lugar y se inicia otra. No espera a que terminen grupos completos de cuatro. Los workarounds antiguos de lotes y callbacks siguen en el código para compatibilidad con corridas anteriores.

La preparación de imágenes también usa grupos de cuatro y puede ir entregando piezas listas al análisis. Las imágenes ya guardadas se reutilizan.

**Pendiente:** el límite actual no es un presupuesto global entre todas las campañas. La arquitectura debe considerar concurrencia conjunta, cuotas de proveedores y equidad entre campañas.

### 12.2 Proveedores y razonamiento

Configuración encontrada en el código:

| Función | Proveedor y modelo configurado |
| --- | --- |
| Principal | Gemini, `gemini-3.7-flash`, razonamiento `low`. |
| Respaldo | OpenAI, `gpt-5.5`. |

Estos nombres describen la configuración local revisada, no una recomendación sobre disponibilidad futura. Se importan de `convex/lib/llmFallback.ts`, que también es compartido por otras funcionalidades. Una evolución de QA no debe alterar el comportamiento de otros agentes accidentalmente.

El pipeline de QA implementa sus propios intentos. No debe suponerse que usa todas las decisiones del wrapper general `withLLMFallback` solo por importar su configuración.

### 12.3 Reintentos y fallos

- Hasta tres intentos con Gemini.
- Después, hasta dos con OpenAI.
- Esperas de 2 y 4 segundos antes de los reintentos segundo y tercero de Gemini. OpenAI tiene 2 segundos antes del segundo intento.
- El SDK usa `maxRetries: 0`; el control de reintentos está en el workflow.
- Fallos transitorios, timeouts y resultados estructurados inválidos pueden reintentarse.
- Un error de entrada no se resuelve mandando la misma entrada inválida a otro proveedor.
- Si ninguno completa la revisión, la pieza queda con error de análisis y un mensaje específico.

El worker de QA usa un plazo de 75 segundos por intento para la llamada principal y la localización adicional, compartiendo la señal de cancelación. No debe confundirse con el timeout general del módulo compartido de LLM.

La preparación tiene un mecanismo de expiración programado a los diez minutos y maneja imágenes que no se pudieron adjuntar. Deben distinguirse los tiempos de descarga, preparación, espera en cola y modelo para diagnosticar latencia.

### 12.4 Persistencia progresiva

Cada resultado se guarda inmediatamente en `qaVisualReviews`. El frontend se suscribe con `useQuery` al dashboard, por lo que se actualizan las piezas terminadas mientras continúan las restantes.

Este comportamiento es progreso **por pieza**. No hay streaming de palabras o controles intermedios del modelo en la UI. La usuaria pidió ver los resultados sin esperar a todo el lote, no específicamente un chat con tokens en vivo.

El dashboard puede mantener visible el resultado completado anterior del mismo contexto mientras se recalcula, indicando que es anterior. Si cambió el `contextKey`, considera el análisis desactualizado. La arquitectura debe hacer explícita esa condición en todas las superficies relevantes.

Si el intento más reciente falla y se muestra una conclusión anterior, deben verse ambos hechos: existe un resultado previo y la actualización falló. El resultado anterior no debe ocultar el error ni parecer una nueva revisión exitosa.

### 12.5 Reanálisis individual

El backend y el hook admiten `kind: piece` y un único nombre de archivo. También existe `retry` para las piezas fallidas. La usuaria pidió retirar un botón adicional de **Analizar esta pieza** que se había colocado en una barra aparte.

La necesidad de volver a analizar una sola pieza sigue formando parte del flujo que hay que contemplar. Su acceso definitivo en la interfaz debe diseñarse sin restaurar aquella ubicación rechazada.

## 13 Imágenes preparadas y rendimiento

### 13.1 Dos imágenes distintas

| Imagen | Uso | Preparación actual |
| --- | --- | --- |
| Miniatura | Lista izquierda y vistas pequeñas. | WebP, hasta 192 × 192 dentro de ese marco, calidad 75. |
| Imagen de análisis | Envío al modelo y visor central. | JPEG, hasta 1800 × 1800, calidad 88. Si supera 700 000 bytes se intenta 1400 × 1400, calidad 76. Se rechaza si aún supera 750 000 bytes. |
| Original de Drive | Descarga del original. | No se conserva otra copia completa del original de imagen en el flujo nuevo. |

Las dimensiones máximas preservan proporción, no amplían imágenes pequeñas y no recortan la composición. Se corrige orientación y se aplana transparencia sobre blanco para el JPEG. La arquitectura debe valorar esa transformación si se incorporan piezas transparentes con requisitos específicos.

La usuaria cambió explícitamente la preferencia inicial de mostrar el original en el centro: debe verse la imagen preparada para análisis porque el original desde Drive tardaba demasiado. La miniatura pequeña no debe usarse como entrada del LLM ni como imagen principal.

### 13.2 Momento de generación y reutilización

La preparación se solicita después de publicar o reutilizar un snapshot. Al abrir el editor también se solicita completar el trabajo pendiente. Se identifica cada copia por campaña, ID y versión de Drive.

Se usa una reserva con token y vencimiento para evitar que dos procesos generen y guarden simultáneamente la misma imagen. Las copias terminadas se reutilizan para futuras visitas y corridas.

La imagen seleccionada se carga en el centro. Las miniaturas usan carga diferida y evitan descargar los originales de toda la campaña para armar la lista.

### 13.3 Controles técnicos

Los metadatos de dimensiones y formato se obtienen al decodificar el original. El formato JPEG preparado no debe convertir artificialmente un original PNG en un fallo de formato ni hacer que se comparen las dimensiones reducidas contra el pedido original.

Las coordenadas del análisis se refieren a la composición completa de la imagen preparada, que es también la que muestra el visor.

## 14 Comentarios y coordenadas

### 14.1 Lo que exige la usuaria

Los comentarios visuales de IA deben señalar el lugar exacto de lo observado. Un comentario sobre la fecha debe marcar la fecha y uno sobre el CTA debe marcar el CTA. Ubicar todos los iconos en una esquina no satisface este requisito.

La persona debe poder marcar un punto en la imagen y escribir allí mismo en un textarea presentado en un popover cuidado, sin trasladarse obligatoriamente al compositor derecho.

Al hacer clic en un marcador de la imagen:

- Abrir el panel derecho y la tab Comentarios si hace falta.
- Mostrar el comentario aunque hubiera un filtro que lo ocultaba.
- Desplazar directamente al comentario.
- Aplicar un realce discreto y breve que ayude a encontrarlo.

La etiqueta **Comentarios generales** solo debe verse al pasar el mouse o enfocar el grupo, no permanentemente sobre la gráfica.

### 14.2 Coordenadas humanas

Los comentarios humanos se crean a partir del punto donde la persona hizo clic, normalizado a porcentajes de la imagen. No requieren una llamada al modelo para ubicarse.

Las anotaciones y sus posiciones deben seguir correspondiendo a la pieza y versión, incluso al hacer zoom, desplazar o redimensionar el visor.

### 14.3 Coordenadas de IA

Implementación reciente:

1. El modelo devuelve un `box_2d` con cuatro enteros entre 0 y 1000.
2. El orden es `[y_min, x_min, y_max, x_max]`.
3. El código convierte esos bordes a `{ x, y, width, height }` normalizados entre 0 y 1.
4. `visibleAnchor` conserva el texto realmente visible o la descripción concreta del elemento señalado.
5. Se validan bordes, área positiva, valores finitos y pertenencia a la imagen.
6. Si un resultado `fail` o `unverifiable` carece de región válida, se solicita una localización adicional de ese comentario sobre la misma imagen.
7. Respuestas inciertas, duplicadas, con IDs desconocidos o regiones inválidas activan la política de salida inválida.
8. La UI convierte las proporciones a porcentajes, coloca el marcador en el centro de la región y muestra el rectángulo al seleccionar el comentario.

La validez geométrica no demuestra por sí sola que la región corresponda al texto correcto. Deben existir pruebas visuales de correspondencia y métricas para ese problema.

### 14.4 Comentarios generales

Se admiten comentarios generales cuando no existe una región visual real, por ejemplo un aviso sobre el Excel. No deben inventarse coordenadas para aparentar evidencia visual.

El localizador distingue `located`, `absent`, `unreadable` y una salida temporal `uncertain` que no se acepta como localización terminada. En el resultado persistido se conservan los primeros tres estados.

Si el comentario dice que falta una palabra en una frase que sí aparece, se debe marcar la frase visible. Por ejemplo, una observación de falta de CTA de descarga puede ubicarse sobre el cierre existente de KFC App.

### 14.5 Reparación y evidencia de prueba

Existe una acción interna `commentLocalization.repair` para completar ubicaciones de comentarios existentes sin cambiar sus conclusiones. Se usó exclusivamente sobre la primera pieza para comprobar la corrección:

- Marcador 5 sobre `JUEVES 22`.
- Marcador 6 sobre `A DOMICILIO POR KFC APP`.
- La localización exitosa tomó aproximadamente cinco segundos.

Ese tiempo corresponde a una prueba de localización de una sola pieza, no a una promesa de duración para una revisión completa. Después la usuaria ejecutó nuevamente la campaña. El fallo de la pieza 16 descrito abajo es documental y ocurre antes del modelo, por lo que no se arregla cambiando coordenadas.

## 15 Estados y diseño de la interfaz

### 15.1 Dos estados independientes

Cada tarjeta y la zona central deben mostrar dos bloques claramente distinguibles:

| Revisión de IA | Aprobación humana |
| --- | --- |
| Analizando | Pendiente |
| Validada por IA | En revisión |
| Con hallazgos | Cambios solicitados |
| Revisión incompleta | Aprobada |
| Error de análisis | Aprobada con excepción |

Las filas no son combinaciones obligatorias. Cada columna evoluciona por separado. Puede haber IA validada y humana pendiente, ambas aprobadas, o humana aprobada con excepción frente a hallazgos de IA.

- Validación de IA y aprobación humana se muestran en verde.
- Hallazgos o verificaciones pendientes usan un tono de advertencia.
- Errores técnicos y solicitudes de cambios deben distinguirse.
- La IA puede mostrar loader durante el análisis.
- La revisión humana no debe mostrar un spinner que parezca un proceso automático de carga.
- La usuaria pidió eliminar el caso de demostración **Sin analizar**. Cuando no hay un resultado real, la implementación actual muestra un estado neutral `—`, no una aprobación inventada.

### 15.2 Estados técnicos actuales

| Nivel | Valores |
| --- | --- |
| Corrida | `preparing`, `running`, `finished`. |
| Trabajo de pieza | `preparing`, `queued`, `analyzing`, `retrying`, `completed`, `failed`. |
| Resultado de cada control | `pass`, `fail`, `unverifiable`, `notApplicable`. |
| Dictamen agregado | `findings`, `partial`, `validated`. |
| Decisión humana de UI | `Pendiente`, `En revisión`, `Cambios solicitados`, `Aprobada`. |

Actualmente, si hay algún `fail`, el dictamen agregado es `findings`. Si no hay fallos pero hay algún `unverifiable`, es `partial`. Si todos los controles terminados no tienen esos resultados, es `validated`.

**Límite a resolver:** una pieza puede tener hallazgos y controles incompletos simultáneamente, pero el agregado prioriza `findings`. La cobertura de revisión debe permanecer visible. También hay que impedir que una corrida sin controles visuales aplicables se interprete como una validación visual completa.

El progreso de campaña cuenta trabajos completados o fallidos. Una pieza `completed` con dictamen `partial` cuenta como terminada, aunque la revisión sea incompleta. Por eso un progreso del 100 % no significa que todas las piezas estén aprobadas o que todas hayan pasado por Gemini.

### 15.3 Pantalla de campañas

- Página inicial de QA Visual en `/workspace/qa-visual`.
- Botón Agregar campaña que abre un diálogo, no un formulario desplegado en la página.
- Tarjetas de campañas con acceso a su editor.
- Márgenes consistentes con las otras páginas del proyecto, sin el centrado excesivo que se rechazó.
- Estados claros de carga, ausencia de campañas y error.

### 15.4 Editor aprobado

El diseño se inspira en el flujo de revisión de Ziflow, adaptado a los estilos de la aplicación. Debe preservar temas claro y oscuro y la identidad existente.

La base visual actual usa la tipografía del sistema `ui-sans-serif, system-ui, sans-serif`, iconos Lucide, primario índigo y variables de superficie, texto, líneas y estados definidas en `review.css`. El tema se hereda de `html.dark` y del proveedor de tema existente. Ya se corrigió una discrepancia de hidratación causada por agregar la clase dark de manera distinta en servidor y cliente. La arquitectura debe conservar una sola fuente de estado del tema y evitar reproducir ese problema.

**Header de la aplicación:** conservar las tabs originales según el rol. No reemplazarlo por un header propio de la maqueta ni quitar opciones de administrador. El logo de PTO99 corresponde a la identidad aprobada, pero no habilita a cambiar la navegación global.

**Header de campaña:** flecha para volver a campañas, nombre de campaña, separador y Revisión de piezas. Sin breadcrumbs de carpetas, sin logo KFC añadido al lado del título y sin botón Volver a la tarea. Altura compacta.

**Acciones de campaña:** Actualizar desde Drive, Compartir y Analizar piezas. La aprobación de la pieza no debe estar ubicada como una acción general de toda la campaña.

**Progreso:** barra centrada visualmente, con cantidad terminada, total, porcentaje, estado y errores. Debe tener el tratamiento visual aprobado y permitir seguir viendo las piezas.

**Panel izquierdo:** tabs Archivos, Resumen y Recursos. Contenido general de la campaña, buscador, filtros y tarjetas. Cada tarjeta muestra miniatura, nombre legible, formato, comentarios y los dos estados de aprobación. Navegación con flechas arriba y abajo, respetando filtros y manteniendo visible la seleccionada. El atajo no debe interferir con inputs, selectores, textarea, diálogos o una anotación en curso.

**Centro:** nombre técnico del archivo, versión, herramientas, estados prominentes de IA y persona, botón Aprobar esta versión dentro del contexto de esa pieza e imagen de análisis. Zoom, desplazamiento, marcadores y anotaciones. No debe existir el carrusel inferior de miniaturas que la usuaria pidió eliminar.

**Panel derecho:** tabs Comentarios, Detalles, Versiones e Historial. Todo corresponde a la pieza seleccionada. Requisitos y Detalles se unificaron en Detalles con el diseño de tarjetas contenedoras de requisitos.

**Comentarios:** avatar de robot para el agente, persona identificada para comentarios humanos, esperado, observado, fuentes, acceso a la región y resolución. Filtros para todos, agentes, humanos o pendientes.

**Detalles:** pedido original del cliente, producción declarada, archivo, versión, contexto y resultado por control. Un check verde en el pedido debe significar que ese control cumple, no simplemente que se encontró una celda en el Excel. Se distinguen Cumple, No cumple, No verificable, No aplica y Sin evaluar.

### 15.5 Referencias visuales

El proyecto de documentación conserva `capturas/light` y `capturas/dark`. Hay seis escenas equivalentes por tema, documentadas en `capturas/README.md`. Incluyen hallazgos, comentario sobre imagen, detalles, aprobación humana, versiones e historial.

La maqueta está en `maqueta`. Algunas escenas antiguas muestran estados de demostración que sirvieron para aprobar el diseño. No deben reutilizarse sus comentarios, personas o aprobaciones como datos reales del sistema operativo.

## 16 Funciones persistidas y partes que siguen siendo locales

| Función | Estado actual |
| --- | --- |
| Registrar campañas por URL | Persistido en Convex. |
| Importar originales de Excel y CSV | Persistido en Convex Storage. |
| Conservar celdas del Excel | Persistido en Convex. |
| Guardar datos procesados por pieza | Persistido en Convex. |
| Miniaturas e imágenes para modelo | Persistidas por archivo y versión. |
| Corridas, intentos y conclusiones de IA | Persistidos en Convex. |
| Regiones y texto ancla de IA | Persistidos dentro de los resultados. |
| Mostrar comentarios de IA | Se derivan de los resultados guardados. |
| Escribir comentarios humanos y respuestas | Funciona en UI, pero vive en `useState` del editor. |
| Resolver o reabrir comentarios | Overrides locales de la sesión. |
| Aprobar o solicitar cambios | Estado y decisiones locales en `use-review-decisions.ts`. |
| Excepciones de aprobación | Campo y validación locales, sin registro durable de backend. |
| Rectángulos y dibujo libre | Estado local de anotaciones. |
| Historial | Se construye con resultados y actividad disponible en la sesión. No es todavía una auditoría persistida completa. |
| Versiones creativas | El adaptador fija actualmente `versions: 1`. Drive y snapshots tienen versiones técnicas, pero no resuelven todo el flujo de entregas corregidas. |
| Compartir | Copia la URL actual. No crea una invitación ni otorga permisos. |
| Edición manual de vínculos y equivalencias | No hay un flujo completo de confirmación persistida. |

La arquitectura debe completar estas partes sin hacer pasar la existencia del diseño por una implementación productiva terminada. Recargar el editor puede perder comentarios, resoluciones y decisiones humanas locales.

También hay textos residuales a revisar. Por ejemplo, Detalles todavía puede describir el origen como archivo original aunque el centro ahora muestre la imagen preparada. La leyenda genérica de checks debe ser consistente con los resultados de cumplimiento reales.

## 17 Problemas conocidos y correcciones necesarias

### 17.1 Pieza 16 excluida por una diferencia de nombre

Caso diagnosticado en Dev el 11 de noviembre de 2026.

Archivo:

```text
OFFLINE_SEMANA_DE_LOCURA_EXPECTATIVA_2026_NOTORIEDAD_META_POST_ESTATICO_AUTORAPIDO_FESTIN_DE_LOCURA_HOY_1080X1080px.png
```

Identificación humana: **Autorápido, Festín de Locura, HOY**, en un Post de Expectativa.

| Origen | Valor relevante |
| --- | --- |
| CSV | `TXT_PRODUCTO = FESTIN DE LOCURA`, `TXT_PRECIO = 8,99`. |
| Excel `PRODUCCION!K6`, entrada 7 | `7.AUTORAPIDO HOY FESTIN LOCURA`. |
| Excel `PRODUCCION!L6`, entrada 7 | `7.$8,99`. |
| Imagen | Se ve HOY, Festín de Locura y $8,99. |

El código busca el nombre completo del CSV como una secuencia literal dentro de la oferta normalizada. No reconoce `FESTIN LOCURA` como equivalente a `FESTIN DE LOCURA`. Las otras entradas de Festín de Locura que sí contienen DE se descartan para esta pieza por canal o temporalidad. El resultado es ninguna oferta seleccionada.

El sistema luego ejecuta un fallback defectuoso en `clientMatrix.node.ts`: copia el contenido completo de K6 como `expected` de producto, precio y fecha, y marca los tres como pendientes con el mismo mensaje.

Consecuencias observadas:

- Detalles repite las trece ofertas en Oferta del cliente, Precio solicitado y Vigencia solicitada.
- Los tres campos referencian K6, incluso el precio, que debería provenir de L6.
- El worker genera tres resultados `unverifiable` con el mismo texto.
- El frontend los publica como tres comentarios del agente.
- El registro de intento tiene `code = skipped_no_visual_rules` y duración cero.
- Esta pieza no pasó por Gemini. Se comprobaron únicamente formato y dimensiones mediante código.

**Requisito de la usuaria:** una diferencia de título que puede resolverse de manera segura no debe dejar la pieza afuera. Debe analizarse y avisarse la discrepancia documental.

**Corrección que debe diseñarse:**

1. Reconocer equivalencias controladas de nombres, con una sola oferta compatible por producto, canal y temporalidad.
2. Conservar los textos originales y la equivalencia aplicada para auditoría.
3. Vincular la oferta 7 con el precio 7, sin alterar la regla de asociación por numeral.
4. Usar HOY como referencia temporal de esa oferta.
5. Publicar un aviso único de nomenclatura, separado de los resultados visuales.
6. Si la vinculación sigue siendo ambigua, mostrar un aviso único sobre los controles afectados y revisar los demás controles disponibles.
7. No llenar campos de precio y fecha con una lista de productos.
8. Versionar e invalidar el procesamiento previo, volver a importar y después reanalizar las piezas afectadas.

Eliminar comentarios repetidos en frontend no arregla la ausencia de análisis. Cambiar el prompt tampoco arregla una pieza que no se envía al modelo.

### 17.2 Avisos repetidos por una sola causa

`analysis-feed.ts` ya agrupa un texto genérico de falta de referencias, pero lo hace comparando una frase exacta. El mensaje de asociación fallida de la pieza 16 es otro texto y queda fuera de ese agrupamiento.

Se necesita un modelo estructurado de causa y alcance, por ejemplo un problema de vinculación que afecte producto, precio y fecha, con un único aviso visible por pieza. Distintos incumplimientos visuales reales deben seguir siendo comentarios separados y específicos.

La deduplicación debe basarse en identidad de la causa y controles afectados, no en que todos los mensajes tengan una redacción idéntica.

### 17.3 Stories con oferta completa en el Excel

En una ejecución anterior algunas Stories quedaron fuera del análisis visual por la contradicción entre la fila llena y la regla que pedía dejarla vacía. La usuaria pidió que se analizaran igual y se conservara un aviso por pieza.

**Ya implementado:** se conserva la oferta disponible, se preparan sus controles y se añade `stories-offer-filled` como aviso. Se mantiene la validación de precio, vinculación y otras ambigüedades. Este cambio no corrige automáticamente el defecto de nombres de la pieza 16.

Las cantidades de 16 y luego 14 piezas de la conversación pertenecían a diagnósticos y selecciones de prueba diferentes. No deben programarse como una lista fija de excepciones.

### 17.4 Precio desplazado por una entrada vacía

Se detectó que una lista de precios tenía una primera entrada sin importe. Un tratamiento por posición podía correr los precios y asociar $5,99 a otra oferta.

**Ya corregido:** selección por numeral explícito, conservación de entradas vacías y detección de duplicados o contradicciones. Debe mantenerse como prueba de regresión prioritaria. Nunca resolver un conflicto asignando un importe vecino o por semejanza visual.

### 17.5 Coordenadas faltantes o incorrectas

Se observaron comentarios de IA sin región, regiones fuera de rango y marcadores agrupados en un borde. La solicitud de coordenadas y la conversión se corrigieron recientemente. Se validó una pieza y luego la usuaria volvió a correr el conjunto.

Queda pendiente evaluar el conjunto completo, distinguir ausencia real de elemento de errores de ubicación, medir precisión y evitar que fallos de localización hagan perder conclusiones válidas innecesariamente. Un aviso de vinculación documental no tiene una zona visual que localizar.

### 17.6 Revisión parcial por causas diferentes

La etiqueta Revisión incompleta agrupa hoy varias situaciones: referencia no asociada, documento contradictorio o evidencia insuficiente. No son equivalentes y requieren acciones distintas.

La arquitectura debe separar calidad de entrada, cobertura de controles, estado técnico y dictamen visual. Debe explicar qué se analizó realmente y qué intervención falta. Un error de nuestro parser no debe trasladarse al equipo como si la gráfica incumpliera una regla.

### 17.7 Plantilla demasiado específica

El sistema procesa esta estructura con posiciones y expresiones fijas. No basta registrar otra carpeta para garantizar que toda matriz de otro proyecto se interprete correctamente.

Debe definirse un contrato de plantilla, versiones de esquema y un mecanismo de mapeo o configuración validado. La ausencia de una celda fija no demuestra que el cliente no haya pedido algo en otra ubicación o redacción.

### 17.8 Persistencia humana incompleta

Las decisiones y comentarios humanos locales no cumplen todavía un flujo de trabajo durable entre personas, sesiones y dispositivos. Se necesitan entidades persistidas, permisos, autores, fecha, control de concurrencia y trazabilidad, manteniendo la UI aprobada.

### 17.9 Identidad creativa y versiones

Hoy el nombre del archivo es la identidad visible y el adaptador muestra una sola versión. Hace falta resolver cómo una corrección, renombrado, archivo reemplazado, slide o duplicado se vincula a la misma pieza sin mezclar aprobaciones ni perder historial.

### 17.10 Medición y observabilidad

Hay duración y tokens por intento, pero faltan tiempos completos de preparación, cola, primer resultado y corrida, cobertura de reglas y localización. Los cinco segundos del localizador no son un benchmark del sistema.

Las pruebas automatizadas actuales cubren cola, fallback, precios, Stories, imágenes y ubicaciones, pero no sustituyen una evaluación contra piezas revisadas por personas.

### 17.11 Caso original de CTA de descarga

El caso que motivó una observación real desde los primeros ejemplos es la pieza Descargas, Domicilio, 10 presas, 22 de octubre, tanto en el Post como en su adaptación Story cuando les corresponde el mismo criterio de pedido.

`PRODUCCION!P16` exige un CTA orientado a descargar la aplicación para nuevos usuarios en las ofertas pertinentes de Express y Domicilio. La pieza Post muestra `A DOMICILIO POR KFC APP`, que comunica el canal de pedido, pero no expresa una invitación a descargar. El CSV referencia `CTA_10PRESAS.ai`, lo cual no demuestra que el asset cumpla la instrucción de descarga.

La observación debe contrastar el criterio del cliente con ese texto visible y pedir revisión del CTA, salvo que exista una excepción aprobada. Debe conservar las referencias del pedido y marcar la región del cierre que realmente aparece. No debe concluir que toda mención a KFC App equivale automáticamente a un CTA de descarga ni que una referencia de asset es evidencia de su contenido.

En las primeras maquetas hubo comentarios y estados escritos manualmente. Las gráficas proporcionadas por la usuaria son reales, pero esos comentarios iniciales no deben confundirse con el resultado persistido de las corridas actuales. El sistema operativo debe identificar el método y la corrida de cada observación.

## 18 Reglas de confiabilidad que debe respetar la arquitectura

1. Separar fuente original, dato interpretado, vínculo confirmado y resultado de revisión.
2. Conservar la trazabilidad hasta documento, versión, hoja, celda y numeral cuando existe.
3. No reemplazar el pedido por lo que dice el CSV ni por lo que se ve en la imagen.
4. No usar la imagen como única justificación para decidir cuál era el precio esperado.
5. No asignar valores por posición de listas después de eliminar vacíos.
6. No bloquear toda la pieza si solo un requisito es ambiguo y otros son verificables.
7. No llamar incumplimiento visual a un aviso de calidad documental.
8. No considerar que la falta de un requisito equivale a que el cliente exigió su ausencia.
9. No declarar una verificación que no se ejecutó ni una aprobación humana inexistente.
10. Registrar qué controles fueron deterministas, cuáles pasaron por modelo y cuáles se omitieron.
11. Reutilizar procesamiento por versión y no por coincidencia informal de nombre.
12. Hacer idempotentes importaciones, solicitudes de corrida y preparación de imágenes.
13. Evitar resultados duplicados al reintentar o recibir callbacks repetidos.
14. Mantener resultados anteriores y contexto de análisis para reproducibilidad.
15. No permitir que una revisión vieja se muestre como vigente cuando cambia su imagen o pedido.
16. Conservar el resultado de IA aunque alguien resuelva la conversación. Resolver un comentario no vuelve a analizar ni aprueba la pieza.
17. Conservar aprobación humana por versión. Una nueva entrega no la hereda automáticamente.
18. No prometer que un LLM nunca se equivocará. Reducir el riesgo mediante contratos, controles deterministas, validaciones, evidencia y revisión humana.

## 19 Seguridad y límites de acceso actuales

- Las funciones públicas de QA comprueban un usuario autenticado y su perfil `super_admin`.
- Se excluyen usuarios con rol externo.
- El frontend y las rutas verifican acceso, además del backend.
- La ruta de medios comprueba campaña activa, archivo, versión y pertenencia al snapshot antes de servir imágenes preparadas.
- Los archivos privados se sirven con autorización. No debe exponerse un token de Google al cliente.
- El acceso de lectura a Drive pertenece a la cuenta de servicio, mientras que el acceso de una persona a la aplicación depende de sus permisos de la plataforma.
- Actualmente los super_admin internos autorizados consultan las campañas activas. No existe un ACL de campaña completo para revisores de distintos clientes o agencias.
- La UI y el proxy de medios tienen restricciones por `NODE_ENV === development`. El paso a producción requiere diseñar su habilitación explícita y sus controles, no quitar la protección de forma incidental.
- La carpeta original de Drive y todas sus subcarpetas deben permanecer sin cambios.

La solicitud de crear este documento no autoriza cambiar permisos, activar producción, sincronizar archivos o ejecutar análisis.

## 20 Limpieza de pruebas y conservación de datos

Durante las pruebas la usuaria pidió vaciar exclusivamente los datos de IA en Dev para repetir las corridas. En la última limpieza anterior a su nueva prueba se eliminaron 61 revisiones y una corrida de `qaVisualReviews` y `qaVisualRuns`.

Se conservaron campañas, documentos, requisitos, snapshots, piezas procesadas, imágenes preparadas y reglas. Después la usuaria volvió a ejecutar el análisis. No debe asumirse que esas tablas siguen vacías.

Esta operación fue una limpieza expresa de pruebas. El producto normal necesita historial y no debe borrar corridas automáticamente para reanalizar. Tampoco debe borrar tareas, datos ajenos a QA, imágenes compartidas con snapshots o documentos fuente por eliminar resultados de IA.

Las estructuras internas del componente de workflow tienen su propio ciclo de vida. No deben vaciarse globalmente si también las usan otras funcionalidades.

## 21 Criterios de aceptación para evaluar la arquitectura

| Caso | Resultado esperado |
| --- | --- |
| Agregar una URL válida y compartida | Se registra la campaña y comienza la importación sin modificar Drive. |
| URL inválida o carpeta sin permisos | Error claro sin crear un registro operativo inválido. |
| Misma carpeta registrada dos veces | Se informa la duplicación. No hay dos campañas activas para esa carpeta. |
| Dos campañas con archivos de igual nombre | Sus datos y revisiones permanecen separados. |
| Recargar editor o abrir Detalles | Se leen datos procesados de Convex, sin volver a interpretar Excel y CSV. |
| Actualizar sin cambios | Se reutilizan documentos y snapshot compatibles. |
| Actualizar con fuentes nuevas | Se publica una importación consistente y se identifica qué análisis quedó desactualizado. |
| Cambiar el algoritmo de extracción | La versión de procesamiento invalida el snapshot defectuoso aunque Drive no haya cambiado. |
| Originales pesados | La lista carga WebP y el centro usa la imagen de análisis guardada. |
| Analizar campaña | Máximo cuatro piezas simultáneas por corrida y resultados visibles al terminar cada una. |
| Una pieza o proveedor falla | Se mantienen resultados parciales del lote, se reintenta según política y se informa el error terminal. |
| Reintentar una pieza | Se conserva la revisión anterior y solo se programa la selección solicitada. |
| Cliente no exige CTA | El control queda No aplica sin volver incompleta la pieza por esa ausencia. |
| Cliente exige CTA de descarga y aparece un cierre genérico | El modelo compara el criterio real, explica la diferencia y señala el cierre visible. |
| Story con oferta en una fila que debería estar vacía | Se analiza la imagen y aparece un aviso de documento por pieza. |
| `FESTIN LOCURA` frente a `FESTIN DE LOCURA` | Con equivalencia validada y coincidencia única, se analiza y se informa la discrepancia de nombre. |
| Precio 1 vacío y precio 2 con $5,99 | Se conserva el vacío 1 y se vincula $5,99 únicamente con oferta 2. |
| Dos precios con el mismo numeral | Se informa conflicto sin inventar un importe. |
| Precio diferente entre Excel y CSV | Ambos valores y fuentes son visibles. No se usa uno silenciosamente. |
| Un único fallo de vinculación afecta tres controles | Un aviso explica causa y alcance sin repetir la lista completa en los tres campos. |
| Hallazgo sobre una región visible | Marcador y rectángulo quedan sobre el texto correcto con zoom y cambios de tamaño. |
| Aviso solo documental | Se muestra como comentario general y no inventa una zona de la gráfica. |
| Clic en marcador | Se abre el comentario derecho, se muestra sin filtro incompatible y se realza brevemente. |
| Flechas de teclado | Se recorre la lista filtrada sin interferir con escritura ni controles. |
| Aprobación humana | Se aplica a pieza y versión, conserva autor y justificación y no muestra spinner de análisis. |
| Recargar tras comentar o aprobar | En la solución completa, la actividad debe seguir disponible en Convex. Hoy es una brecha. |
| Nueva versión de una pieza | No hereda la aprobación anterior y conserva la historia. |
| Toda la corrida llega a 100 % | Se distinguen aprobadas, hallazgos, parciales y errores. No se equipara terminar con aprobar. |
| Tema claro y oscuro | Ambos conservan jerarquía, contraste, marcadores y diseño aprobado. |

## 22 Decisiones fundamentales que siguen abiertas

Estas preguntas deben guiar el diseño y la reunión con el equipo. No autorizan a inventar políticas comerciales.

### 22.1 Prioridad alta

1. **Interpretación de discrepancias documentales.** Qué equivalencias pueden aprobarse automáticamente y cuáles requieren una decisión humana. Cómo registrar esa decisión y su alcance.
2. **Fuentes contradictorias.** Quién resuelve conflictos entre PRODUCCION, LEYENDA, REGLAS, CSV y aclaraciones externas. Cómo se versiona la aclaración sin modificar el original.
3. **Plantillas admitidas.** Si todas las campañas usan la misma estructura y cómo reconocer otra versión de plantilla antes de procesarla incorrectamente.
4. **Cobertura mínima para validar.** Qué controles deben haberse ejecutado para mostrar Validada por IA. Cómo comunicar resultados mixtos o revisiones solo técnicas.
5. **Identidad de piezas y versiones.** Cómo reconocer entregas corregidas, renombrados, Slides de carrusel y reemplazos de archivos en Drive.
6. **Permisos de operación.** Qué personas podrán analizar, comentar, solicitar cambios, resolver hallazgos, confirmar vínculos y aprobar cuando se amplíe el acceso más allá de super_admin.
7. **Aprobación con excepción.** Si una persona puede aprobar con revisión incompleta o error técnico, con qué autoridad y qué información debe quedar registrada.
8. **Alcance de controles visuales.** Qué referencias aprobadas existen para logos, producto, legales, composición y assets. Hoy no todos esos controles están implementados.
9. **Producción.** Cómo habilitar QA fuera de development, separar entornos y credenciales, proteger acceso entre campañas y establecer límites de consumo.

### 22.2 Preguntas adicionales

- Qué significa exactamente cada fase comercial y cómo condiciona el CTA.
- Si HOY y una fecha específica son variantes separadas y qué equivalencias temporales son aceptables.
- Cómo tratar Stories y herencia de ofertas si alguna plantilla realmente la requiere.
- Cómo interpretar `VERSIONES` y si cuenta creatividades, adaptaciones, archivos o slides.
- Cómo agrupar y revisar carruseles, dado que la documentación inicial observó ofertas y cantidad de slides sin una distribución inequívoca.
- Si se necesita inventario de entregables faltantes y cuáles están fuera del alcance inicial por ser video o animación.
- Si habrá sincronización automática futura con Drive o seguirá siendo una actualización manual. Actualmente existe importación al registrar y actualización manual.
- Política de retención de originales, copias preparadas, snapshots y corridas.
- Qué notificaciones o exportaciones de resultados se necesitan.
- Cómo medir falsos positivos, omisiones, precisión de coordenadas y calidad de equivalencias de nombres.
- Presupuesto de llamadas, límite de campañas simultáneas, cancelación y pausa de corridas. No hay una UI completa de pausa o cancelación actual.
- Si se requiere un modo de revisión de la importación antes de autorizar el análisis.
- Si los archivos de Drive están en Mi unidad o en unidades compartidas y qué políticas de acceso aplica la organización.

## 23 Qué debe proponer el LLM que diseñe la arquitectura

La propuesta debe partir de los requisitos de la usuaria y reconocer qué partes del código pueden conservarse. Debe cubrir:

1. Límites del módulo QA dentro de `agent-core-new`, sin acoplarlo a tareas ni cambiar otras lógicas.
2. Entidades, tablas, relaciones, índices y Storage, diferenciando datos originales, interpretados, confirmados y revisados.
3. Identidad y versiones de campaña, documentos, pieza, archivo, reglas, importación y análisis.
4. Contratos de importación y validación de Excel y CSV, con procedencia de cada campo.
5. Normalización y vinculación robusta, con equivalencias, ambigüedades y correcciones humanas auditables.
6. Separación entre avisos documentales, errores técnicos y hallazgos visuales.
7. Orquestación, concurrencia, idempotencia, reintentos, fallback, recuperación y límites globales.
8. Publicación progresiva y contratos de datos para la UI ya aprobada.
9. Modelo persistido de comentarios, respuestas, regiones, anotaciones, resolución y decisiones humanas.
10. Conservación de evidencia y reproducibilidad del análisis.
11. Ciclo de vida de miniaturas, imagen de análisis y acceso privado al original.
12. Permisos actuales y evolución a usuarios operativos y aislamiento por campaña o cliente.
13. Migración desde las tablas existentes y corrección de snapshots defectuosos sin borrar historia productiva.
14. Pruebas unitarias, de integración, de UI y evaluación con piezas reales revisadas por personas.
15. Métricas, costos, alertas y criterios para considerar listo el paso a producción.
16. Plan de implementación por etapas y criterios verificables de aceptación, preservando el diseño.

La propuesta debe explicar decisiones y alternativas cuando cambien semántica o trazabilidad. No debe limitarse a agregar prompts, ocultar comentarios repetidos o eliminar estados incómodos para que la interfaz parezca correcta.

## 24 Mapa de implementación para consultar el código

Las rutas siguientes son relativas a la raíz de `agent-core-new`, proyecto hermano de esta carpeta de documentación.

| Área | Archivos principales |
| --- | --- |
| Página de campañas y editor | `app/workspace/qa-visual/page.tsx`, `[campaignId]/page.tsx`, `layout.tsx`. |
| Layout de la aplicación | `app/components/qa-visual/QaWorkspace.tsx`, `app/components/WorkspaceLayout.tsx`. |
| Campañas | `app/components/qa-visual/campaigns/CampaignsPage.tsx`, `CampaignForm.tsx`, `CampaignCard.tsx`. |
| Composición del editor | `app/components/qa-visual/QaViewer.tsx`. |
| Campaña e inventario | `app/components/qa-visual/campaign/CampaignHeader.tsx`, `FilesPanel.tsx`, `CampaignSnapshotViewer.tsx`. |
| Detalles y revisión humana | `app/components/qa-visual/piece/PieceDetails.tsx`, `PiecePanel.tsx`, `ReviewDialogs.tsx`, `review-status.tsx`. |
| Comentarios e imagen | `app/components/qa-visual/comments`, `viewer/ReviewCanvas.tsx`, `CanvasCommentMarkers.tsx`. |
| Estado de la sesión | `app/hooks/qa-visual/use-review-session.ts`, `use-review-decisions.ts`, `use-canvas-annotations.ts`. |
| Suscripción de análisis | `app/hooks/qa-visual/use-agent-analysis.ts`. |
| Atajos | `app/hooks/qa-visual/use-piece-keyboard-navigation.ts`. |
| Adaptación de resultados | `app/lib/qa-visual/analysis-feed.ts`, `review-state.ts`, `piece-inventory.ts`. |
| CSV | `app/lib/qa-visual/production-csv.ts`. |
| Temas y diseño | `app/components/qa-visual/review.css`, `app/contexts/ThemeContext.tsx`, estilos existentes de la aplicación. |
| Backend y schema | `convex/qaVisual/tables.ts`, `validators.ts`, inclusión en `convex/schema.ts`. |
| Permisos | `convex/qaVisual/access.ts`, `app/lib/qa-visual/server/access.ts`, perfil de acceso existente. |
| Drive | `convex/qaVisual/driveClient.ts`, `driveSource.node.ts`, `drive.ts`. |
| Registro e importación | `convex/qaVisual/campaignRegistration.ts`, `campaigns.ts`, `campaignSync.ts`, `campaignSnapshots.ts`. |
| Originales y celdas | `convex/qaVisual/documents.ts`. |
| Requisitos y vinculación | `convex/qaVisual/clientMatrix.node.ts`, `analysisInput.node.ts`. |
| Imágenes | `convex/qaVisual/imageCopies.ts`, `imagePreparation.node.ts`, `preview.node.ts`, `imageWarmup.ts`, `prepareImages.ts`. |
| Servir imágenes | `app/workspace/qa-visual/media/route.ts`, `convex/qaVisual/mediaHttp.ts`. |
| Corridas y progreso | `convex/qaVisual/runs.ts`, `runDispatch.ts`, `stageDriveRun.ts`, `pipeline.ts`. |
| Llamada de evaluación | `convex/qaVisual/worker.ts`. |
| Localización | `convex/qaVisual/commentLocations.ts`, `commentLocalization.ts`. |
| Configuración compartida de modelos | `convex/lib/llmFallback.ts`. |
| Pruebas de regresión | `tests/qaVisualPrices.test.ts`, `qaVisualStories.test.ts`, `qaVisualPilot.test.ts`, `qaVisualMedia.test.ts`, `qaVisualCommentLocations.test.ts`, `qaVisualCommentNavigation.test.ts`. |

Los archivos de diseño histórico y las doce capturas de referencia están en este proyecto, en `maqueta` y `capturas`. Los adjuntos iniciales están en `adjuntos`.

La primera prioridad funcional pendiente es que una pieza con referencias recuperables no quede sin revisión por una diferencia menor de nomenclatura. La prioridad arquitectónica es hacer explícito el vínculo entre pedido, interpretación, análisis y decisión humana, con persistencia y evidencia suficientes para que el equipo pueda confiar en cada resultado.
