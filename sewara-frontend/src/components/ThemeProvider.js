"use client";

import { createContext, useContext, useEffect, useCallback, useSyncExternalStore } from "react";

const ThemeContext = createContext();

export function useTheme() {
  return useContext(ThemeContext);
}

function getStoredTheme() {
  if (typeof window === "undefined") return "system";
  return localStorage.getItem("rentalpro_theme") || "system";
}

function subscribeTheme(cb) {
  window.addEventListener("storage", cb);
  window.addEventListener("rentalpro-theme-change", cb);
  return () => {
    window.removeEventListener("storage", cb);
    window.removeEventListener("rentalpro-theme-change", cb);
  };
}

export default function ThemeProvider({ children }) {
  const theme = useSyncExternalStore(subscribeTheme, getStoredTheme, () => "system");

  const applyTheme = useCallback((t) => {
    const isDark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", isDark);
  }, []);

  const setTheme = useCallback(
    (t) => {
      localStorage.setItem("rentalpro_theme", t);
      applyTheme(t);
      window.dispatchEvent(new CustomEvent("rentalpro-theme-change"));
    },
    [applyTheme]
  );

  useEffect(() => {
    applyTheme(theme);
  }, [theme, applyTheme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") applyTheme("system");
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme, applyTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}
