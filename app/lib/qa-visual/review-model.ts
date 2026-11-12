export type ReviewNotice = {
  id: string;
  message: string;
  source: string;
};

export type ClientRequirement =
  import("../../../convex/qaVisual/model/contracts").Requirement;
export type ReviewIssue =
  import("../../../convex/qaVisual/model/contracts").Issue;
export type AiReviewStatus =
  | "stale"
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
  originalImage?: string;
  thumbnail?: string;
  campaign: string;
  formatName: string;
  productionLinked: boolean;
  clientRequirements?: ClientRequirement[];
  platform?: string;
  extension?: string;
  format: string;
  phase: string;
  status: PieceStatus;
  versions: number;
  openThreads?: number;
  threadCount?: number;
  currentVersion?: number;
  pieceId?: import("../../../convex/_generated/dataModel").Id<"qaVisualPieces">;
  pieceVersionId?: import("../../../convex/_generated/dataModel").Id<"qaVisualPieceVersions">;
  channel: string;
  width: number;
  height: number;
  product: string;
  price: string;
  validity: string;
  cta: string;
};

export type Comment = {
  id: number | string;
  marker?: number;
  pieceId: string;
  version: number;
  author: string;
  role: string;
  kind: "agent" | "human" | "source";
  time: string;
  body: string;
  severity?: "warning" | "blocking" | "success";
  historical?: boolean;
  threadId?: import("../../../convex/_generated/dataModel").Id<"qaVisualThreads">;
  finding?: {
    reviewId: import("../../../convex/_generated/dataModel").Id<"qaVisualReviews">;
    ruleId: string;
  };
  issue?: ReviewIssue;
  anchor?: import("../../../convex/qaVisual/model/collaboration").Anchor;
  replies?: {
    id: string;
    body: string;
    author: string;
    time: string;
    canEdit: boolean;
    event?: string;
  }[];
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
