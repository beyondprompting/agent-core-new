import test from "node:test";
import assert from "node:assert/strict";
import { getFunctionName } from "convex/server";
import * as panel from "../convex/data/taskPanel";
import * as sender from "../convex/data/taskPanelSync";
import * as tasks from "../convex/data/tasks";
import { clientConfig } from "../config/tenant.config";

// A small transactional Convex context double; tests run real handlers/helpers.
function fixture() {
  let counter = 0;
  const rows = new Map<string, any>();
  const scheduled: any[] = [];
  const put = (table: string, doc: any) => { rows.set(doc._id, { _table: table, _creationTime: 1, ...doc }); return doc._id; };
  put("approvedExternalUsers", { _id: "external1", userId: "user1" });
  put("tasks", { _id: "task1", createdBy: "user1", source: "external", threadId: "thread1", corClientId: clientConfig.ui.trelloPublishCorClientIds[0], title: "Original", description: "Original brief", status: "nueva" });
  const db: any = {
    get: async (id: string) => rows.get(id) ?? null,
    insert: async (table: string, data: any) => put(table, { ...data, _id: `${table}-${++counter}` }),
    patch: async (id: string, data: any) => { const row = rows.get(id); assert.ok(row); for (const [key, value] of Object.entries(data)) { if (value === undefined) delete row[key]; else row[key] = value; } },
    query: (table: string) => {
      const filters: ((r: any) => boolean)[] = [];
      const builder: any = {
        eq: (key: string, value: any) => { filters.push(r => r[key] === value); return builder; },
        lte: (key: string, value: any) => { filters.push(r => r[key] <= value); return builder; },
      };
      const result = () => Array.from(rows.values()).filter(r => r._table === table && filters.every(f => f(r)));
      const query: any = { withIndex: (_: string, build: any) => { build(builder); return query; }, collect: async () => result(), unique: async () => { assert.ok(result().length < 2); return result()[0] ?? null; }, first: async () => result()[0] ?? null, take: async (n: number) => result().slice(0,n) };
      return query;
    },
  };
  const ctx: any = { db, auth: { getUserIdentity: async () => ({ subject: "user1|session" }) }, storage: { getUrl: async (id: string) => `https://files.example/${id}`, get: async () => new Blob(["test"], { type: "application/pdf" }) }, scheduler: { runAfter: async (...args: any[]) => { scheduled.push(args); } } };
  const modules: any = { "data/taskPanel": panel, "data/taskPanelSync": sender, "data/tasks": tasks };
  const run = async (ref: any, args: any) => { const [module, name] = getFunctionName(ref).split(":"); return modules[module][name]._handler(ctx, args); };
  ctx.runQuery = run; ctx.runMutation = run;
  const upload = (id = "upload1", patch: any = {}) => put("taskPanelUploads", { _id: id, taskId: "task1", userId: "user1", key: id, filename: `${id}.pdf`, mimeType: "application/pdf", size: 4, state: "ready", fileId: `file-${id}`, storageId: `storage-${id}`, createdAt: 1, ...patch });
  const call = async (handler: any, args: any) => {
    const snapshot = structuredClone(Array.from(rows.entries()));
    try { return await handler._handler(ctx, args); } catch (error) { rows.clear(); snapshot.forEach(([id,row]) => rows.set(id,row)); throw error; }
  };
  return { ctx, rows, put, upload, call, scheduled };
}
function providers() {
  const calls: string[] = [];
  const p: any = {
    trello: { addCardAttachment: async () => { calls.push("trello-file"); return { id: "ta1", url: "https://trello.example/ta1" }; }, addCommentToCard: async () => { calls.push("trello-comment"); return { id: "tc1" }; } },
    cor: () => ({ getTask: async () => ({ projectId: 10 }), uploadTaskAttachment: async () => { calls.push("cor-file"); return { success: true, attachment: { id: 20, url: "https://cor.example/a20" } }; }, postTaskMessage: async () => { calls.push("cor-comment"); return { success: true }; } }),
  };
  return { p, calls };
}

test("rejects anonymous/internal/other-owner access and foreign uploads", async () => {
  const f = fixture();
  await assert.rejects(panel.requirePanelTask(f.ctx, "task1" as any, null));
  await assert.rejects(panel.requirePanelTask(f.ctx, "task1" as any, "user2" as any));
  f.upload("foreign", { userId: "user2" });
  await assert.rejects(f.call(panel.submit, { taskId: "task1", key: "k", text: "Hello", uploadIds: ["foreign"] }));
  assert.equal(Array.from(f.rows.values()).filter(r => r._table === "taskPanelEntries").length, 0);
  f.rows.delete("external1");
  await assert.rejects(panel.requirePanelTask(f.ctx, "task1" as any, "user1" as any));
});

