"use client";

import { useContext, useState, useEffect } from "react";
import { clientConfig } from "@/config/tenant.config";
import { ThemeContext } from "@/app/contexts/themeContextDef";

interface BrandLogoProps {
  className?: string;
  /** Forzar un color específico (ignora el tema) */
  forceColor?: "white" | "black";
}

/**
 * Logo de marca - se adapta al tema automáticamente
 * Negro en light mode, blanco en dark mode
 * Ocupa todo el ancho disponible con padding
 * Usa forceColor para forzar un color específico (ej: login siempre blanco)
 */
export function BrandLogo({ className = "", forceColor }: BrandLogoProps) {
  const { logo } = clientConfig;
  const themeContext = useContext(ThemeContext);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Si hay forceColor, usarlo directamente
  // Si no, usar el tema (con fallback a currentColor durante SSR)
  let fillColor: string;
  if (forceColor) {
    fillColor = forceColor;
  } else if (mounted) {
    fillColor = themeContext?.resolvedTheme === "dark" ? "white" : "black";
  } else {
    fillColor = "currentColor";
  }

  // Reemplazar cualquier fill (white, black, currentColor, etc.) por el color del tema
  const svgWithColor = logo.svg
    .replace(/fill="[^"]*"/g, `fill="${fillColor}"`)
    .replace(/fill='[^']*'/g, `fill='${fillColor}'`);

  return (
    <div
      className={`w-full max-w-[180px] max-h-[40px] px-4 text-black dark:text-white [&>svg]:max-h-[40px] [&>svg]:w-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: svgWithColor }}
    />
  );
}

interface BrandLogoIconProps {
  className?: string;
  /** Forzar un color específico (ignora el tema) */
  forceColor?: "white" | "black";
}

/**
 * Solo el icono del logo - se adapta al tema automáticamente
 * Negro en light mode, blanco en dark mode
 * Usa forceColor para forzar un color específico
 */
export function BrandLogoIcon({
  className = "",
  forceColor,
}: BrandLogoIconProps) {
  const { logo } = clientConfig;
  const themeContext = useContext(ThemeContext);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  let fillColor: string;
  if (forceColor) {
    fillColor = forceColor;
  } else if (mounted) {
    fillColor = themeContext?.resolvedTheme === "dark" ? "white" : "black";
  } else {
    fillColor = "currentColor";
  }

  // Reemplazar cualquier fill (white, black, currentColor, etc.) por el color del tema
  const svgWithColor = logo.svg
    .replace(/fill="[^"]*"/g, `fill="${fillColor}"`)
    .replace(/fill='[^']*'/g, `fill='${fillColor}'`);

  return (
    <div
      className={`max-w-[160px] max-h-[28px] text-black dark:text-white [&>svg]:max-h-[28px] [&>svg]:w-auto ${className}`}
      dangerouslySetInnerHTML={{ __html: svgWithColor }}
    />
  );
}
