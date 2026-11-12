export function numbered(value: string) {
  return value.split(/\r\n|\r|\n/).flatMap((line) => {
    const match = /^(\d+)\.(.*)$/.exec(line.trim());
    return match
      ? [{ ordinal: match[1].replace(/^0+(?=\d)/, ""), value: match[2].trim() }]
      : [];
  });
}
export function priceAmount(value: string) {
  const match = /^\$?\s*(\d+)(?:[.,](\d{1,2}))?$/.exec(value.trim());
  if (!match) return undefined;
  return `${match[1].replace(/^0+(?=\d)/, "")}.${(match[2] ?? "").padEnd(2, "0")}`;
}