test("atomic, idempotent submission relates comments/files without chat or field mutations", async () => {
  const f = fixture(); const original = structuredClone(f.rows.get("task1")); f.upload();
  const args = { taskId: "task1", key: "k", text: "Comment", uploadIds: ["upload1"] };
  const id = await f.call(panel.submit, args);
  assert.equal(await f.call(panel.submit, args), id);
  assert.equal(f.scheduled.length, 1);
  assert.deepEqual(f.rows.get("task1"), original);
  const attachments = Array.from(f.rows.values()).filter(r => r._table === "taskAttachments");
  const messages = Array.from(f.rows.values()).filter(r => r._table === "taskMessages");
  assert.equal(attachments.length, 1); assert.equal(messages.length, 1);
  assert.equal(messages[0].panelEntryId, attachments[0].panelEntryId);
  assert.equal(messages[0].corMessageSyncStatus, "pending_cor_task");
  assert.equal(Array.from(f.rows.values()).filter(r => r._table === "threadUploadedFiles").length, 0);
  await assert.rejects(f.call(panel.submit, { ...args, key: "other" }));
  await assert.rejects(f.call(panel.submit, { ...args, text: "Changed" }));
});

test("legacy queues keep chat files/comments and exclude only panel records", async () => {
  const f = fixture(); f.upload(); await f.call(panel.submit, { taskId: "task1", key: "k", text: "Panel", uploadIds: ["upload1"] });
  f.put("taskAttachments", { _id: "legacy", taskId: "task1", fileId: "old" });
  f.put("taskMessages", { _id: "chat-comment", taskId: "task1", source: "external_agent", message: "Old", corMessageSyncStatus: "pending_cor_task", createdAt: 0 });
  assert.deepEqual((await f.call(tasks.getPendingAttachments, { taskId: "task1" })).map((r: any) => r._id), ["legacy"]);
  assert.deepEqual((await f.call(tasks.getTaskAttachmentsForTrello, { taskId: "task1" })).map((r: any) => r._id), ["legacy"]);
  assert.deepEqual((await f.call(tasks.listPendingTaskMessagesForCORInternal, { taskId: "task1" })).map((r: any) => r._id), ["chat-comment"]);
});

test("sends to Trello now and COR after publishing without resending Trello", async () => {
  const f = fixture(); f.rows.get("task1").trelloCardId = "card1"; f.upload();
  const id = await f.call(panel.submit, { taskId: "task1", key: "k", text: "Comment", uploadIds: ["upload1"] });
  const { p, calls } = providers();
  await sender.syncEntry(f.ctx, id, p);
  assert.deepEqual(calls, ["trello-file", "trello-comment"]);
  assert.equal(f.rows.get(id).corState, "waiting");
  Object.assign(f.rows.get("task1"), { corTaskId: "2", corProjectId: 10, corSyncStatus: "synced" });
  await sender.syncEntry(f.ctx, id, p);
  assert.deepEqual(calls, ["trello-file", "trello-comment", "cor-file", "cor-comment"]);
  await sender.syncEntry(f.ctx, id, p);
  assert.equal(calls.length, 4);
  assert.equal(f.rows.get("task1").description, "Original brief");
});

test("attachment-only and comment-only entries work for already-published tasks", async () => {
  for (const files of [false, true]) {
    const f = fixture(); Object.assign(f.rows.get("task1"), { trelloCardId: "card1", corTaskId: "2", corProjectId: 10, corSyncStatus: "synced" });
    if (files) f.upload();
    const id = await f.call(panel.submit, { taskId: "task1", key: "k", text: files ? "" : "Comment", uploadIds: files ? ["upload1"] : [] });
    const { p, calls } = providers(); await sender.syncEntry(f.ctx, id, p);
    assert.deepEqual(calls, files ? ["trello-file", "cor-file"] : ["trello-comment", "cor-comment"]);
  }
});

