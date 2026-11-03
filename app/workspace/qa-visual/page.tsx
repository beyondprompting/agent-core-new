import { notFound } from "next/navigation";
import { canAccessLocalQa } from "@/app/lib/qa-visual/server/access";
import { localQaSource } from "@/app/lib/qa-visual/server/local-source";
import { QaViewer } from "@/app/components/qa-visual/QaViewer";

export default async function QaVisualPage() {
  if (!(await canAccessLocalQa())) notFound();
  const root = process.env.QA_VISUAL_LOCAL_ROOT;
  const inventory = root
    ? await localQaSource(root).list()
    : { matrix: null, csv: null, pieces: [], notices: ["Falta configurar la carpeta local de QA Visual."] };
  return <QaViewer inventory={inventory} />;
}
