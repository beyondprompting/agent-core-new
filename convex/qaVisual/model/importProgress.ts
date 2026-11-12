import { v } from "convex/values";

export const importStages = [
  "listing",
  "downloading",
  "reading",
  "linking",
  "publishing",
] as const;
export const importStage = v.union(
  ...importStages.map((stage) => v.literal(stage)),
);
export const importStageLabels = [
  "Listado",
  "Descarga",
  "Lectura",
  "Vinculando pedido",
  "Publicación",
];
