import { notFound } from "next/navigation";
import { ClientReview } from "@/app/components/qa-visual/client/ClientReview";

export default async function ClientCampaignPage({
  params,
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  if (!/^[a-z0-9]{10,64}$/i.test(campaignId)) notFound();
  return <ClientReview campaignId={campaignId} />;
}
