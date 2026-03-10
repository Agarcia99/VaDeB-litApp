import { useColorScheme } from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type ThemeMode = "system" | "light" | "dark";

export type BelitTheme = {
  mode: "light" | "dark";
  colors: {
    bg: string;
    surface: string;
    surface2: string;
    text: string;
    textMuted: string;
    border: string;
    primary: string;
    primarySoft: string;
    success: string;
    warning: string;
    danger: string;
  };
  radius: { sm: number; md: number; lg: number; xl: number; pill: number };
  space: { xs: number; sm: number; md: number; lg: number; xl: number };
  shadow: { card: any; soft: any };
  typography: {
    h1: any;
    h2: any;
    h3: any;
    body: any;
    caption: any;
    mono: any;
  };
};

const KEY = "belit_theme_mode";

const base = {
  radius: { sm: 10, md: 14, lg: 18, xl: 24, pill: 999 },
  space: { xs: 6, sm: 10, md: 14, lg: 18, xl: 24 },
  typography: {
    h1: { fontSize: 28, fontWeight: "800", letterSpacing: -0.3 },
    h2: { fontSize: 22, fontWeight: "800", letterSpacing: -0.2 },
    h3: { fontSize: 18, fontWeight: "700" },
    body: { fontSize: 15, fontWeight: "600" },
    caption: { fontSize: 12, fontWeight: "700" },
    mono: { fontSize: 12, fontWeight: "800" },
  },
};

export const lightTheme: BelitTheme = {
  mode: "light",
  colors: {
    bg: "#F6F7FB",
    surface: "#FFFFFF",
    surface2: "#F1F3FA",
    text: "#0E1320",
    textMuted: "#56607A",
    border: "rgba(16, 24, 40, 0.10)",
    primary: "#2F6BFF",
    primarySoft: "rgba(47,107,255,0.12)",
    success: "#16A34A",
    warning: "#F59E0B",
    danger: "#EF4444",
  },
  ...base,
  shadow: {
    card: {
      shadowColor: "#000",
      shadowOpacity: 0.10,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      elevation: 4,
    },
    soft: {
      shadowColor: "#000",
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 8 },
      elevation: 3,
    },
  },
};

export const darkTheme: BelitTheme = {
  mode: "dark",
  colors: {
    bg: "#0B1020",
    surface: "rgba(255,255,255,0.06)",
    surface2: "rgba(255,255,255,0.10)",
    text: "#EEF2FF",
    textMuted: "rgba(238,242,255,0.72)",
    border: "rgba(255,255,255,0.12)",
    primary: "#7AA2FF",
    primarySoft: "rgba(122,162,255,0.18)",
    success: "#22C55E",
    warning: "#FBBF24",
    danger: "#FB7185",
  },
  ...base,
  shadow: {
    card: {
      shadowColor: "#000",
      shadowOpacity: 0.35,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 12 },
      elevation: 7,
    },
    soft: {
      shadowColor: "#000",
      shadowOpacity: 0.25,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 10 },
      elevation: 5,
    },
  },
};

export function useBelitTheme() {
  const system = useColorScheme() ?? "light";
  const [mode, setModeState] = useState<ThemeMode>("system");

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (saved === "system" || saved === "light" || saved === "dark") setModeState(saved);
      } catch {}
    })();
  }, []);

  const setMode = useCallback(async (m: ThemeMode) => {
    setModeState(m);
    try {
      await AsyncStorage.setItem(KEY, m);
    } catch {}
  }, []);

  const effective: "light" | "dark" = mode === "system" ? (system === "dark" ? "dark" : "light") : mode;
  const theme = useMemo(() => (effective === "dark" ? darkTheme : lightTheme), [effective]);

  return { theme, mode, setMode };
}
