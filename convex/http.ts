import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

import { upload as uploadTaskPanelFile, preflight as taskPanelPreflight } from "./taskPanelUpload";

import { media as taskPanelMedia, preflight as taskPanelMediaPreflight } from "./taskPanelMediaHttp";

import { driveMedia } from "./qaVisual/mediaHttp";

const http = httpRouter();
http.route({ path: "/qa-visual/media", method: "GET", handler: driveMedia });
http.route({ path: "/task-panel/media", method: "GET", handler: taskPanelMedia });
http.route({ path: "/task-panel/media", method: "OPTIONS", handler: taskPanelMediaPreflight });
http.route({ path: "/task-panel/upload", method: "POST", handler: uploadTaskPanelFile });
http.route({ path: "/task-panel/upload", method: "OPTIONS", handler: taskPanelPreflight });

auth.addHttpRoutes(http);

function base64FromArrayBuffer(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

http.route({
  path: "/cor/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.COR_ZAPIER_WEBHOOK_SECRET;
    if (!secret) return new Response("Webhook not configured", { status: 503 });
    if (!constantTimeEqual(request.headers.get("Authorization") ?? "", `Bearer ${secret}`)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const payload = await request.json().catch(() => null);
    const event = payload?.event;
    const rawId = payload?.corId;
    const corId = typeof rawId === "string" && /^\d+$/.test(rawId.trim())
      ? Number(rawId.trim()) : rawId;
    if (!Number.isSafeInteger(corId) || corId <= 0) {
      return Response.json({ error: "Expected a positive integer corId" }, { status: 400 });
    }
    if (event === "client.deleted") {
      console.info(`[COR webhook] ${event} corId=${corId} status=received queued=0`);
      return Response.json({ event, corId, status: "received", queued: 0 });
    }
    if (event !== "task.updated" && event !== "project.updated" && event !== "project.deleted" &&
        event !== "client.created" && event !== "user.deleted") {
      return Response.json({ error: "Unsupported COR webhook event" }, { status: 400 });
    }

    const queued = await ctx.runMutation(internal.data.corWebhook.enqueue, { event, corId });
    const status = queued ? "queued" : "no_local_match";
    console.info(`[COR webhook] ${event} corId=${corId} status=${status} queued=${queued}`);
    return Response.json({ event, corId, status, queued }, { status: queued ? 202 : 200 });
  }),
});

async function verifyTrelloWebhookSignature(args: {
  bodyText: string;
  callbackURL: string;
  signature: string | null;
}) {
  const secret = process.env.TRELLO_APP_SECRET;
  if (!secret) {
    throw new Error("Falta TRELLO_APP_SECRET en Convex.");
  }
  if (!args.signature) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(args.bodyText + args.callbackURL),
  );
  const expected = base64FromArrayBuffer(digest);
  return constantTimeEqual(expected, args.signature);
}

http.route({
  path: "/trello/webhook",
  method: "GET",
  handler: httpAction(async () => {
    return new Response(null, { status: 200 });
  }),
});

http.route({
  path: "/trello/webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const bodyText = await request.text();
    const callbackURL = process.env.TRELLO_WEBHOOK_CALLBACK_URL || request.url;

    try {
      const isValid = await verifyTrelloWebhookSignature({
        bodyText,
        callbackURL,
        signature: request.headers.get("x-trello-webhook"),
      });

      if (!isValid) {
        return new Response("Invalid Trello webhook signature", { status: 401 });
      }

      const payload = JSON.parse(bodyText);
      const action = payload?.action;
      const actionId = action?.id;
      const actionType = action?.type;

      if (!actionId || !actionType) {
        return new Response("Invalid Trello webhook payload", { status: 400 });
      }

      await ctx.runMutation(internal.data.trello.recordWebhookEvent, {
        trelloActionId: actionId,
        trelloWebhookId: payload?.webhook?.id,
        trelloBoardId:
          action?.data?.board?.id ||
          payload?.model?.id ||
          payload?.webhook?.idModel,
        trelloCardId: action?.data?.card?.id,
        actionType,
        sourceIdentifier: request.headers.get("x-trello-client-identifier") || undefined,
        payloadJson: bodyText,
      });

      return new Response("OK", { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TrelloWebhook] Error: ${message}`);
      return new Response("Trello webhook error", { status: 500 });
    }
  }),
});

export default http;
