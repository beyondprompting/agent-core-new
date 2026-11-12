import type {
  Issue,
  LinkOverride,
  Matrix,
  Requirement,
  Source,
} from "./contracts";
import type { ProductionFields } from "./productionCsv";
import {
  formatLabel,
  normalize,
  offerChannel,
  pieceKey,
  temporal,
} from "./normalize";
import { numbered, priceAmount } from "./offers";
import { linkOffer } from "./linking";

const ids = ["format", "dimensions", "product", "price", "date", "cta"];

export function buildRequirements(
  matrix: Matrix | undefined,
  fileName: string,
  production?: ProductionFields,
  overrides: LinkOverride[] = [],
) {
  const requirements: Requirement[] = [];
  const issues: Issue[] = [];
  const cells = new Map(
    matrix?.cells.map((c) => [`${c.sheet}!${c.cell}`, c.text]),
  );
  const source = (
    cell: string,
    text: string,
    ordinal?: string,
    sheet = "PRODUCCION",
  ): Source => ({
    file: "excel",
    ...(matrix?.name ? { name: matrix.name } : {}),
    sheet,
    cell,
    text,
    ...(ordinal ? { ordinal } : {}),
  });
  const csv = (column: string, text: string): Source => ({
    file: "csv",
    column,
    text,
    ...(production?.csvLine ? { csvLine: production.csvLine } : {}),
  });
  const addIssue = (
    code: string,
    message: string,
    affects: string[],
    sources: Source[],
    severity: Issue["severity"] = "warning",
    candidates?: Issue["candidates"],
  ) => {
    const id = `${code}:${sources.map((s) => `${s.sheet ?? s.file}:${s.cell ?? s.csvLine ?? ""}:${s.ordinal ?? ""}`).join("|")}`;
    if (!issues.some((i) => i.id === id))
      issues.push({
        id,
        code,
        severity,
        scope: "piece",
        affects,
        message,
        sources,
        ...(candidates ? { candidates } : {}),
      });
    return id;
  };
  const add = (
    ruleId: string,
    status: Requirement["status"],
    expected: string | undefined,
    sources: Source[],
    issueIds: string[] = [],
    basis: Requirement["basis"] = "client",
    alternatives?: string[],
  ) => {
    requirements.push({
      ruleId,
      status,
      basis,
      ...(expected ? { expected, display: expected } : {}),
      sources,
      issueIds,
      ...(alternatives?.length ? { expectedAlternatives: alternatives } : {}),
    });
  };
  const fallback = (
    ruleId: string,
    cause: string,
    status: Requirement["status"] = "unresolved",
    sources: Source[] = [],
  ) => {
    const value =
      ruleId === "product"
        ? production?.product
        : ruleId === "price"
          ? production?.price
          : ruleId === "date"
            ? temporal(production?.dateAsset ?? "")
            : ruleId === "dimensions" && production?.width && production.height
              ? `${production.width} × ${production.height}`
              : ruleId === "format"
                ? fileName.split(".").at(-1)?.toUpperCase()
                : undefined;
    const column = (
      {
        product: "TXT_PRODUCTO",
        price: "TXT_PRECIO",
        date: "SLOT_FECHA",
        dimensions: "ANCHO_PX / ALTO_PX",
      } as Record<string, string>
    )[ruleId];
    const fallbackSource: Source | undefined = value
      ? column
        ? csv(column, value)
        : { file: "filename", text: fileName }
      : undefined;
    add(
      ruleId,
      status,
      value,
      [...sources, ...(fallbackSource ? [fallbackSource] : [])],
      [cause],
      value ? "production" : "client",
    );
  };
  if (!production) {
    const cause = addIssue(
      "csv_row_missing",
      "La imagen no tiene una fila vinculada en el CSV.",
      ids,
      [{ file: "filename", text: fileName }],
    );
    for (const id of ids) fallback(id, cause);
    const size = fileName.match(/(\d+)x(\d+)px/i);
    if (size)
      Object.assign(requirements.find((r) => r.ruleId === "dimensions")!, {
        expected: `${Number(size[1])} × ${Number(size[2])}`,
        basis: "production",
        sources: [{ file: "filename", text: fileName }],
      });
    return { requirements, issues };
  }
  const header = matrix?.cells.find(
    (c) =>
      c.sheet === "PRODUCCION" &&
      /^A\d+$/.test(c.cell) &&
      normalize(c.text) === "CAMPANA",
  );
  const rows =
    matrix?.cells
      .filter(
        (c) =>
          c.sheet === "PRODUCCION" &&
          /^A\d+$/.test(c.cell) &&
          header &&
          Number(c.cell.slice(1)) > Number(header.cell.slice(1)) &&
          normalize(c.text) === normalize(production.campaign),
      )
      .map((c) => c.cell.slice(1))
      .filter(
        (row) =>
          [
            ["B", production.phase],
            ["C", production.channel],
            ["D", production.platform],
          ].every(
            ([col, value]) =>
              normalize(cells.get(`PRODUCCION!${col}${row}`) ?? "") ===
              normalize(value),
          ) &&
          formatLabel(cells.get(`PRODUCCION!E${row}`) ?? "") ===
            formatLabel(production.format),
      ) ?? [];
  const identityColumns = [
    "CAMPAÑA",
    "FASE",
    "CANAL",
    "MEDIO_PLATAFORMA",
    "FORMATO_TIPO",
  ];
  const duplicateColumns = production.duplicates?.length
    ? Object.keys(production.duplicates[0].values).filter(
        (key) =>
          new Set(
            production.duplicates!.map((r) => normalize(r.values[key] ?? "")),
          ).size > 1,
      )
    : [];
  if (production.duplicates?.length)
    addIssue(
      "csv_duplicate_id",
      duplicateColumns.length
        ? "El CSV tiene filas con el mismo ID y valores distintos. Se conservan las referencias para resolver el conflicto."
        : "El CSV repite una fila idéntica para esta pieza.",
      duplicateColumns.length ? ids : [],
      production.duplicates.map((r) => ({
        file: "csv",
        csvLine: r.csvLine,
        text: JSON.stringify(r.values),
      })),
      duplicateColumns.length ? "warning" : "info",
    );
  if (
    rows.length !== 1 ||
    duplicateColumns.some((c) => identityColumns.includes(c))
  ) {
    const cause = addIssue(
      rows.length > 1 ? "excel_row_ambiguous" : "excel_row_missing",
      "No se pudo vincular una fila única del pedido del cliente. Los valores disponibles se comparan con producción.",
      ids,
      [csv("CAMPAÑA", production.campaign)],
    );
    for (const id of ids) fallback(id, cause);
  } else {
    const row = rows[0],
      get = (column: string) => cells.get(`PRODUCCION!${column}${row}`) ?? "";
    const ref = (column: string, ordinal?: string) =>
      source(`${column}${row}`, get(column), ordinal);
    const format = get("G");
    if (format) add("format", "ready", format, [ref("G")]);
    else
      fallback(
        "format",
        addIssue(
          "format_missing",
          "Falta el formato de archivo en el pedido.",
          ["format"],
          [ref("G")],
        ),
        "missing",
      );
    if (Number(get("I")) > 0 && Number(get("J")) > 0) {
      const expected = `${Number(get("I"))} × ${Number(get("J"))}`;
      const legend = cells.get("LEYENDA!C11") ?? "";
      const pattern =
        formatLabel(production.format) === "STORY"
          ? /Stories Estática:\s*(\d+)\s*x\s*(\d+)/i
          : /Post Estático:\s*(\d+)\s*x\s*(\d+)/i;
      const match = legend.match(pattern);
      const conflict =
        match && `${Number(match[1])} × ${Number(match[2])}` !== expected;
      const cause = conflict
        ? addIssue(
            "dimensions_legend_conflict",
            "PRODUCCION y LEYENDA indican dimensiones distintas. Se usa la fila de PRODUCCION.",
            ["dimensions"],
            [ref("I"), ref("J"), source("C11", legend, undefined, "LEYENDA")],
          )
        : undefined;
      add(
        "dimensions",
        conflict ? "conflict" : "ready",
        expected,
        [ref("I"), ref("J")],
        cause ? [cause] : [],
      );
    } else
      fallback(
        "dimensions",
        addIssue(
          "dimensions_missing",
          "Faltan dimensiones válidas en el pedido.",
          ["dimensions"],
          [ref("I"), ref("J")],
        ),
        "missing",
      );
    const channel = offerChannel(production.channel) ?? offerChannel(fileName);
    const date = temporal(production.dateAsset) ?? temporal(fileName);
    if (
      offerChannel(production.channel) &&
      offerChannel(fileName) &&
      offerChannel(production.channel) !== offerChannel(fileName)
    )
      addIssue(
        "channel_mismatch",
        "El canal del CSV y el nombre del archivo difieren. Se usa el CSV.",
        ["product", "price", "date"],
        [
          csv("CANAL", production.channel),
          { file: "filename", text: fileName },
        ],
      );
    const applicable = overrides.filter(
      (o) => !o.pieceKey || o.pieceKey === pieceKey(fileName),
    );
    const manual = applicable.find(
      (o) => o.kind === "offerLink" && o.row === row,
    );
    const linked = linkOffer(
      get("K"),
      production.product,
      channel,
      date,
      applicable,
    );
    const manualOffers = manual
      ? numbered(get("K")).filter((o) => o.ordinal === manual.ordinal)
      : [];
    const offer = manual
      ? manualOffers.length === 1
        ? {
            ...manualOffers[0],
            product: manualOffers[0].value
              .replace(/^(?:DOMICILIO|EXPRESS|AUTORAPIDO)\s+/i, "")
              .replace(/^(?:\d{1,2}\s+de\s+\p{L}+|HOY)\s+/iu, ""),
          }
        : undefined
      : linked.offer;
    if (
      formatLabel(production.format) === "STORY" &&
      get("K") &&
      /stories.*sin oferta/i.test(cells.get("REGLAS!B6") ?? "")
    )
      addIssue(
        "stories_offer_filled",
        "El Excel incluye ofertas en Stories aunque su regla indica dejar esa celda vacía. La revisión usa las ofertas de esa fila.",
        [],
        [
          ref("K"),
          source("B6:D6", cells.get("REGLAS!B6") ?? "", undefined, "REGLAS"),
        ],
        "info",
      );
    if (offer) {
      const { ordinal, value } = offer;
      const productSource = { ...ref("K", ordinal), text: value };
      if (manual)
        addIssue(
          "offer_manual",
          "La oferta fue vinculada mediante una confirmación humana.",
          [],
          [
            productSource,
            {
              file: "override",
              text: `${manual.author ?? "Revisor"} · ${manual.at ?? ""}`,
            },
          ],
          "info",
        );
      else if (linked.method !== "exact")
        addIssue(
          linked.method === "connectors"
            ? "offer_name_equivalence"
            : linked.method === "alias"
              ? "offer_alias_applied"
              : "offer_name_partial",
          `El CSV dice «${production.product}» y el Excel «${offer.product}» (oferta ${ordinal}). Se vinculó por ${linked.method === "connectors" ? "equivalencia de conectores" : linked.method === "alias" ? "equivalencia confirmada" : "coincidencia parcial"}.`,
          linked.method === "contained" ? ["product", "price", "date"] : [],
          [
            csv("TXT_PRODUCTO", production.product),
            productSource,
            ...(linked.method === "alias"
              ? applicable
                  .filter(
                    (o) =>
                      o.kind === "productAlias" &&
                      normalize(o.from ?? "") ===
                        normalize(production.product) &&
                      normalize(o.to ?? "") === normalize(offer.product),
                  )
                  .map(
                    (o): Source => ({
                      file: "override",
                      text: `${o.author ?? "Revisor"} · ${o.at ?? ""}`,
                    }),
                  )
              : []),
          ],
          linked.method === "contained" ? "warning" : "info",
          linked.method === "contained"
            ? [{ row, ordinal, text: value }]
            : undefined,
        );
      add("product", "ready", offer.product, [
        productSource,
        csv("TXT_PRODUCTO", production.product),
      ]);
      const prices = numbered(get("L")).filter((p) => p.ordinal === ordinal);
      const price = prices.length === 1 ? prices[0].value : "";
      const priceSource = { ...ref("L", ordinal), text: price };
      if (
        prices.length > 1 ||
        numbered(get("K")).filter((o) => o.ordinal === ordinal).length > 1
      ) {
        const cause = addIssue(
          "price_duplicate_ordinal",
          `El numeral ${ordinal} está duplicado en las ofertas o los precios.`,
          ["price"],
          [productSource, ref("L", ordinal)],
        );
        fallback("price", cause, "invalid", [priceSource]);
      } else if (price && priceAmount(price) === undefined) {
        fallback(
          "price",
          addIssue(
            "price_invalid",
            "El Excel no indica un importe único y válido.",
            ["price"],
            [priceSource],
          ),
          "invalid",
          [priceSource],
        );
      } else if (
        price &&
        production.price &&
        priceAmount(price) !== priceAmount(production.price)
      ) {
        const sources = [priceSource, csv("TXT_PRECIO", production.price)];
        add(
          "price",
          "conflict",
          price,
          sources,
          [
            addIssue(
              "price_conflict_csv",
              `El Excel indica ${price} y el CSV indica ${production.price}.`,
              ["price"],
              sources,
            ),
          ],
          "client",
          [production.price],
        );
      } else if (price)
        add("price", "ready", price, [
          priceSource,
          ...(production.price ? [csv("TXT_PRECIO", production.price)] : []),
        ]);
      else if (production.price || (get("L") && !prices.length))
        fallback(
          "price",
          addIssue(
            "price_missing",
            `El Excel no indica precio para la oferta n.º ${ordinal}.`,
            ["price"],
            [priceSource],
          ),
          "missing",
          [priceSource],
        );
      else add("price", "notRequested", undefined, [priceSource]);
      const offerDate = temporal(value);
      if (offerDate) {
        const conflict = date && date !== offerDate;
        const sources = [
          productSource,
          ...(production.dateAsset
            ? [csv("SLOT_FECHA", production.dateAsset)]
            : []),
        ];
        add(
          "date",
          conflict ? "conflict" : "ready",
          offerDate,
          sources,
          conflict
            ? [
                addIssue(
                  "date_mismatch_sources",
                  "La vigencia de la oferta y la de producción difieren.",
                  ["date"],
                  sources,
                ),
              ]
            : [],
        );
      } else if (date)
        fallback(
          "date",
          addIssue(
            "date_missing",
            "No se encontró la vigencia en la oferta del cliente.",
            ["date"],
            [productSource],
          ),
          "unresolved",
          [productSource],
        );
      else add("date", "notRequested", undefined, [productSource]);
    } else {
      const cause = addIssue(
        linked.method ? "offer_ambiguous" : "offer_not_found",
        "No se pudo asociar una única oferta del cliente. Producto, precio y vigencia requieren confirmación.",
        ["product", "price", "date"],
        [ref("K"), csv("TXT_PRODUCTO", production.product)],
        "warning",
        linked.candidates
          .slice(0, 30)
          .map((o) => ({ row, ordinal: o.ordinal, text: o.value })),
      );
      for (const id of ["product", "price", "date"]) fallback(id, cause);
    }
    const notes = get("P");
    const cta = notes
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /call to action|\bcta\b|^cpa\s*:|^tagline\s*:/i.test(s))
      .join("\n");
    if (cta) add("cta", "ready", cta, [ref("P")]);
    else if (/descarg|llamado|call.to.action|\bcta\b/i.test(notes))
      add(
        "cta",
        "unresolved",
        undefined,
        [ref("P")],
        [
          addIssue(
            "cta_unresolved",
            "Hay indicaciones de CTA que no se pudieron interpretar.",
            ["cta"],
            [ref("P")],
          ),
        ],
      );
    else add("cta", "notRequested", undefined, [ref("P")]);
  }
  const columns: Record<string, string[]> = {
    product: ["TXT_PRODUCTO"],
    price: ["TXT_PRECIO"],
    date: ["SLOT_FECHA"],
    cta: ["SLOT_CTA"],
    dimensions: ["ANCHO_PX", "ALTO_PX"],
  };
  for (const req of requirements) {
    if (duplicateColumns.some((c) => columns[req.ruleId]?.includes(c))) {
      req.status =
        req.basis === "client" && req.expected ? "conflict" : "unresolved";
      if (req.basis === "production") delete req.expected;
      req.issueIds.push(issues.find((i) => i.code === "csv_duplicate_id")!.id);
      req.sources.push(
        ...(production.duplicates ?? []).map(
          (r): Source => ({
            file: "csv",
            csvLine: r.csvLine,
            text: JSON.stringify(r.values),
          }),
        ),
      );
    }
  }
  for (const i of matrix?.issues ?? []) {
    const affected = requirements.filter((r) =>
      r.sources.some((s) =>
        i.sources.some(
          (source) => s.sheet === source.sheet && s.cell === source.cell,
        ),
      ),
    );
    if (!affected.length) continue;
    issues.push({
      ...i,
      scope: "piece",
      affects: affected.map((r) => r.ruleId),
    });
    for (const r of affected) {
      r.status = "unresolved";
      r.issueIds.push(i.id);
    }
  }
  for (const requirement of requirements)
    for (const issue of issues)
      if (
        issue.affects.includes(requirement.ruleId) &&
        !requirement.issueIds.includes(issue.id)
      )
        requirement.issueIds.push(issue.id);
  return { requirements, issues };
}
