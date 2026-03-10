import React from "react";
import { Pressable, Text, Platform, ViewStyle, StyleProp } from "react-native";

export function BackButton({
  onPress,
  style,
}: {
  onPress: () => void;
  style?: StyleProp<ViewStyle>;
}) {
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
          borderWidth:1,
          borderColor: "#ddd",
          backgroundColor: "white",
          opacity: pressed ? 0.85 : 1,
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
      <Text style={{ fontSize: 18, fontWeight: "800" }}>←</Text>
      <Text style={{ fontSize: 15, fontWeight: "700" }}>Tornar</Text>
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
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        {
          paddingVertical: 10,
          paddingHorizontal: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#ddd",
          backgroundColor: "white",
          opacity: pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <Text style={{ fontWeight: "800" }}>{label}</Text>
    </Pressable>
  );
}
