import React from "react";
import { Pressable, Text, Platform, ViewStyle, StyleProp } from "react-native";
import { useAppTheme } from "../src/theme";

export function BackButton({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          alignSelf: "flex-start",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingVertical: 8,
          paddingHorizontal: 10,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          opacity: pressed ? 0.75 : 1,
        },
        Platform.select({
          ios: {
            shadowColor: "#000",
            shadowOpacity: 0.06,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
          },
          android: { elevation: 2 },
        }) as any,
        style,
      ]}
    >
      <Text style={{ fontSize: 18, fontWeight: "800", color: colors.text }}>←</Text>
      <Text style={{ fontSize: 15, fontWeight: "700", color: colors.text }}>Tornar</Text>
    </Pressable>
  );
}

export function RefreshButton({
  onPress,
  style,
  label = "↻ Actualitzar",
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
  label?: string;
}) {
  const { colors } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          opacity: pressed ? 0.75 : 1,
        },
        style,
      ]}
    >
      <Text style={{ fontWeight: "800", color: colors.text }}>{label}</Text>
    </Pressable>
  );
}

