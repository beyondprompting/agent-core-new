import type { QaInventory } from "@/app/lib/qa-visual/source";
import { notFound } from "next/navigation";
import { canAccessLocalQa } from "@/app/lib/qa-visual/server/access";
import { localQaSource } from "@/app/lib/qa-visual/server/local-source";
import { prepareAnalysisInputs } from "@/app/lib/qa-visual/server/analysis-input";
import { QaViewer } from "@/app/components/qa-visual/QaViewer";

export default async function QaVisualPage() {
  if (!(await canAccessLocalQa())) notFound();
  const root = process.env.QA_VISUAL_LOCAL_ROOT;
  const inventory: QaInventory = root
    ? await localQaSource(root).list()
    : {
        matrix: null,
        csv: null,
        pieces: [],
        notices: ["Falta configurar la carpeta local de QA Visual."],
      };
  let analysis;
  let analysisError;
  if (root && inventory.pieces.length) {
    try {
      const { campaign, inputs } = await prepareAnalysisInputs(root, inventory);
      const byName = new Map(
        inputs.map((item) => [item.name, item.requirements]),
      );
      inventory.clientRequirements = Object.fromEntries(byName);
      analysis = {
        campaign,
        inputs: inputs.map(({ name, contextKey }) => ({ name, contextKey })),
      };
    } catch (error) {
      console.error("QA Visual: configuración de análisis inválida", error);
      analysisError =
        "No se pudieron preparar las reglas de análisis. Revisá la configuración.";
    }
  }
  return (
    <QaViewer
      inventory={inventory}
      analysis={analysis}
      analysisError={analysisError}
    />
  );
}
