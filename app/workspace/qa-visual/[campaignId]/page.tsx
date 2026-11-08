import { notFound } from "next/navigation";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { canAccessQa } from "@/app/lib/qa-visual/server/access";
import { QaViewer } from "@/app/components/qa-visual/QaViewer";

export default async function CampaignEditorPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  if (campaignId.length > 128 || !(await canAccessQa())) notFound();
  const token = await convexAuthNextjsToken();
  if (!token) notFound();

  let data;
  try {
    data = await fetchAction(api.qaVisual.drive.viewer, { campaignId }, { token });
  } catch (error) {
    console.error("QA Visual: no se pudo abrir la campaña", error);
    return (
      <QaViewer
        campaignId={campaignId}
        inventory={{
          matrix: null,
          csv: null,
          pieces: [],
          notices: ["No se pudo abrir la campaña. Intentá actualizar desde Drive."],
        }}
      />
    );
  }
  if (!data) notFound();
  const { inventory, production, requirements, analysis, analysisError } = data;
  return (
    <QaViewer
      campaignId={campaignId}
      inventory={{
        ...inventory,
        production: Object.fromEntries(production),
        clientRequirements: Object.fromEntries(requirements),
      }}
      analysis={analysis}
      analysisError={analysisError}
    />
  );
}
