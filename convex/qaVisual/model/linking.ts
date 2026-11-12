import type { LinkOverride } from "./contracts";
import { numbered } from "./offers";
import { normalize, offerChannel, productTokens, temporal } from "./normalize";

export function linkOffer(
  value: string,
  product: string,
  channel?: string,
  date?: string,
  aliases: LinkOverride[] = [],
) {
  const offers = numbered(value)
    .map((offer) => ({
      ...offer,
      product: offer.value
        .replace(/^(?:DOMICILIO|EXPRESS|AUTORAPIDO)\s+/i, "")
        .replace(/^(?:\d{1,2}\s+de\s+\p{L}+|HOY)\s+/iu, ""),
    }))
    .filter(
      (offer) =>
        (!channel ||
          !offerChannel(offer.value) ||
          offerChannel(offer.value) === channel) &&
        (!date || !temporal(offer.value) || temporal(offer.value) === date),
    );
  const same = (a: string[], b: string[]) => a.join(" ") === b.join(" ");
  const confirmedAlias = (text: string) =>
    aliases.some(
      (a) =>
        a.kind === "productAlias" &&
        normalize(a.from ?? "") === normalize(product) &&
        normalize(a.to ?? "") === normalize(text),
    );
  const levels = [
    [
      "exact",
      (text: string) => same(productTokens(text), productTokens(product)),
    ],
    [
      "connectors",
      (text: string) =>
        same(productTokens(text, true), productTokens(product, true)),
    ],
    [
      "contained",
      (text: string) => {
        const a = productTokens(text),
          b = productTokens(product);
        // A partial commercial name must never erase a different quantity.
        return (
          same(
            a.filter((t) => /^\d+$/.test(t)),
            b.filter((t) => /^\d+$/.test(t)),
          ) && ` ${a.join(" ")} `.includes(` ${b.join(" ")} `)
        );
      },
    ],
    ["alias", confirmedAlias],
  ] as const;
  if (productTokens(product).length)
    for (const [method, matches] of levels) {
      const candidates = offers.filter((o) => matches(o.product));
      // An explicit confirmation resolves the partial match it refers to.
      // Preserve ambiguity if more than one candidate is confirmed.
      const confirmed =
        method === "contained"
          ? candidates.filter((o) => confirmedAlias(o.product))
          : [];
      if (confirmed.length)
        return {
          method: "alias" as const,
          candidates: confirmed,
          offer: confirmed.length === 1 ? confirmed[0] : undefined,
        };
      if (candidates.length)
        return {
          method,
          candidates,
          offer: candidates.length === 1 ? candidates[0] : undefined,
        };
    }
  return { method: undefined, candidates: offers, offer: undefined };
}
