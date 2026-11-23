"use node";

import { v } from "convex/values";
import TurndownService from "turndown";
import { internalAction } from "../_generated/server";

const markdown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});
markdown.remove(["script", "style"]);
markdown.addRule("unsupportedLink", {
  filter: node => node.nodeName === "A" && !/^(?:https?:\/\/|mailto:|tel:)/i.test(node.getAttribute("href")?.trim() ?? ""),
  replacement: content => content,
});

const richTextTag = /<\/?(?:html|body|p|div|span|br|hr|strong|b|em|i|u|s|del|a|img|ul|ol|li|h[1-6]|blockquote|pre|code|table|section|script|style)(?=[\s/>])/i;
const legacyEntities: Record<string, string> = {
  "&nbsp;": " ", "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'",
};

export const toMarkdown = internalAction({
  args: { description: v.optional(v.string()) },
  handler: (_ctx, { description = "" }): string => {
    // Older tasks can already contain plain text or Markdown. Preserve their line breaks and formatting.
    if (!richTextTag.test(description)) {
      return description.replace(/&(?:nbsp|amp|lt|gt|quot|#39);/gi, entity => legacyEntities[entity.toLowerCase()]).trim();
    }
    return markdown.turndown(description);
  },
});
