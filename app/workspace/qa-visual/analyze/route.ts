import { createHash } from "node:crypto";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { fetchAction, fetchMutation } from "convex/nextjs";
import sharp from "sharp";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import { canAccessLocalQa } from "@/app/lib/qa-visual/server/access";
import { localQaSource } from "@/app/lib/qa-visual/server/local-source";
import { prepareAnalysisInputs } from "@/app/lib/qa-visual/server/analysis-input";

export const runtime = "nodejs";

const requestSchema = z.object({
  requestId: z.string().uuid(),
  kind: z.enum(["batch", "piece", "retry"]),
  names: z.array(z.string().min(1).max(500)).max(200).optional(),
});

async function prepareImage(
  source: ReturnType<typeof localQaSource>,
  name: string,
  revision: number,
) {
  const original = await source.readPiece(name, revision);
  if (!original) return undefined;
  const image = sharp(original.bytes, { limitInputPixels: 32_000_000 });
  const { width, height, format, orientation } = await image.metadata();
  if (!width || !height || !format) return undefined;
  let bytes = await image
    .clone()
    .rotate()
    .resize({
      width: 1800,
      height: 1800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 88 })
    .toBuffer();
  if (bytes.length > 700_000) {
    bytes = await image
      .rotate()
      .resize({
        width: 1400,
        height: 1400,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 76 })
      .toBuffer();
  }
  if (bytes.length > 750_000) return undefined;
  return {
    bytes: Uint8Array.from(bytes).buffer,
    snapshot: {
      hash: createHash("sha256").update(original.bytes).digest("hex"),
      width: orientation && orientation >= 5 ? height : width,
      height: orientation && orientation >= 5 ? width : height,
      format,
    },
  };
}

export async function POST(request: Request) {
  if (!(await canAccessLocalQa())) return new Response(null, { status: 404 });
  if (request.headers.get("origin") !== new URL(request.url).origin)
    return new Response(null, { status: 403 });
  const token = await convexAuthNextjsToken();
  if (!token) return new Response(null, { status: 401 });
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Solicitud de análisis inválida." },
      { status: 400 },
    );
  const root = process.env.QA_VISUAL_LOCAL_ROOT;
  if (!root)
    return Response.json(
      { error: "Falta configurar la carpeta de la campaña." },
      { status: 400 },
    );
  const { kind, requestId, names } = parsed.data;
  const source = localQaSource(root);
  const options = { token };
  try {
    const { campaign, ruleVersion, rules, inputs, matrix } =
      await prepareAnalysisInputs(root, await source.list());
    const namesSet = new Set(names);
    const selected =
      kind === "batch"
        ? inputs
        : inputs.filter((item) => namesSet.has(item.name));
    if (
      !selected.length ||
      selected.length > 200 ||
      (kind !== "batch" && selected.length !== namesSet.size) ||
      (kind === "piece" && selected.length !== 1)
    ) {
      return Response.json(
        {
          error:
            "La selección ya no coincide con el inventario. Actualizá la página.",
        },
        { status: 400 },
      );
    }
    if (!matrix)
      return Response.json(
        { error: "Falta el Excel del cliente en RECURSOS." },
        { status: 400 },
      );
    const sourceDocumentId = await fetchAction(
      api.qaVisual.importMatrix.sync,
      {
        campaign,
        name: matrix.name,
        hash: matrix.hash,
        mappingVersion: ruleVersion,
        base64: matrix.bytes.toString("base64"),
        cells: matrix.cells,
        pieces: inputs.map(({ name, requirements }) => ({
          name,
          requirements,
        })),
      },
      options,
    );
    const run = await fetchMutation(
      api.qaVisual.runs.start,
      {
        campaign,
        ruleVersion,
        sourceDocumentId,
        rules,
        inputs: selected,
        kind,
        requestId,
      },
      options,
    );
    if (run.ids.length) {
      // Stage four previews at a time to limit memory on the local server.
      for (let index = 0; index < run.ids.length; index += 4) {
        await Promise.allSettled(
          run.ids.slice(index, index + 4).map(async (reviewId, offset) => {
            const item = selected[index + offset];
            const image = await prepareImage(
              source,
              item.name,
              item.revision,
            ).catch(() => undefined);
            await fetchAction(
              api.qaVisual.worker.stage,
              { reviewId, ...(image ? { image } : {}) },
              options,
            );
          }),
        );
      }
      await fetchMutation(
        api.qaVisual.runs.finishPreparation,
        { runId: run.runId },
        options,
      );
    }
    return Response.json({ runId: run.runId });
  } catch (error) {
    console.error("QA Visual: no se pudo preparar la ejecución", error);
    return Response.json(
      {
        error:
          "No se pudo iniciar el análisis. Revisá la conexión y la configuración de la campaña.",
      },
      { status: 503 },
    );
  }
}
