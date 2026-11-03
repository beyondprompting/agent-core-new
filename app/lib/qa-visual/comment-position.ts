export function getCommentPosition({
  pinX,
  pinY,
  cardWidth,
  cardHeight,
  viewportWidth,
  viewportHeight,
}: {
  pinX: number;
  pinY: number;
  cardWidth: number;
  cardHeight: number;
  viewportWidth: number;
  viewportHeight: number;
}) {
  const margin = 12;
  const gap = 22;
  const clamp = (value: number, min: number, max: number) =>
    Math.max(min, Math.min(value, Math.max(min, max)));
  const fitsRight = pinX + gap + cardWidth <= viewportWidth - margin;
  const fitsLeft = pinX - gap - cardWidth >= margin;
  const side = fitsRight || !fitsLeft ? "right" : "left";
  const left = clamp(
    side === "right" ? pinX + gap : pinX - cardWidth - gap,
    margin,
    viewportWidth - cardWidth - margin,
  );
  const top = clamp(pinY - 43, margin, viewportHeight - cardHeight - margin);
  const arrowTop = clamp(pinY - top, 18, cardHeight - 18);
  const showArrow = side === "right" ? left > pinX : left + cardWidth < pinX;
  return { left, top, side, arrowTop, showArrow };
}
