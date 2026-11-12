import { Eye, FileText } from "lucide-react";
import type { QaInventory } from "@/app/lib/qa-visual/source";

export function CampaignResources({ inventory }: { inventory: QaInventory }) {
  return (
    <div className="campaign-tab-content">
      <span className="section-eyebrow">RECURSOS DE LA CAMPAÑA</span>
      <h3>Documentos de referencia</h3>
      <p className="campaign-description">
        Materiales de producción para revisar las piezas de la campaña.
      </p>
      {[
        {
          file: inventory.matrix,
          title: "Matriz de producción",
          description: "XLSX · RECURSOS",
        },
        {
          file: inventory.csv,
          title: "Bajada de producción",
          description: "CSV · EDITABLES",
        },
      ].map(({ file, title, description }) => (
        <div className="resource-card" key={title}>
          <span className="document-icon">
            <FileText size={20} />
          </span>
          <div>
            <strong>{title}</strong>
            <span>{description}</span>
          </div>
          <p>{file?.name ?? "No disponible"}</p>
        </div>
      ))}
      {Boolean(inventory.ignoredFiles?.length) && (
        <section
          className="qa-import-resource-list"
          aria-label="Archivos no analizados"
        >
          <h4>Archivos no analizados</h4>
          <ul>
            {inventory.ignoredFiles?.map((file, index) => (
              <li key={`${file.name}:${index}`}>
                <strong>{file.name}</strong>
                <span>{file.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {Boolean(inventory.missingImages?.length) && (
        <section
          className="qa-import-resource-list"
          aria-label="Entregables sin imagen"
        >
          <h4>Entregables sin imagen</h4>
          <p>
            Estas filas de producción todavía no tienen una imagen en
            DESPLIEGUE.
          </p>
          <ul>
            {inventory.missingImages?.map((row) => (
              <li key={row.key}>
                <strong>{row.key}</strong>
                <span>CSV · línea {row.csvLine}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="info-note">
        <Eye size={16} />
        <span>
          Consulta la matriz para contrastar oferta, vigencia, formato y llamado
          a la acción de cada pieza.
        </span>
      </div>
    </div>
  );
}
