import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../src/supabase";
import { BackButton } from "../components/HeaderButtons";
import { formatDateDDMMYYYY_HHMM } from "../src/utils/format";
import { useAppTheme } from "../src/theme";

type SummaryRow = {
  championship_id: number;
  team_id: number;
  player_id: number;
  player_name: string;
  external_code: string | null;
  team_name: string | null;
  team_short_name: string | null;
  is_captain: boolean;
  team_matches: number;
  matches_played: number;
  matches_missed: number;
  total_canes: number;
  total_matacanes: number;
  total_air_catches: number;
  total_team_bonus_canas: number;
  total_defender_bonus_canas: number;
  matches_with_elimination: number;
  eliminated_rounds: number;
};

type MatchRow = {
  match_id: number;
  match_date: string | null;
  started_at: string | null;
  finished_at: string | null;
  is_finished: boolean;
  display_status: string | null;
  phase_name: string | null;
  opponent_team_name: string | null;
  opponent_team_short_name: string | null;
  team_score: number;
  opponent_score: number;
  did_play: boolean;
  attack_round_entries: number;
  defense_round_entries: number;
  eliminated_rounds: number;
  eliminated_any: boolean;
  total_canes: number;
  total_matacanes: number;
  total_air_catches: number;
  team_bonus_canas: number;
  defender_bonus_canas: number;
};

function StatChip({ label, value, tone }: { label: string; value: string | number; tone?: "green" | "red" | "blue" | "gray" | "purple" }) {
  const { isDark } = useAppTheme();
  const theme = isDark
    ? tone === "green"
      ? { bg: "rgba(34, 197, 94, 0.15)", fg: "#4ade80" }
      : tone === "red"
      ? { bg: "rgba(239, 68, 68, 0.15)", fg: "#f87171" }
      : tone === "blue"
      ? { bg: "rgba(59, 130, 246, 0.15)", fg: "#60a5fa" }
      : tone === "purple"
      ? { bg: "rgba(139, 92, 246, 0.15)", fg: "#a78bfa" }
      : { bg: "rgba(148, 163, 184, 0.12)", fg: "#94a3b8" }
    : tone === "green"
      ? { bg: "#DCFCE7", fg: "#166534" }
      : tone === "red"
      ? { bg: "#FEE2E2", fg: "#991B1B" }
      : tone === "blue"
      ? { bg: "#DBEAFE", fg: "#1D4ED8" }
      : tone === "purple"
      ? { bg: "#EDE9FE", fg: "#6D28D9" }
      : { bg: "#F3F4F6", fg: "#374151" };

  return (
    <View
      style={{
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 999,
        backgroundColor: theme.bg,
      }}
    >
      <Text style={{ color: theme.fg, fontWeight: "900", fontSize: 12 }}>
        {label}: {value}
      </Text>
    </View>
  );
}