test("uncertain writes are not repeated; lease excludes concurrent consumers", async () => {
  const f = fixture(); f.rows.get("task1").trelloCardId = "card1";
  const id = await f.call(panel.submit, { taskId: "task1", key: "k", text: "Comment", uploadIds: [] });
  assert.equal(await f.call(sender.claim, { entryId: id }), true);
  assert.equal(await f.call(sender.claim, { entryId: id }), false);
  await f.call(sender.release, { entryId: id });
  const { p, calls } = providers(); p.trello.addCommentToCard = async () => { calls.push("uncertain"); throw new Error("connection lost"); };
  await sender.syncEntry(f.ctx, id, p); await sender.syncEntry(f.ctx, id, p);
  assert.deepEqual(calls, ["uncertain"]); assert.equal(f.rows.get(id).trelloState, "needs_review");
});

test("COR project mismatch never uploads or posts", async () => {
  const f = fixture(); Object.assign(f.rows.get("task1"), { corTaskId: "2", corProjectId: 999, corSyncStatus: "synced" });
  const id = await f.call(panel.submit, { taskId: "task1", key: "k", text: "Comment", uploadIds: [] });
  const { p, calls } = providers(); await sender.syncEntry(f.ctx, id, p);
  assert.deepEqual(calls, []); assert.equal(f.rows.get(id).corState, "needs_review");
});

test("upload tickets validate type, size, ownership and task before accepting content", async () => {
  const f = fixture();
  process.env.CONVEX_SITE_URL = "https://example.convex.site";
  const args = { taskId: "task1", key: "upload-key", filename: "brief.pdf", mimeType: "application/pdf", size: 4 };
  await assert.rejects(f.call(panel.prepareUpload, { ...args, mimeType: "text/html" }));
  await assert.rejects(f.call(panel.prepareUpload, { ...args, size: 21 * 1024 * 1024 }));
  const first = await f.call(panel.prepareUpload, args);
  assert.equal((await f.call(panel.prepareUpload, args)).uploadId, first.uploadId);
  await assert.rejects(f.call(panel.claimUpload, { uploadId: first.uploadId, userId: "user2" }));
  await f.call(panel.claimUpload, { uploadId: first.uploadId, userId: "user1" });
  await assert.rejects(f.call(panel.claimUpload, { uploadId: first.uploadId, userId: "user1" }));
  await f.call(panel.finishUpload, { uploadId: first.uploadId, userId: "user1", fileId: "f", storageId: "s" });
  assert.equal((await f.call(panel.claimUpload, { uploadId: first.uploadId, userId: "user1" })).state, "ready");
});

test("expired sender is marked for review instead of duplicating an uncertain write", async () => {
  const f = fixture();
  const id = await f.call(panel.submit, { taskId: "task1", key: "k", text: "Comment", uploadIds: [] });
  Object.assign(f.rows.get(id), { trelloState: "sending", corState: "synced", leaseUntil: Date.now() - 1 });
  assert.equal(await f.call(sender.claim, { entryId: id }), false);
  assert.equal(f.rows.get(id).trelloState, "needs_review");
});

test("new panel attachment does not adopt an existing chat file with identical physical fileId", async () => {
  const f = fixture(); f.upload();
  f.put("taskAttachments", { _id: "original-chat-file", taskId: "task1", fileId: "file-upload1", storageId: "storage-upload1", filename: "Original.pdf", corAttachmentId: 99 });
  await f.call(panel.submit, { taskId: "task1", key: "k", text: "", uploadIds: ["upload1"] });
  assert.equal(f.rows.get("original-chat-file").panelEntryId, undefined);
  assert.equal(f.rows.get("original-chat-file").corAttachmentId, 99);
  assert.equal(Array.from(f.rows.values()).filter(r => r._table === "taskAttachments").length, 2);
});

test("two identical files in a submission reuse one task attachment without losing upload ownership", async () => {
  const f = fixture(); f.upload(); f.upload("upload2", { fileId: "file-upload1", storageId: "storage-upload1" });
  const id = await f.call(panel.submit, { taskId: "task1", key: "k", text: "", uploadIds: ["upload1", "upload2"] });
  assert.equal(Array.from(f.rows.values()).filter(r => r._table === "taskAttachments").length, 1);
  assert.equal(f.rows.get("upload1").entryId, id); assert.equal(f.rows.get("upload2").entryId, id);
});

