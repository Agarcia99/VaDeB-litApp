import { Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { View } from "react-native";

export default function Layout() {
  return (
<SafeAreaView style={{ flex: 1 }} edges={["top"]}>
<Stack
      screenOptions={{
        title: "",
        headerShown: false,
        headerStyle: { height: 30 },
        headerBackVisible: false, // amaga el botó de tornar
        headerLeft: () => null,   // per assegurar que no surt res a l'esquerra
        headerShadowVisible: false, // opcional: treu la línia inferior
      }}
    /></SafeAreaView>
  );
}

