"use client";

import { useMutation, usePreloadedQuery, type Preloaded } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "@/convex/_generated/api";
import { QaViewer } from "../QaViewer";

export function CampaignSnapshotViewer({
  preloaded,
}: {
  preloaded: Preloaded<typeof api.qaVisual.campaignSnapshots.viewer>;
}) {
  const data = usePreloadedQuery(preloaded);
  const refresh = useMutation(api.qaVisual.campaignSnapshots.refresh);
  const prepareImages = useMutation(api.qaVisual.imageWarmup.request);
  const importedSnapshotId = data?.snapshotId;
  const hasPieces = Boolean(data?.pieces.length);

  useEffect(() => {
    if (importedSnapshotId && hasPieces) {
      void prepareImages({ snapshotId: importedSnapshotId }).catch((error) => {
        console.warn("QA Visual: no se pudieron solicitar las miniaturas", error);
      });
    }
  }, [importedSnapshotId, hasPieces, prepareImages]);
  const [requesting, setRequesting] = useState(false);
  const [requestError, setRequestError] = useState<string>();

  if (!data) {
    return <QaViewer
      campaignId=""
      inventory={{ matrix: null, csv: null, pieces: [], notices: ["La campaña ya no está disponible."] }}
    />;
  }

  const { campaignId, snapshotId, pieces, campaignName, matrix, csv, notices, syncing, syncError } = data;

  async function update() {
    setRequesting(true);
    setRequestError(undefined);
    try {
      await refresh({ campaignId });
    } catch {
      setRequestError("No se pudo iniciar la actualización desde Drive.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <QaViewer
      campaignId={campaignId}
      inventory={{
        campaignName, matrix, csv, notices,
        pieces: pieces.map(({ file, thumbnailReady }) => ({ ...file, thumbnailReady })),
        production: Object.fromEntries(pieces.flatMap(({ file, production }) => production
          ? [[file.name.replace(/\.[^.]+$/, "").normalize("NFC").toLowerCase(), production]]
          : [])),
        clientRequirements: Object.fromEntries(pieces.map(({ file, requirements }) => [file.name, requirements])),
      }}
      analysis={snapshotId && pieces.length ? {
        campaignId,
        snapshotId,
        inputs: pieces.map(({ file, contextKey }) => ({ name: file.name, contextKey })),
      } : undefined}
      refreshing={requesting || syncing}
      syncError={requestError ?? syncError}
      onRefresh={() => void update()}
    />
  );
}
