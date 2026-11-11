import type { ClientRequirement } from "./review-model";
import type { ProductionFields } from "./production-csv";

export type QaFile = { name: string; bytes: number; updatedAt: number };
export type QaPieceFile = QaFile & { driveId: string; driveVersion: string };
export type QaInventory = {
  campaignName?: string;
  matrix: QaFile | null;
  csv: QaFile | null;
  pieces: (QaPieceFile & { thumbnailReady?: boolean })[];
  notices: string[];
  clientRequirements?: Record<string, ClientRequirement[]>;
  production?: Record<string, ProductionFields>;
};
