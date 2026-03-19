"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/app/lib/utils";

interface TooltipProps {
  children: React.ReactNode;
  content: string;
  className?: string;
  delayMs?: number;
}

export function Tooltip({
  children,
  content,
  className,
  delayMs = 300,
}: TooltipProps) {
  const [isVisible, setIsVisible] = React.useState(false);
  const [position, setPosition] = React.useState({ top: 0, left: 0 });
  const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const triggerRef = React.useRef<HTMLDivElement>(null);

  const updatePosition = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setPosition({
        top: rect.top - 8,
        left: rect.left,
      });
    }
  };

  const handleMouseEnter = () => {
    updatePosition();
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, delayMs);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  return (
    <div
      ref={triggerRef}
      className="w-full"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {isVisible &&
        content &&
        typeof window !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              transform: "translateY(-100%)",
            }}
            className={cn(
              "z-[9999] px-2 py-1 text-xs rounded-md pointer-events-none",
              "bg-popover text-popover-foreground shadow-md border border-border",
              "max-w-[200px] whitespace-normal break-words",
              className,
            )}
          >
            {content}
          </div>,
          document.body,
        )}
    </div>
  );
}
