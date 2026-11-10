# QA Visual

Configurá `QA_VISUAL_GOOGLE_SERVICE_ACCOUNT_JSON` en el despliegue de Convex. Compartí cada carpeta de campaña con la cuenta de servicio como lectora. En **QA Visual → Agregar campaña**, pegá el enlace de la carpeta. Cada campaña queda registrada en `qaVisualCampaigns`. Convex lee la matriz XLSX de `RECURSOS`, el CSV de producción de `EDITABLES` y las imágenes PNG o JPEG de `DESPLIEGUE`.

Al agregar una campaña, Convex importa en segundo plano los originales del Excel y el CSV y guarda el inventario, los campos de producción y los requisitos por pieza. El editor lee la última importación lista. **Actualizar desde Drive** comprueba si las fuentes cambiaron y publica una importación nueva solo cuando termina correctamente.

**Analizar piezas** toma las imágenes en el orden del inventario. La corrida usa los requisitos de la importación que estaba abierta. Convex prepara las imágenes para análisis y ejecuta el workflow existente. **Reintentar fallidas** vuelve a tomar las piezas con error de la última ejecución.

Las reglas parten de las hojas `PRODUCCION`, `LEYENDA` y `REGLAS`. Para agregar referencias aprobadas por pieza, el despliegue también admite un JSON opcional en `QA_VISUAL_RULES_JSON`, limitado a la carpeta que se indique en `QA_VISUAL_GOOGLE_FOLDER_ID` con la estructura `{"rules":[{"id":"cta","criterion":"Criterio de revisión","source":"REGLAS!B12","severity":"warning","expectedByPiece":{"pieza.png":"Texto esperado"}}]}`. Usá el nombre completo del archivo o el nombre sin extensión como clave. Al cambiar las fuentes o reglas, usá **Actualizar desde Drive** para aplicar los cambios.

La acción interna `qaVisual/mediaHttp:probe` verifica la lectura y el procesamiento de una campaña. Ejecutala en Convex Dev con `{"folderUrl":"https://drive.google.com/drive/folders/ID"}` para comprobar la conexión.
