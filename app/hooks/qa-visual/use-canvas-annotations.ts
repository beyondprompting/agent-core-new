import { useRef, useState } from "react";

export type Tool = "select" | "hand" | "pin" | "rectangle" | "draw";
export type Mark = {
  id: number | string;
  pieceId: string;
  version: number;
  type: "rectangle" | "draw";
  points: { x: number; y: number }[];
};

export function useCanvasAnnotations(
  activeId: string,
  version: number,
  tool: Tool,
  onPin: (point: { x: number; y: number }) => void,
  onAnnotation: (mark: Mark) => void,
) {
  const [drawing, setDrawing] = useState<Mark | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{
    x: number;
    y: number;
    startX: number;
    startY: number;
  } | null>(null);
  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
      ),
      y: Math.max(
        0,
        Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
      ),
    };
  };
  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    if (tool === "pin") {
      onPin(point(event));
      return;
    }
    if (tool === "hand") {
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        startX: pan.x,
        startY: pan.y,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    if (tool === "rectangle" || tool === "draw") {
      setDrawing({
        id: Date.now(),
        pieceId: activeId,
        version,
        type: tool,
        points: [point(event)],
      });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  };
  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (drag.current)
      setPan({
        x: drag.current.startX + event.clientX - drag.current.x,
        y: drag.current.startY + event.clientY - drag.current.y,
      });
    if (drawing) {
      const p = point(event);
      setDrawing((prev) =>
        prev
          ? {
              ...prev,
              points:
                prev.type === "draw"
                  ? prev.points.length < 500
                    ? [...prev.points, p]
                    : [...prev.points.slice(0, 499), p]
                  : [prev.points[0], p],
            }
          : null,
      );
    }
  };
  const onPointerUp = () => {
    drag.current = null;
    if (drawing && drawing.points.length > 1) onAnnotation(drawing);
    setDrawing(null);
  };
  return {
    drawing,
    pan,
    setPan,
    onPointerDown,
    onPointerMove,
    onPointerUp,
  };
}
