"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";

export function useRequestBrief(description?: string) {
  const [brief, setBrief] = useState({ html: "", requestType: "", launchDate: "" });
  useEffect(() => {
    const html = DOMPurify.sanitize(description ?? "", {
      ALLOWED_TAGS: ["p", "br", "strong", "b", "em", "i", "ul", "ol", "li", "a"],
      ALLOWED_ATTR: ["href", "title"],
    });
    const document = new DOMParser().parseFromString(html, "text/html");
    function field(name: string) {
      const label = Array.from(document.querySelectorAll("strong, b")).find((node) => node.textContent?.trim().replace(/:$/, "").toLocaleLowerCase() === name);
      let value = "";
      let node = label?.nextSibling;
      while (node && node.nodeName !== "BR" && node.nodeName !== "STRONG" && node.nodeName !== "B") {
        value += node.textContent ?? "";
        node = node.nextSibling;
      }
      return value.trim();
    }
    setBrief({ html, requestType: field("tipo de requerimiento"), launchDate: field("fecha de lanzamiento") });
  }, [description]);
  return brief;
}

