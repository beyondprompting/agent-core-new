import test from "node:test";
import assert from "node:assert/strict";
import { mentionQuery, filterMentionPeople } from "../app/components/requests/comment-editor/mentions";
import { serializeComment } from "../app/components/requests/comment-editor/serializeComment";
import { resolveMentions, mentionsForSync } from "../convex/lib/taskMentions";

test("mention search recognizes names but leaves email addresses and punctuation alone", () => {
  assert.deepEqual(mentionQuery("Hola @"), { query: "", length: 1 });
  assert.deepEqual(mentionQuery("@María Pé"), { query: "María Pé", length: 9 });
  for (const text of ["maria@example", "@maria.com", "@maria@", "hola @maria!", "foo@", "hola"]) assert.equal(mentionQuery(text), null);
  const people = [{ id: "1", name: "María Pérez" }, { id: "2", name: "Julia Sartirana" }];
  assert.deepEqual(filterMentionPeople(people, "maria pe"), [people[0]]);
  assert.deepEqual(filterMentionPeople(people, "inexistente"), []);
});

test("only selected mention nodes serialize as mentions; deletion removes their identity", () => {
  const doc: any = { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hola @texto " }, { type: "mention", attrs: { userId: "u1", label: "Nombre falsificado" } }] }] };
  const text = serializeComment(doc, []);
  const result = resolveMentions(text, [{ id: "u1", name: "María Pérez" }]);
  assert.equal(result.message, "Hola @texto [@María Pérez](#mention-u1)");
  assert.deepEqual(result.userIds, ["u1"]);
  assert.equal(mentionsForSync(result.message), "Hola @texto @María Pérez");
  assert.throws(() => resolveMentions(text, []), /ya no tiene acceso/);
  doc.content[0].content.pop();
  assert.deepEqual(resolveMentions(serializeComment(doc, []), []).userIds, []);
});
