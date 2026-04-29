import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  FlatList,
  Pressable,
  ScrollView,
  Platform,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../src/supabase";
import { BackButton } from "../components/HeaderButtons";
import { useAppTheme } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";

type Row = {
  rank: number;
  player_id: number;
  player_name: string;
  championship_id?: number;
  team_short_name?: string | null;
  total_canes?: number;
  total_matacanes?: number;
  total_air_catches?: number;
};

function medalForRank(rank: number) {
  if (rank === 1) return { label: "🥇", bg: "#FDE68A", fg: "#92400E" };
  if (rank === 2) return { label: "🥈", bg: "#E5E7EB", fg: "#374151" };
  if (rank === 3) return { label: "🥉", bg: "#FBCFE8", fg: "#9D174D" };
  return null;
}

function Block({
  title,
  loading,
  rows,
  valueLabel,
  getValue,
  accent,
  emptyText,
  onPressRow,
}: {
  title: string;
  loading: boolean;
  rows: Row[];
  valueLabel: string;
  getValue: (r: Row) => number;
  accent: string;
  emptyText: string;
  onPressRow?: (r: Row) => void;
}) {
  const { colors } = useAppTheme();

  const playerLabel = (row: Row) => {
    const short = (row.team_short_name ?? "").trim();
    return short ? `${row.player_name} - ${short}` : row.player_name;
  };

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 6,
        borderLeftColor: accent,
        ...(Platform.select({
          ios: {
            shadowColor: "#000",
            shadowOpacity: 0.06,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 6 },
          },
          android: { elevation: 2 },
          default: {},
        }) as any),
      }}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <Text style={{ fontSize: 18, fontWeight: "900", color: colors.text }}>
          {title}
        </Text>
      </View>

      {loading ? (
        <View style={{ paddingVertical: 14 }}>
          <ActivityIndicator />
        </View>
      ) : rows.length === 0 ? (
        <Text style={{ color: colors.muted, marginTop: 10 }}>{emptyText}</Text>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(item) => `${item.player_id}-${item.rank}`}
          scrollEnabled={false}
          renderItem={({ item }) => {
            const medal = medalForRank(item.rank);

            return (
              <Pressable
                onPress={() => onPressRow?.(item)}
                style={({ pressed }) => ({
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  paddingVertical: 10,
                  borderTopWidth: item.rank === rows[0]?.rank ? 0 : 1,
                  borderTopColor: colors.border,
                  opacity: pressed ? 0.85 : 1,
                })}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    flex: 1,
                    paddingRight: 10,
                  }}
                >
                  <View
                    style={{
                      minWidth: 28,
                      height: 28,
                      paddingHorizontal: 8,
                      borderRadius: 999,
                      backgroundColor: medal ? medal.bg : colors.ranking,
                      alignItems: "center",
                      justifyContent: "center",
                      marginRight: 10,
                      borderWidth: medal ? 0 : 1,
                      borderColor: "#E5E7EB",
                    }}
                  >
                    <Text
                      style={{
                        color: medal ? medal.fg : colors.text,
                        fontWeight: "900",
                      }}
                    >
                      {medal ? medal.label : item.rank}
                    </Text>
                  </View>

                  <Text
                    numberOfLines={1}
                    style={{ fontWeight: "800", flex: 1, color: colors.text }}
                  >
                    {playerLabel(item)}
                  </Text>
                </View>

                <View
                  style={{
                    paddingVertical: 6,
                    paddingHorizontal: 10,
                    borderRadius: 999,
                    backgroundColor: accent,
                  }}
                >
                  <Text style={{ color: "white", fontWeight: "900" }}>
                    {getValue(item)}
                    {valueLabel ? ` ${valueLabel}` : ""}
                  </Text>
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </View>
  );
}

