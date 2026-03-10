import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Appearance, ColorSchemeName } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "system" | "light" | "dark";

type ThemeColors = {
  bg: string;
  card: string;
  cardAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  primaryText: string;
  danger: string;
  dangerBg: string;
  success: string;
  successBg: string;
  warn: string;
  warnBg: string;
};

const light: ThemeColors = {
  bg: "#F6F7FB",
  card: "#FFFFFF",
  cardAlt: "#F9FAFB",
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
};

const dark: ThemeColors = {
  bg: "#0B1220",
  card: "#101A2E",
  cardAlt: "#0F172A",
  text: "#F8FAFC",
  muted: "#94A3B8",
  border: "#22314D",
  primary: "#60A5FA",
  primaryText: "#0B1220",
  danger: "#FCA5A5",
  dangerBg: "#3B0B0B",
  success: "#6EE7B7",
  successBg: "#052E2B",
  warn: "#FCD34D",
  warnBg: "#3A2A06",
};

type ThemeCtx = {
  mode: ThemeMode;
  setMode: (m: ThemeMode) => void;
  colors: ThemeColors;
  isDark: boolean;
};

const KEY = "vadebelit_theme_mode";
const Ctx = createContext<ThemeCtx | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>("system");
  const systemScheme = Appearance.getColorScheme();

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (saved === "system" || saved === "light" || saved === "dark") {
          setModeState(saved);
        }
      } catch {}
    })();
  }, []);

  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      // no-op; re-render happens because we read Appearance.getColorScheme() on render,
      // but this keeps us future-proof if RN changes.
    });
    return () => sub.remove();
  }, []);

  const effective: ColorSchemeName = mode === "system" ? systemScheme : mode;

  const value = useMemo<ThemeCtx>(() => {
    const isDark = effective === "dark";
    return {
      mode,
      setMode: (m: ThemeMode) => {
        setModeState(m);
        AsyncStorage.setItem(KEY, m).catch(() => {});
      },
      colors: isDark ? dark : light,
      isDark,
    };
  }, [mode, effective]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppTheme must be used within ThemeProvider");
  return ctx;
}
