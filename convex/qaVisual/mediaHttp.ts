import { v } from "convex/values";
import { internal } from "../_generated/api";
import { httpAction, internalAction, type ActionCtx } from "../_generated/server";
import type { DriveInspection } from "./driveAnalysis";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

async function openDriveImage(
  ctx: ActionCtx,
  fileArgs: { driveFolderId: string; id: string; version: string },
): Promise<Response> {
  const file = await ctx.runAction(internal.qaVisual.drive.authorizeMedia, fileArgs);
  if (!file) return new Response(null, { status: 404, headers });
  const image = await fetch(file.url, {
    headers: { Authorization: `Bearer ${file.token}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (image.status === 404) return new Response(null, { status: 404, headers });
  const length = image.headers.get("Content-Length");
  if (!image.ok || !image.body || (length !== null && Number(length) !== file.size))
    return new Response(null, { status: 502, headers });
  return new Response(image.body, { headers: { ...headers, "Content-Type": file.mime } });
}

export const driveMedia = httpAction(async (ctx, request) => {
  const params = new URL(request.url).searchParams;
  const campaignId = params.get("campaign");
  const id = params.get("id");
  const version = params.get("v");
  if (!campaignId || campaignId.length > 128 ||
      !id || !/^[a-zA-Z0-9_-]{1,150}$/.test(id) || !version || !/^\d{1,30}$/.test(version))
    return new Response(null, { status: 404, headers });

  const campaign = await ctx.runQuery(internal.qaVisual.campaigns.getActive, { campaignId }).catch(() => null);
  if (!campaign) return new Response(null, { status: 404, headers });

  try {
    return await openDriveImage(ctx, { driveFolderId: campaign.driveFolderId, id, version });
  } catch (error) {
    console.error("QA Visual: no se pudo abrir la imagen de Google Drive", error);
    return new Response(null, { status: 502, headers });
  }
});

type ProbeResult = Omit<DriveInspection, "sampleFile"> & { viewer: { mime: string | null; bytes: number } };

export const probe = internalAction({
  args: { folderUrl: v.string() },
  handler: async (ctx, { folderUrl }): Promise<ProbeResult> => {
    const { sampleFile, ...result } = await ctx.runAction(internal.qaVisual.driveAnalysis.inspectCampaign, { folderUrl });
    const { bytes: expectedBytes, ...fileArgs } = sampleFile;
    const image = await openDriveImage(ctx, fileArgs);
    if (!image.ok) throw new Error(`El visor no pudo leer la imagen de Drive (HTTP ${image.status}).`);
    const imageBytes = (await image.arrayBuffer()).byteLength;
    if (imageBytes !== expectedBytes) throw new Error("El visor recibió una imagen incompleta.");
    return { ...result, viewer: { mime: image.headers.get("Content-Type"), bytes: imageBytes } };
  },
});
