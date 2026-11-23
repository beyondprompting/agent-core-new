import test from "node:test";
import assert from "node:assert/strict";
import { toMarkdown } from "../convex/integrations/trelloDescription";

const format = (description?: string): string => (toMarkdown as any)._handler({}, { description });

test("COR paragraphs, empty editor blocks and bold labels become Trello Markdown", () => {
  const input = '<p><strong>Tipo de requerimiento:</strong> Prueba<br><strong>Entregables:</strong> Una pieza</p><p>&nbsp;</p><p>Test de decripcion</p><p>test 2</p>';
  assert.equal(format(input), "**Tipo de requerimiento:** Prueba  \n**Entregables:** Una pieza\n\nTest de decripcion\n\ntest 2");
});

test("links, lists and inline styling retain their readable structure", () => {
  const input = '<ul><li><a href="https://example.com/brief?a=1&amp;b=2">Ver brief</a></li><li><em>Revisión</em></li></ul>';
  const result = format(input);
  assert.match(result, /^-\s+\[Ver brief\]\(https:\/\/example\.com\/brief\?a=1&b=2\)\n-\s+_Revisión_$/);
  assert.equal(format('<p>A <strong>simple vista</strong>, 2 &lt; 3.</p>'), "A **simple vista**, 2 < 3.");
});

test("existing plain text and Markdown keep literal text, line breaks and formatting", () => {
  const existing = "**Prioridad**\n\n- Una pieza\n- Dos piezas\nContacto <equipo@example.com>";
  assert.equal(format(existing), existing);
  assert.equal(format("Texto &amp; diseño"), "Texto & diseño");
  assert.equal(format(undefined), "");
});
