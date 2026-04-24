import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "light" | "dark";

export type AppColors = {
  /** Fons principal de la pantalla */
  bg: string;
  /** Fons de targetes / panells */
  card: string;
  /** Fons alternatiu (inputs, files) */
  cardAlt: string;
  /** Text principal */
  text: string;
  /** Text secundari / subtítols */
  muted: string;
  /** Color de vores i separadors */
  border: string;
  /** Color d'acció principal (botons, links) */
  primary: string;
  /** Text sobre fons primary */
  primaryText: string;
  /** Color de perill */
  danger: string;
  /** Fons de perill (badges) */
  dangerBg: string;
  /** Color d'èxit */
  success: string;
  /** Fons d'èxit */
  successBg: string;
  /** Color d'advertència */
  warn: string;
  /** Fons d'advertència */
  warnBg: string;
  /** Fons per destacar el timer quan està corrent */
  timerRunningBg: string;
  /** Fons verd per èxit */
  cardgreen: string;
  /** Fons groc per advertència */
  cardyellow: string;
  /** Fons vermell per perill */
  cardred: string;
  /** Fons blau per informació */
  cardblue: string;
};

const light: AppColors = {
  bg: "#F6F7FB",
  card: "#FFFFFF",
  cardAlt: "#F1F3F9",
  cardgreen: "#D1FAE5",
  cardyellow: "#FEF3C7",
  cardred: "#FEE2E2",
  cardblue: "#E0E7FF",
  text: "#0F172A",
  muted: "#64748B",
  border: "#E5E7EB",
  primary: "#111827",
  primaryText: "#FFFFFF",
  danger: "#B91C1C",
  dangerBg: "#FEE2E2",
  success: "#047857",
  successBg: "#D1FAE5",
  warn: "#92400E",
  warnBg: "#FEF3C7",
  timerRunningBg: "#E0E7FF",
};

const dark: AppColors = {
  bg: "#0D1117",
  card: "#161B22",
  cardAlt: "#21262D",
  cardgreen: "#064E3B",
  cardyellow: "#78350F",
  cardred: "#7A1515",
  cardblue: "#1E40AF",
  text: "#F0F6FC",
  muted: "#8B949E",
  border: "#30363D",
  primary: "#58A6FF",
  primaryText: "#0D1117",
  danger: "#FF7B72",
  dangerBg: "#3D1515",
  success: "#3FB950",
  successBg: "#0D3322",
  warn: "#E3B341",
  warnBg: "#2D2200",
  timerRunningBg: "#3D1E6D",
};

type ThemeCtx = {
  mode: ThemeMode;
  toggleMode: () => void;
  colors: AppColors;
  isDark: boolean;
};

const STORAGE_KEY = "vadebelit_theme_v2";
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("light");
  const [loaded, setLoaded] = useState(false);

  // Carrega la preferència guardada
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (saved === "light" || saved === "dark") setMode(saved);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const value = useMemo<ThemeCtx>(() => ({
    mode,
    toggleMode: () => {
      const next: ThemeMode = mode === "light" ? "dark" : "light";
      setMode(next);
      AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {});
    },
    colors: mode === "dark" ? dark : light,
    isDark: mode === "dark",
  }), [mode]);

  // Evita un flash de tema equivocat mentre es llegeix AsyncStorage
  if (!loaded) return null;

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppTheme must be used within ThemeProvider");
  return ctx;
}
