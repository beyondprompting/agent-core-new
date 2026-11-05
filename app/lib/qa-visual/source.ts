import type { ClientRequirement } from "./review-model";
import type { ProductionFields } from "./production-csv";

export type QaFile = { name: string; bytes: number; updatedAt: number };
export type QaInventory = {
  campaignName?: string;
  matrix: QaFile | null;
  csv: QaFile | null;
  pieces: QaFile[];
  notices: string[];
  clientRequirements?: Record<string, ClientRequirement[]>;
  production?: Record<string, ProductionFields>;
};
export interface QaSource {
  list(): Promise<QaInventory>;
  readPiece(
    name: string,
    expectedRevision?: number,
  ): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null>;
}
