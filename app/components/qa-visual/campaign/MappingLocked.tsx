import Link from "next/link";
import { ArrowLeft, FileSpreadsheet } from "lucide-react";
import "../review.css";
import "../gallery.css";

/**
 * §5.5: the editor of a new campaign stays closed until every piece is linked to its CSV row
 * and its order in the matrix, or excluded. It is resolved from the campaign list.
 */
export function MappingLocked({
  campaignName,
  unmapped,
}: {
  campaignName: string;
  unmapped: number;
}) {
  return (
    <main className="qa-visual qa-mapping-locked">
      <section role="alert">
        <FileSpreadsheet size={28} aria-hidden />
        <h1>{campaignName}: hay que resolver el mapeo de piezas</h1>
        <p>
          {unmapped}{" "}
          {unmapped === 1
            ? "pieza no se puede vincular"
            : "piezas no se pueden vincular"}{" "}
          con su fila del CSV o con su pedido en la matriz. Sin ese vínculo no
          se sabe contra qué revisarlas, así que el editor se habilita cuando
          todas estén vinculadas o excluidas del análisis.
        </p>
        <p>
          En la lista de campañas, usá <b>Resolver mapeo</b>: vas a ver qué
          falla, cómo corregirlo y la opción de corregir el CSV automáticamente.
        </p>
        <Link className="qa-mapping-back" href="/workspace/qa-visual">
          <ArrowLeft size={14} aria-hidden />
          Volver a campañas
        </Link>
      </section>
    </main>
  );
}
