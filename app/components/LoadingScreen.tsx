"use client";

import { useState, useEffect } from "react";
import { clientConfig } from "@/config/tenant.config";

// Storage key único para el tema
const THEME_STORAGE_KEY = "agent-theme";

/**
 * Componente de loading unificado - solo logo con animación pulse
 * Lee el tema del localStorage para determinar colores
 * Default: light si no hay tema guardado (y lo setea)
 */
export function LoadingScreen() {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    let savedTheme = localStorage.getItem(THEME_STORAGE_KEY);

    // Si no hay tema, setear light por defecto
    if (!savedTheme) {
      savedTheme = "light";
      localStorage.setItem(THEME_STORAGE_KEY, "light");
    }

    const systemDark = window.matchMedia(
      "(prefers-color-scheme: dark)",
    ).matches;

    // Determinar si es dark: explícitamente 'dark' o 'system' con sistema oscuro
    const isDarkMode =
      savedTheme === "dark" || (savedTheme === "system" && systemDark);

    setIsDark(isDarkMode);
    setMounted(true);
  }, []);

  // Antes del mount, mostrar placeholder con fondo light por defecto
  if (!mounted) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-white">
        <div className="w-48 h-12 animate-pulse" />
      </div>
    );
  }

  // Determinar colores basados en el tema
  const bgColor = isDark ? "bg-slate-900" : "bg-white";
  const logoColor = isDark ? "white" : "black";

  // Reemplazar cualquier fill por el color del tema
  const svgWithColor = clientConfig.logo.svg
    .replace(/fill="[^"]*"/g, `fill="${logoColor}"`)
    .replace(/fill='[^']*'/g, `fill='${logoColor}'`);

  return (
    <div
      className={`min-h-screen w-full flex items-center justify-center ${bgColor} transition-colors`}
    >
      <div className="animate-pulse">
        <div
          className="w-32"
          dangerouslySetInnerHTML={{ __html: svgWithColor }}
        />
      </div>
    </div>
  );
}

/**
 * Componente de loading simple (sin logo)
 */
export function SimpleLoadingSpinner({
  size = "md",
}: {
  size?: "sm" | "md" | "lg";
}) {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  };

  return (
    <div className="flex items-center justify-center">
      <div
        className={`${sizeClasses[size]} border-2 border-muted border-t-primary rounded-full animate-spin`}
      />
    </div>
  );
}

/**
 * Skeleton de texto para placeholders
 */
export function TextSkeleton({
  lines = 1,
  className = "",
}: {
  lines?: number;
  className?: string;
}) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-4 bg-muted rounded animate-pulse"
          style={{ width: i === lines - 1 ? "75%" : "100%" }}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton de card para items en listas
 */
export function CardSkeleton() {
  return (
    <div className="p-4 border border-border rounded-lg animate-pulse">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 bg-muted rounded-full" />
        <div className="flex-1">
          <div className="h-4 bg-muted rounded w-3/4 mb-2" />
          <div className="h-3 bg-muted rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 bg-muted rounded w-full" />
        <div className="h-3 bg-muted rounded w-5/6" />
      </div>
    </div>
  );
}
