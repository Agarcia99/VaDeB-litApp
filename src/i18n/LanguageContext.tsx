import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Language, translations } from "./translations";

const LANGUAGE_STORAGE_KEY = "app_language";

type TranslationParams = Record<string, string | number>;

type LanguageContextValue = {
  language: Language;
  setLanguage: (language: Language) => Promise<void>;
  toggleLanguage: () => Promise<void>;
  t: (key: string, params?: TranslationParams) => string;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function getNestedValue(obj: unknown, key: string): string | undefined {
  const value = key.split(".").reduce<any>((current, part) => current?.[part], obj);
  return typeof value === "string" ? value : undefined;
}

function interpolate(text: string, params?: TranslationParams): string {
  if (!params) return text;

  return Object.entries(params).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
    text
  );
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>("ca");

  useEffect(() => {
    AsyncStorage.getItem(LANGUAGE_STORAGE_KEY).then((storedLanguage) => {
      if (storedLanguage === "ca" || storedLanguage === "es") {
        setLanguageState(storedLanguage);
      }
    });
  }, []);

  const setLanguage = async (newLanguage: Language) => {
    setLanguageState(newLanguage);
    await AsyncStorage.setItem(LANGUAGE_STORAGE_KEY, newLanguage);
  };

  const toggleLanguage = async () => {
    await setLanguage(language === "ca" ? "es" : "ca");
  };

  const value = useMemo<LanguageContextValue>(
    () => ({
      language,
      setLanguage,
      toggleLanguage,
      t: (key, params) => {
        const text =
          getNestedValue(translations[language], key) ??
          getNestedValue(translations.ca, key) ??
          key;

        return interpolate(text, params);
      },
    }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);

  if (!context) {
    throw new Error("useLanguage must be used inside LanguageProvider");
  }

  return context;
}