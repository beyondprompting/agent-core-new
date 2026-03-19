"use client";

import React, { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { ThemeContext, type ThemeContextType } from "./themeContextDef";

type Theme = "light" | "dark" | "system";

interface ThemeProviderProps {
  children: React.ReactNode;
}

// Storage key único para el tema
const THEME_STORAGE_KEY = "agent-theme";

export function ThemeProvider({ children }: ThemeProviderProps) {
  const preferences = useQuery(api.data.preferences.getUserPreferences);
  const setThemeMutation = useMutation(api.data.preferences.setTheme);

  // Estado local para el tema mientras se carga de la DB
  const [localTheme, setLocalTheme] = useState<Theme>(() => {
    if (typeof window !== "undefined") {
      const cached = localStorage.getItem(THEME_STORAGE_KEY);
      if (cached === "light" || cached === "dark" || cached === "system") {
        return cached;
      }
      // Si no hay tema guardado, setear light por defecto
      localStorage.setItem(THEME_STORAGE_KEY, "light");
    }
    return "light";
  });
  const [systemTheme, setSystemTheme] = useState<"light" | "dark">("light");
  const [isLoading, setIsLoading] = useState(true);
  const [isInitialized, setIsInitialized] = useState(false);

  // Detectar preferencia del sistema
  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    const handleChange = (e: MediaQueryListEvent | MediaQueryList) => {
      setSystemTheme(e.matches ? "dark" : "light");
    };

    handleChange(mediaQuery);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  // Sincronizar tema desde las preferencias del usuario
  useEffect(() => {
    if (preferences !== undefined) {
      const userTheme = preferences?.theme ?? "light";
      setLocalTheme(userTheme);

      if (typeof window !== "undefined") {
        const currentCached = localStorage.getItem(THEME_STORAGE_KEY);
        if (currentCached !== userTheme) {
          localStorage.setItem(THEME_STORAGE_KEY, userTheme);
        }
      }
      setIsLoading(false);
      setIsInitialized(true);
    }
  }, [preferences]);

  // Calcular el tema resuelto
  const resolvedTheme = localTheme === "system" ? systemTheme : localTheme;

  // Aplicar clase dark al HTML element
  useEffect(() => {
    if (!isInitialized) return;

    const root = document.documentElement;

    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolvedTheme, isInitialized]);

  // Función para cambiar el tema
  const setTheme = async (newTheme: Theme) => {
    if (newTheme === localTheme) return;

    setLocalTheme(newTheme);

    if (typeof window !== "undefined") {
      const currentCached = localStorage.getItem(THEME_STORAGE_KEY);
      if (currentCached !== newTheme) {
        localStorage.setItem(THEME_STORAGE_KEY, newTheme);
      }
    }

    try {
      await setThemeMutation({ theme: newTheme });
    } catch (error) {
      console.error("Error saving theme preference:", error);
    }
  };

  const value: ThemeContextType = {
    theme: localTheme,
    resolvedTheme,
    setTheme,
    isLoading,
  };

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