export default function PlayerDetailScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const params = useLocalSearchParams<{ playerId?: string }>();
  const playerId = Number(params.playerId);

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [tab, setTab] = useState<"matches" | "stats">("matches");

  useEffect(() => {
    load();
  }, [playerId]);

  async function load() {
    if (!playerId || Number.isNaN(playerId)) {
      setLoading(false);
      return;
    }

    setLoading(true);

    const { data: ch } = await supabase
      .from("championship")
      .select("id")
      .eq("is_active", true)
      .maybeSingle();

    if (!ch?.id) {
      setSummary(null);
      setMatches([]);
      setLoading(false);
      return;
    }

    const { data: s } = await supabase
      .from("v_player_summary")
      .select("*")
      .eq("championship_id", ch.id)
      .eq("player_id", playerId)
      .maybeSingle();

    const { data: m } = await supabase
      .from("v_player_match_detail")
      .select("*")
      .eq("championship_id", ch.id)
      .eq("player_id", playerId)
      .order("match_date", { ascending: true });

    setSummary((s as any) ?? null);
    setMatches((m as any) ?? []);
    setLoading(false);
  }

  const averages = useMemo(() => {
    const played = summary?.matches_played ?? 0;
    const avgCanes = played > 0 ? Math.round(((summary?.total_canes ?? 0) / played) * 10) / 10 : 0;
    return { avgCanes };
  }, [summary]);

  if (loading) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  if (!summary) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <BackButton onPress={() => router.back()} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <Text style={{ fontWeight: "900", fontSize: 20, color: colors.text }}>Jugador no trobat</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
        <BackButton onPress={() => router.back()} />

        <View
          style={{
            marginTop: 14,
            backgroundColor: colors.card,
            borderRadius: 18,
            padding: 16,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontSize: 24, fontWeight: "900", color: colors.text, textAlign: "center" }}>
            {summary.player_name}
          </Text>
          <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "800", textAlign: "center" }}>
            {summary.team_name || summary.team_short_name }
            {summary.is_captain ? " · Capità" : ""}
          </Text>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <View style={{ flex: 1, backgroundColor: colors.cardAlt, borderRadius: 14, padding: 12, alignItems: "center" }}>
              <Text style={{ color: colors.muted, fontWeight: "800", fontSize: 12 }}>Partits</Text>
              <Text style={{ marginTop: 4, fontWeight: "900", fontSize: 20, color: colors.text }}>{summary.matches_played}/{summary.team_matches}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: isDark ? "rgba(34, 197, 94, 0.12)" : "#F0FDF4", borderRadius: 14, padding: 12, alignItems: "center" }}>
              <Text style={{ color: isDark ? "#4ade80" : "#166534", fontWeight: "800", fontSize: 12 }}>Canes</Text>
              <Text style={{ marginTop: 4, fontWeight: "900", fontSize: 20, color: colors.text }}>{summary.total_canes}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: isDark ? "rgba(59, 130, 246, 0.12)" : "#EFF6FF", borderRadius: 14, padding: 12, alignItems: "center" }}>
              <Text style={{ color: isDark ? "#60a5fa" : "#1D4ED8", fontWeight: "800", fontSize: 12 }}>Recollides</Text>
              <Text style={{ marginTop: 4, fontWeight: "900", fontSize: 20, color: colors.text }}>{summary.total_air_catches}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1, backgroundColor: isDark ? "rgba(239, 68, 68, 0.12)" : "#FEF2F2", borderRadius: 14, padding: 12, alignItems: "center" }}>
              <Text style={{ color: isDark ? "#f87171" : "#991B1B", fontWeight: "800", fontSize: 12 }}>Matacanes</Text>
              <Text style={{ marginTop: 4, fontWeight: "900", fontSize: 20, color: colors.text }}>{summary.total_matacanes}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: isDark ? "rgba(139, 92, 246, 0.12)" : "#F5F3FF", borderRadius: 14, padding: 12, alignItems: "center" }}>
              <Text style={{ color: isDark ? "#a78bfa" : "#6D28D9", fontWeight: "800", fontSize: 12 }}>Mitjana canes</Text>
              <Text style={{ marginTop: 4, fontWeight: "900", fontSize: 20, color: colors.text }}>{averages.avgCanes}</Text>
            </View>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
          <Pressable
            onPress={() => setTab("matches")}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: tab === "matches" ? colors.primary : colors.card,
              borderWidth: 1,
              borderColor: tab === "matches" ? colors.primary : colors.border,
              alignItems: "center",
            }}
          >
            <Text style={{ color: tab === "matches" ? colors.primaryText : colors.text, fontWeight: "900" }}>Partits</Text>
          </Pressable>

          <Pressable
            onPress={() => setTab("stats")}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: tab === "stats" ? colors.primary : colors.card,
              borderWidth: 1,
              borderColor: tab === "stats" ? colors.primary : colors.border,
              alignItems: "center",
            }}
          >
            <Text style={{ color: tab === "stats" ? colors.primaryText : colors.text, fontWeight: "900" }}>Stats</Text>
          </Pressable>
        </View>

        {tab === "matches" ? (
          <View style={{ marginTop: 16 }}>
            {matches.map((item) => {
              const result =
                item.is_finished
                  ? item.team_score > item.opponent_score
                    ? "V"
                    : item.team_score < item.opponent_score
                    ? "D"
                    : "E"
                  : item.display_status === "AJORNAT"
                  ? "AJ"
                  : item.started_at
                  ? "LIVE"
                  : "PEN";

              const resultTone =
                result === "V"
                  ? "green"
                  : result === "D"
                  ? "red"
                  : result === "LIVE"
                  ? "blue"
                  : result === "AJ"
                  ? "purple"
                  : "gray";

              return (
                <View
                  key={item.match_id}
                  style={{
                    backgroundColor: colors.card,
                    borderRadius: 16,
                    borderWidth: 1,
                    borderColor: colors.border,
                    padding: 14,
                    marginBottom: 12,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "900", color: colors.text, fontSize: 13 }}>
                        vs {item.opponent_team_name || item.opponent_team_short_name || "Rival"}
                      </Text>
                      <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "700" }}>
                        {formatDateDDMMYYYY_HHMM(item.match_date, "·") || "Data pendent"}
                      </Text>
                      {item.phase_name ? (
                        <Text style={{ marginTop: 2, color: colors.muted, fontWeight: "700" }}>{item.phase_name}</Text>
                      ) : null}
                    </View>

                    <View style={{ alignItems: "flex-end" }}>
                      <StatChip label="Resultat" value={result} tone={resultTone} />
                      <Text style={{ marginTop: 8, fontWeight: "900", color: colors.text }}>
                        {item.team_score} - {item.opponent_score}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    <StatChip label="Participació" value={item.did_play ? "Va jugar" : "No va jugar"} tone={item.did_play ? "green" : "gray"} />
                    <StatChip label="Canes" value={item.total_canes} tone="green" />
                    <StatChip label="Matacanes" value={item.total_matacanes} tone="red" />
                    <StatChip label="Recollides" value={item.total_air_catches} tone="blue" />
                    <StatChip label="Eliminat" value={item.eliminated_any ? "Sí" : "No"} tone={item.eliminated_any ? "red" : "gray"} />
                    <StatChip label="Rondes eliminat" value={item.eliminated_rounds} tone="red" />
                  </View>
                </View>
              );
            })}
          </View>
        ) : (
          <View style={{ marginTop: 16, gap: 12 }}>
            <View style={{ backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
              <Text style={{ fontWeight: "900", color: colors.text, fontSize: 17, marginBottom: 10 }}>Resum general</Text>

              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                <StatChip label="Partits equip" value={summary.team_matches} />
                <StatChip label="Jugats" value={summary.matches_played} tone="green" />
                <StatChip label="No jugats" value={summary.matches_missed} />
                <StatChip label="Canes" value={summary.total_canes} tone="green" />
                <StatChip label="Matacanes" value={summary.total_matacanes} tone="red" />
                <StatChip label="Recollides" value={summary.total_air_catches} tone="blue" />
                <StatChip label="Elim. partits" value={summary.matches_with_elimination} tone="red" />
                <StatChip label="Elim. rondes" value={summary.eliminated_rounds} tone="red" />
                <StatChip label="Bonus equip" value={summary.total_team_bonus_canas} tone="purple" />
                <StatChip label="Bonus defensa" value={summary.total_defender_bonus_canas} tone="purple" />
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
