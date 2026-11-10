import { createHash } from "node:crypto";
import { z } from "zod";
import { parseClientMatrix, matrixRequirements } from "./clientMatrix.node";
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
) {
  const config = confirmedRulesConfig(folderId);
  const confirmed = config ? confirmedRules.parse(JSON.parse(config)).rules : [];
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
  const ruleVersion = digest({
    rules,
    confirmed,
    matrixHash: matrix?.hash,
    production: inventory.production,
    names: inventory.pieces.map((file) => file.name),
    extraction: 1,
  });
  const inputs = inventory.pieces.map((file) => {
    const stem = file.name.replace(/\.[^.]+$/, "");
    const production =
      inventory.production?.[stem.normalize("NFC").toLowerCase()];
    const expected: Record<string, string> = {};
    const requirements = matrix
      ? matrixRequirements(matrix, file.name, production)
      : [];
    const matrixLinked = requirements.length > 0;
    for (const requirement of requirements) {
      if (!requirement.pending) expected[requirement.id] = requirement.expected;
    }
    for (const [id, perPiece] of confirmedById) {
      const value = Object.hasOwn(perPiece, file.name)
        ? perPiece[file.name]
        : Object.hasOwn(perPiece, stem)
          ? perPiece[stem]
          : undefined;
      // An overridden criterion needs an explicit expected value for each piece.
      delete expected[id];
      if (value) {
        expected[id] = value;
        const override = {
          id,
          expected: value,
          source: rulesById.get(id)!.source,
        };
        const index = requirements.findIndex((item) => item.id === id);
        if (index < 0) requirements.push(override);
        else requirements[index] = override;
      }
    }
    return {
      name: file.name,
      revision: file.updatedAt,
      ...(production ? { production } : {}),
      expected,
      requirements,
      matrixLinked,
      contextKey: digest({
        reviewPolicy: 2,
        ruleVersion,
        name: file.name,
        size: file.bytes,
        revision: file.updatedAt,
        driveVersion: file.driveVersion,
        production,
      }),
    };
  });
  return { ruleVersion, rules, inputs, matrix };
}
