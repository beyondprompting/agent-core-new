import type { ClientRequirement } from "./review-model";
import type { ProductionFields } from "./production-csv";

export type QaFile = { name: string; bytes: number; updatedAt: number };
export type QaPieceFile = QaFile & {
  driveId: string;
  driveVersion: string;
  contentHash?: string;
  createdAt?: number;
  mimeType?: string;
};
export type QaInventory = {
  campaignName?: string;
  matrix: QaFile | null;
  csv: QaFile | null;
  pieces: (QaPieceFile & {
    thumbnailReady?: boolean;
    imageError?: string;
    client?: import("../../../convex/qaVisual/clientReview").PieceClientStatus | null;
    pieceId?: import("../../../convex/_generated/dataModel").Id<"qaVisualPieces">;
    pieceVersionId?: import("../../../convex/_generated/dataModel").Id<"qaVisualPieceVersions">;
    currentVersion?: number;
    versions?: number;
    openThreads?: number;
    threadCount?: number;
    humanStatus?: import("./review-model").PieceStatus;
  })[];
  notices: string[];
  ignoredFiles?: { name: string; reason: string }[];
  missingImages?: { key: string; csvLine: number }[];
  clientRequirements?: Record<string, ClientRequirement[]>;
  production?: Record<string, ProductionFields>;
};
