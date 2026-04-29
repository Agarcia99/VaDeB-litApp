import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { initSupabaseSession } from "../src/supabase";
import { ThemeProvider, useAppTheme } from "../src/theme";
import { LanguageProvider } from "../src/i18n/LanguageContext";
import * as Notifications from "expo-notifications";

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

  useEffect(() => {
    const handleNotificationResponse = (
      response: Notifications.NotificationResponse
    ) => {
      const data = response.notification.request.content.data;

      const matchId = data?.match_id;

      if (typeof matchId === "number") {
        router.push({
          pathname: "/match-summary",
          params: { id: String(matchId) },
        });
        return;
      }

      if (typeof matchId === "string") {
        router.push({
          pathname: "/match-summary",
          params: { id: matchId },
        });
      }
    };

    const subscription =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationResponse
      );

    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) handleNotificationResponse(response);
    });

    return () => {
      subscription.remove();
    };
  }, []);

  return (
    <ThemeProvider>
      <LanguageProvider>
        <RootStack />
      </LanguageProvider>
    </ThemeProvider>
  );
}

