import { useEffect } from "react";
import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { initSupabaseSession } from "../src/supabase";
import { ThemeProvider, useAppTheme } from "../src/theme";

function RootStack() {
  const { colors } = useAppTheme();
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={["top"]}>
      <Stack
        screenOptions={{
          title: "",
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
        }}
      />
    </SafeAreaView>
  );
}

export default function Layout() {
  useEffect(() => {
    initSupabaseSession();
  }, []);

  return (
    <ThemeProvider>
      <RootStack />
    </ThemeProvider>
  );
}

