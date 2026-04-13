import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../src/supabase";
import { BackButton } from "../components/HeaderButtons";

type PlayerSearchRow = {
  player_id: number;
  player_name: string;
  external_code: string | null;
  team_name: string | null;
  team_short_name: string | null;
  championship_id: number;
};

export default function PlayerSearchScreen() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<PlayerSearchRow[]>([]);

  const norm = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  useEffect(() => {
    const t = setTimeout(() => {
      loadPlayers(query);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    loadPlayers("");
  }, []);

  async function loadPlayers(qRaw: string) {
    setLoading(true);

    const { data: ch } = await supabase
      .from("championship")
      .select("id")
      .eq("is_active", true)
      .maybeSingle();

    if (!ch?.id) {
      setRows([]);
      setLoading(false);
      return;
    }

    let req = supabase
      .from("v_player_summary")
      .select("player_id, player_name, external_code, team_name, team_short_name, championship_id")
      .eq("championship_id", ch.id)
      .order("player_name", { ascending: true });

    const q = norm(qRaw);
    if (q) {
      const like = `%${q}%`;
      req = req.or(`player_name.ilike.${like},team_name.ilike.${like},team_short_name.ilike.${like},external_code.ilike.${like}`);
    }

    const { data } = await req;
    setRows((data as any) ?? []);
    setLoading(false);
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: "#F6F7FB", padding: 16 }}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 5 }}>
        <BackButton onPress={() => router.back()} />
      </View>

      <Text style={{ fontSize: 22, fontWeight: "900", textAlign: "center", color: "#111827", marginTop: 14 }}>
        Cercar jugador
      </Text>

      <View
        style={{
          marginTop: 14,
          backgroundColor: "white",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "#e5e5e5",
          paddingHorizontal: 12,
          paddingVertical: 10,
          ...(Platform.select({
            ios: {
              shadowColor: "#000",
              shadowOpacity: 0.05,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 6 },
            },
            android: { elevation: 2 },
            default: {},
          }) as any),
        }}
      >
        <Text style={{ fontSize: 13, fontWeight: "800", color: "#374151" }}>
          Busca per nom, equip o codi
        </Text>
        <TextInput
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            marginTop: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#E5E7EB",
            backgroundColor: "#FAFAFA",
            fontSize: 15,
            fontWeight: "600",
            color: "#111827",
          }}
        />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          style={{ marginTop: 14 }}
          data={rows}
          keyExtractor={(item) => `${item.championship_id}-${item.player_id}`}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListEmptyComponent={
            <View style={{ paddingVertical: 48, alignItems: "center" }}>
              <Text style={{ fontWeight: "900", fontSize: 18, color: "#111827" }}>Sense jugadors</Text>
              <Text style={{ color: "#6B7280", fontWeight: "700", marginTop: 8 }}>
                No hi ha coincidències al campionat actiu.
              </Text>
            </View>
          }
          renderItem={({ item }) => {
            const subtitle = [item.team_name || item.team_short_name || null, item.external_code || null].filter(Boolean).join(" · ");
            return (
              <Pressable
                onPress={() =>
                  router.push({
                    pathname: "/player-detail",
                    params: { playerId: String(item.player_id) },
                  })
                }
                style={({ pressed }) => ({
                  backgroundColor: "white",
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  padding: 14,
                  marginBottom: 12,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Text style={{ fontWeight: "900", color: "#111827", fontSize: 16 }}>{item.player_name}</Text>
                {subtitle ? (
                  <Text style={{ marginTop: 4, color: "#6B7280", fontWeight: "700" }}>{subtitle}</Text>
                ) : null}
              </Pressable>
            );
          }}
        />
      )}
    </SafeAreaView>
  );
}