export default function RankingsScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [championship, setChampionship] = useState<{ id: number; name: string } | null>(null);

  const [canadors, setCanadors] = useState<Row[]>([]);
  const [matacanes, setMatacanes] = useState<Row[]>([]);
  const [recollidors, setRecollidors] = useState<Row[]>([]);

  const [query, setQuery] = useState("");

  const norm = (s: string) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

  const hasQuery = norm(query).length > 0;

  useEffect(() => {
    loadRankings("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadRankings(query);
    }, 250);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function loadRankings(qRaw: string) {
    const q = norm(qRaw);
    setLoading(true);

    const { data: ch, error: chErr } = await supabase
      .from("championship")
      .select("id, name, year")
      .eq("is_active", true)
      .maybeSingle();

    if (chErr || !ch) {
      setChampionship(null);
      setCanadors([]);
      setMatacanes([]);
      setRecollidors([]);
      setLoading(false);
      return;
    }

    setChampionship({ id: ch.id, name: ch.name });

    const like = `%${q}%`;
    const baseOr = q ? `player_name.ilike.${like},team_short_name.ilike.${like}` : null;

    const [a, b, c] = await Promise.all([
      q
        ? supabase
            .from("v_canadors_active")
            .select("rank, player_id, player_name, total_canes, team_short_name")
            .or(baseOr!)
            .order("rank", { ascending: true })
        : supabase
            .from("v_canadors_active")
            .select("rank, player_id, player_name, total_canes, team_short_name")
            .lte("rank", 10)
            .order("rank", { ascending: true }),

      q
        ? supabase
            .from("v_matacanes_active")
            .select("rank, player_id, player_name, total_matacanes, team_short_name")
            .or(baseOr!)
            .order("rank", { ascending: true })
        : supabase
            .from("v_matacanes_active")
            .select("rank, player_id, player_name, total_matacanes, team_short_name")
            .lte("rank", 10)
            .order("rank", { ascending: true }),

      q
        ? supabase
            .from("v_recollidors_active")
            .select("rank, player_id, player_name, total_air_catches, team_short_name")
            .or(baseOr!)
            .order("rank", { ascending: true })
        : supabase
            .from("v_recollidors_active")
            .select("rank, player_id, player_name, total_air_catches, team_short_name")
            .lte("rank", 10)
            .order("rank", { ascending: true }),
    ]);

    setCanadors(((a as any).data as Row[]) ?? []);
    setMatacanes(((b as any).data as Row[]) ?? []);
    setRecollidors(((c as any).data as Row[]) ?? []);

    setLoading(false);
  }

  const summary = useMemo(() => {
    const topC = canadors?.[0]?.total_canes ?? 0;
    const topM = matacanes?.[0]?.total_matacanes ?? 0;
    const topR = recollidors?.[0]?.total_air_catches ?? 0;

    return { topC, topM, topR };
  }, [canadors, matacanes, recollidors]);

  function openPlayerDetail(row: Row) {
    router.push({
      pathname: "/player-detail",
      params: { playerId: String(row.player_id) },
    });
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginTop: 5,
        }}
      >
        <BackButton onPress={() => router.replace("/public-menu")} />

        <Pressable
          onPress={() => router.push("/player-search")}
          style={{
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ fontWeight: "900", color: colors.text }}>
            {t("rankings.searchPlayer")}
          </Text>
        </Pressable>
      </View>

      <Text
        style={{
          fontSize: 20,
          fontWeight: "900",
          marginTop: 14,
          textAlign: "center",
          color: colors.text,
        }}
      >
        {t("rankings.title")}
      </Text>

      <View
        style={{
          marginTop: 12,
          backgroundColor: colors.card,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
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
        <Text style={{ fontSize: 13, fontWeight: "800", color: colors.text }}>
          {t("rankings.searchTitle")}
        </Text>

        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t("rankings.searchPlaceholder")}
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          style={{
            marginTop: 8,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.cardAlt,
            fontSize: 15,
            fontWeight: "600",
            color: colors.text,
          }}
        />

        {hasQuery && (
          <Pressable
            onPress={() => setQuery("")}
            style={({ pressed }) => [
              {
                alignSelf: "flex-end",
                marginTop: 8,
                paddingVertical: 6,
                paddingHorizontal: 10,
                borderRadius: 10,
                backgroundColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
          >
            <Text style={{ color: colors.primaryText, fontWeight: "800" }}>
              {t("rankings.clear")}
            </Text>
          </Pressable>
        )}
      </View>

      <View
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          flexDirection: "row",
          justifyContent: "space-between",
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
        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={{ color: "#16a34a", fontWeight: "600" }}>
            {t("rankings.topCanes")}
          </Text>
          <Text style={{ fontSize: 18, fontWeight: "900", marginTop: 2, color: colors.text }}>
            {summary.topC}
          </Text>
        </View>

        <View style={{ width: 1, backgroundColor: colors.border }} />

        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={{ color: "#ef4444", fontWeight: "600" }}>
            {t("rankings.topMatacanes")}
          </Text>
          <Text style={{ fontSize: 18, fontWeight: "900", marginTop: 2, color: colors.text }}>
            {summary.topM}
          </Text>
        </View>

        <View style={{ width: 1, backgroundColor: colors.border }} />

        <View style={{ alignItems: "center", flex: 1 }}>
          <Text style={{ color: "#3b82f6", fontWeight: "600" }}>
            {t("rankings.topRecollides")}
          </Text>
          <Text style={{ fontSize: 18, fontWeight: "900", marginTop: 2, color: colors.text }}>
            {summary.topR}
          </Text>
        </View>
      </View>

      {hasQuery && (
        <View style={{ marginTop: 12, marginBottom: 2 }}>
          <Text style={{ color: colors.muted, fontWeight: "700" }}>
            {t("rankings.resultsFor")}{" "}
            <Text style={{ color: colors.text, fontWeight: "900" }}>{query.trim()}</Text>
          </Text>

          <Text style={{ color: colors.muted, marginTop: 2 }}>
            {t("rankings.searchHelp")}
          </Text>
        </View>
      )}

      <View style={{ marginTop: 12, marginBottom: 2 }} />

      <Block
        title={hasQuery ? t("rankings.canadorsResult") : t("rankings.canadorsTop10")}
        loading={loading}
        rows={canadors}
        valueLabel=""
        getValue={(r) => r.total_canes ?? 0}
        accent="#16a34a"
        emptyText={hasQuery ? t("rankings.noCanadorsMatches") : t("rankings.noDataYet")}
        onPressRow={openPlayerDetail}
      />

      <Block
        title={hasQuery ? t("rankings.matacanesResult") : t("rankings.matacanesTop10")}
        loading={loading}
        rows={matacanes}
        valueLabel=""
        getValue={(r) => r.total_matacanes ?? 0}
        accent="#ef4444"
        emptyText={hasQuery ? t("rankings.noMatacanesMatches") : t("rankings.noDataYet")}
        onPressRow={openPlayerDetail}
      />

      <Block
        title={hasQuery ? t("rankings.recollidorsResult") : t("rankings.recollidorsTop10")}
        loading={loading}
        rows={recollidors}
        valueLabel=""
        getValue={(r) => r.total_air_catches ?? 0}
        accent="#3b82f6"
        emptyText={hasQuery ? t("rankings.noRecollidorsMatches") : t("rankings.noDataYet")}
        onPressRow={openPlayerDetail}
      />
    </ScrollView>
  );
}