test("detail includes legacy task attachments and uses neutral comment author metadata", async () => {
  const f = fixture();
  f.put("taskAttachments", { _id: "legacy-file", taskId: "task1", filename: "old.pdf", mimeType: "application/pdf", storageId: "old-storage", fileId: "old-file", createdAt: 1 });
  f.put("taskMessages", { _id: "trello-comment", taskId: "task1", source: "trello", message: "Image", createdAt: 2 });
  const result = await f.call(panel.detail, { taskId: "task1" });
  assert.equal(result.attachments[0].id, "legacy-file");
  assert.equal(result.attachments[0].mimeType, "application/pdf");
  assert.equal(result.attachments[0].url, "https://files.example/old-storage");
  assert.equal("source" in result.comments[0], false);
});

test("inline comment files resolve atomically and invalid references cannot attach files", async () => {
  const f = fixture(); f.upload("image", { filename: "foto.png", mimeType: "image/png" });
  const args = { taskId: "task1", key: "inline", text: "Antes\n\n{{task-panel-file:0}}\n\nDespués", uploadIds: ["image"] };
  await assert.rejects(f.call(panel.submit, { ...args, text: "{{task-panel-file:2}}" }));
  assert.equal(Array.from(f.rows.values()).filter(r => r._table === "taskAttachments").length, 0);
  assert.equal(f.rows.get("image").entryId, undefined);
  const id = await f.call(panel.submit, args);
  const message = f.rows.get(f.rows.get(id).messageId).message;
  assert.equal(message, "Antes\n\n![foto.png](https://files.example/storage-image)\n\nDespués");
  assert.equal(await f.call(panel.submit, args), id);
  assert.equal(Array.from(f.rows.values()).filter(r => r._table === "taskMessages").length, 1);
});

test("internal comment reader preserves task access and includes published comments", async () => {
  const f = fixture();
  f.put("taskMessages", { _id: "comment1", taskId: "task1", userId: "user1", source: "external_panel", message: "Hola", createdAt: 1, corMessageSyncStatus: "synced" });
  assert.deepEqual(await f.call(tasks.listInternalTaskComments, { taskId: "task1" }), []);
  f.rows.delete("external1");
  f.rows.get("task1").corTaskId = "123";
  assert.deepEqual(await f.call(tasks.listInternalTaskComments, { taskId: "task1" }), []);
  f.put("corClients", { _id: "client1", corClientId: f.rows.get("task1").corClientId });
  f.put("clientUserAssignments", { _id: "assignment1", clientId: "client1", userId: "user1" });
  const comments = await f.call(tasks.listInternalTaskComments, { taskId: "task1" });
  assert.equal(comments.length, 1);
  assert.equal(comments[0].text, "Hola");
  f.rows.get("task1").convexStatus = "deleted";
  assert.deepEqual(await f.call(tasks.listInternalTaskComments, { taskId: "task1" }), []);
});

test("authorized internal comments reuse deferred sync and are visible to the external creator", async () => {
  const f = fixture();
  f.ctx.auth.getUserIdentity = async () => ({ subject: "internal1|session" });
  const args = { taskId: "task1", key: "internal-comment", text: "Nueva propuesta {{task-panel-file:0}}", uploadIds: ["internal-upload"] };
  f.upload("internal-upload", { userId: "internal1" });
  await assert.rejects(f.call(panel.submit, args));
  f.put("corClients", { _id: "client1", corClientId: f.rows.get("task1").corClientId });
  f.put("clientUserAssignments", { _id: "internal-access", userId: "internal1", clientId: "client1" });
  f.rows.get("task1").trelloCardId = "card1";
  const id = await f.call(panel.submit, args);
  assert.equal(await f.call(panel.submit, args), id);
  const message = f.rows.get(f.rows.get(id).messageId);
  assert.equal(message.source, "internal_panel");
  const { p, calls } = providers();
  await sender.syncEntry(f.ctx, id, p);
  assert.deepEqual(calls, ["trello-file", "trello-comment"]);
  assert.equal(f.rows.get(id).corState, "waiting");
  f.ctx.auth.getUserIdentity = async () => ({ subject: "user1|session" });
  const detail = await f.call(panel.detail, { taskId: "task1" });
  assert.ok(detail.comments.some((comment: any) => comment.id === message._id));
  Object.assign(f.rows.get("task1"), { corTaskId: "2", corProjectId: 10, corSyncStatus: "synced" });
  await sender.syncEntry(f.ctx, id, p);
  await sender.syncEntry(f.ctx, id, p);
  assert.deepEqual(calls, ["trello-file", "trello-comment", "cor-file", "cor-comment"]);
  f.rows.delete("internal-access");
  await assert.rejects(panel.requirePanelTask(f.ctx, "task1" as any, "internal1" as any));
});
