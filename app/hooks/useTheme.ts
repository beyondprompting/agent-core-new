"use client";

import { useContext } from "react";
import { ThemeContext, type ThemeContextType } from "../contexts/themeContextDef";

export function useTheme(): ThemeContextType {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
