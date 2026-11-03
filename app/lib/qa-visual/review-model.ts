export type AiReviewStatus =
  | "analyzing"
  | "findings"
  | "validated"
  | "partial"
  | "failed";
export type PieceStatus =
  | "En revisión"
  | "Cambios solicitados"
  | "Aprobada"
  | "Pendiente";
export type Piece = {
  id: string;
  name: string;
  filename: string;
  image: string;
  campaign: string;
  formatName: string;
  productionLinked: boolean;
  platform?: string;
  extension?: string;
  format: string;
  phase: string;
  status: PieceStatus;
  versions: number;
  channel: string;
  width: number;
  height: number;
  product: string;
  price: string;
  validity: string;
  cta: string;
};

export type Comment = {
  id: number;
  pieceId: string;
  version: number;
  author: string;
  role: string;
  kind: "agent" | "human";
  time: string;
  body: string;
  severity?: "warning" | "success";
  source?: string;
  expected?: string;
  observed?: string;
  pin?: { x: number; y: number };
  resolved: boolean;
  region?: { x: number; y: number; width: number; height: number };
};

// UI input for future persisted results. Absence of a snapshot is not a verdict.
export type ReviewFeed = {
  results: Readonly<
    Record<string, Readonly<Partial<Record<number, AiReviewStatus>>>>
  >;
  comments: readonly Comment[];
};
export const emptyReviewFeed: ReviewFeed = { results: {}, comments: [] };
