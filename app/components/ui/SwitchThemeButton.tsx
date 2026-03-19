import React, { useState, useEffect } from "react";
import { Sun, Moon } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";

export function SwitchThemeButton() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // Evitar hydration mismatch - solo renderizar tema real después del mount
  useEffect(() => {
    setMounted(true);
  }, []);

  // Durante SSR y antes del mount, mostrar un placeholder neutral
  if (!mounted) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={false}
        className="relative inline-flex h-7 w-14 items-center rounded-full border transition-colors focus:outline-none cursor-pointer"
      >
        <span className="absolute inset-0 rounded-full transition-colors bg-slate-200 border-slate-300" />
        <Sun className="absolute left-1.5 h-4 w-4 transition-colors text-slate-400" />
        <Moon className="absolute right-1.5 h-4 w-4 transition-colors text-slate-400" />
        <span className="relative z-10 inline-block h-6 w-6 transform rounded-full shadow-sm transition-transform translate-x-1 bg-white" />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "light" ? "dark" : "light")}
      role="switch"
      aria-checked={resolvedTheme === "dark"}
      className="relative inline-flex h-7 w-14 items-center rounded-full border transition-colors focus:outline-none cursor-pointer"
    >
      {/* Track */}
      <span
        className={[
          "absolute inset-0 rounded-full transition-colors",
          resolvedTheme === "dark"
            ? "bg-slate-900 border-slate-700"
            : "bg-slate-200 border-slate-300",
        ].join(" ")}
      />

      {/* Icono sol */}
      <Sun
        className={[
          "absolute left-1.5 h-4 w-4 transition-colors",
          resolvedTheme === "light" ? "text-amber-500" : "text-slate-400",
        ].join(" ")}
      />

      {/* Icono luna */}
      <Moon
        className={[
          "absolute right-1.5 h-4 w-4 transition-colors",
          resolvedTheme === "dark" ? "text-sky-300" : "text-slate-400",
        ].join(" ")}
      />

      {/* Thumb */}
      <span
        className={[
          "relative z-10 inline-block h-6 w-6 transform rounded-full shadow-sm transition-transform",
          resolvedTheme === "dark"
            ? "translate-x-7 bg-slate-800"
            : "translate-x-1 bg-white",
        ].join(" ")}
      />
    </button>
  );
}
