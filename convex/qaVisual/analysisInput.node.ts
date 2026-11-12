import { createHash } from "node:crypto";
import { z } from "zod";
import { parseClientMatrix, matrixReviewData } from "./clientMatrix.node";
import { ANALYSIS_POLICY_VERSION } from "./model/contracts";
import type { LinkOverride, Requirement } from "./model/contracts";
import { pieceKey } from "./model/normalize";
import type { QaInventory } from "../../app/lib/qa-visual/source";

const confirmedRules = z.object({
  rules: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/),
        criterion: z.string().min(1).max(500),
        source: z.string().min(1).max(300),
        severity: z.enum(["warning", "blocking"]),
        expectedByPiece: z.record(z.string(), z.string().min(1).max(800)),
      }),
    )
    .max(20),
});

const baseline = [
  {
    id: "format",
    criterion: "Verificar el formato real del archivo.",
    source: "Excel · FORMATO",
    severity: "blocking",
  },
  {
    id: "dimensions",
    criterion: "Comparar dimensiones reales con las declaradas.",
    source: "Excel · dimensiones",
    severity: "blocking",
  },
  {
    id: "product",
    criterion:
      "Verificar el nombre del producto visible contra la oferta solicitada en la matriz.",
    source: "Excel · OFERTA DE VALOR",
    severity: "warning",
  },
  {
    id: "price",
    criterion:
      "Verificar el importe promocional visible. Admitir coma o punto decimal equivalentes y ceros finales.",
    source: "Excel · PVP",
    severity: "blocking",
  },
  {
    id: "date",
    criterion: "Verificar la vigencia visible contra la referencia confirmada.",
    source: "Matriz o aclaración aprobada · vigencia",
    severity: "warning",
  },
  {
    id: "cta",
    criterion:
      "Verificar el llamado a la acción visible contra el texto o criterio confirmado.",
    source: "Matriz o aclaración aprobada · CTA",
    severity: "warning",
  },
] as const;

function digest(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function driveReviewKey(folderId: string) {
  return digest(["google-drive", folderId]);
}

export function confirmedRulesConfig(folderId: string) {
  return folderId === process.env.QA_VISUAL_GOOGLE_FOLDER_ID?.trim()
    ? process.env.QA_VISUAL_RULES_JSON
    : undefined;
}

export function prepareAnalysisInputs(
  folderId: string,
  inventory: QaInventory,
  matrix?: Awaited<ReturnType<typeof parseClientMatrix>>,
  overrides: LinkOverride[] = [],
) {
  const config = confirmedRulesConfig(folderId);
  const confirmed = config
    ? confirmedRules.parse(JSON.parse(config)).rules
    : [];
  const rulesById = new Map<
    string,
    Omit<(typeof confirmed)[number], "expectedByPiece">
  >(baseline.map((rule) => [rule.id, rule]));
  const confirmedById = new Map(
    confirmed.map((rule) => [rule.id, rule.expectedByPiece]),
  );
  if (
    confirmedById.size !== confirmed.length ||
    confirmedById.has("dimensions")
  ) {
    throw new Error(
      "Las reglas confirmadas contienen IDs duplicados o reservados.",
    );
  }
  for (const { expectedByPiece: _, ...rule } of confirmed)
    rulesById.set(rule.id, rule);
  const rules = [...rulesById.values()];
  if (rules.length > 20)
    throw new Error("El conjunto supera las 20 reglas admitidas.");
  const ruleVersion = digest({ rules, policy: ANALYSIS_POLICY_VERSION });
  const inputs = inventory.pieces.map((file) => {
    const stem = file.name.replace(/\.[^.]+$/, "");
    const production = inventory.production?.[pieceKey(file.name)];
    const { requirements, issues } = matrixReviewData(
      matrix,
      file.name,
      production,
      overrides,
    );
    for (const [id, perPiece] of confirmedById) {
      const value = perPiece[file.name] ?? perPiece[stem];
      const issueId = `confirmed_value_missing:${id}`;
      const entry: Requirement = {
        ruleId: id,
        status: value ? "ready" : "unresolved",
        basis: "client",
        ...(value ? { expected: value } : {}),
        sources: [
          { file: "override", text: value ?? rulesById.get(id)!.source },
        ],
        issueIds: value ? [] : [issueId],
      };
      if (!value)
        issues.push({
          id: issueId,
          code: "confirmed_value_missing",
          severity: "warning",
          scope: "piece",
          affects: [id],
          message: `La regla confirmada «${id}» no tiene una referencia para esta pieza.`,
          sources: entry.sources,
        });
      const index = requirements.findIndex((r) => r.ruleId === id);
      if (index < 0) requirements.push(entry);
      else requirements[index] = entry;
    }
    const requirementsHash = digest({
      requirements,
      issues,
      rules: rules.filter((r) => requirements.some((q) => q.ruleId === r.id)),
    });
    const contentHash =
      file.contentHash ?? `${file.driveId}:${file.driveVersion}`;
    return {
      name: file.name,
      revision: file.updatedAt,
      contentHash,
      ...(production ? { production } : {}),
      requirements,
      issues,
      requirementsHash,
      policyVersion: ANALYSIS_POLICY_VERSION,
      contextKey: digest({
        contentHash,
        requirementsHash,
        policyVersion: ANALYSIS_POLICY_VERSION,
      }),
    };
  });
  return { ruleVersion, rules, inputs, matrix };
}
