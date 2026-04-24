import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
  StyleSheet,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter, Stack } from "expo-router";
import { supabase } from "../src/supabase";
import { BackButton, RefreshButton } from "../components/HeaderButtons";
import { useAppTheme, AppColors } from "../src/theme";

type TeamMini = {
  id: number;
  name: string | null;
  short_name: string | null;
};

type MatchRow = {
  id: number;
  match_date: string | null;
  started_at: string | null;
  display_status:string | null;
  is_finished: boolean;
  score_team_a: number;
  score_team_b: number;
  team_a_id: number | null;
  team_b_id: number | null;
  team_a?: TeamMini | null;
  team_b?: TeamMini | null;
  slot?: { field_code: string | null } | null;
  phase?: { name: string | null } | null;
};

function trimCharField(s?: string | null) {
  return (s ?? "").trim();
}
function getFieldOrder(fieldCode?: string | null) {
  const code = (fieldCode ?? "").trim().toUpperCase();

  if (code === "A") return 0;
  if (code === "B") return 1;
  return 99;
}

function getMatchPriority(m: MatchRow) {
  const isAjornat = m.display_status === "AJORNAT";
  const isLive = !!m.started_at && !m.is_finished && !isAjornat;

  if (isLive) return 0;          // primero en juego
  if (!m.is_finished) return 1;  // luego pendientes y ajornats
  return 2;                      // al final finalizados
}

function compareMatches(a: MatchRow, b: MatchRow) {
  const priorityA = getMatchPriority(a);
  const priorityB = getMatchPriority(b);

  if (priorityA !== priorityB) {
    return priorityA - priorityB;
  }

  const timeA = a.match_date ? new Date(a.match_date).getTime() : Number.MAX_SAFE_INTEGER;
  const timeB = b.match_date ? new Date(b.match_date).getTime() : Number.MAX_SAFE_INTEGER;

  if (timeA !== timeB) {
    return timeA - timeB;
  }

  const fieldA = getFieldOrder(a.slot?.field_code);
  const fieldB = getFieldOrder(b.slot?.field_code);

  if (fieldA !== fieldB) {
    return fieldA - fieldB;
  }

  return a.id - b.id;
}
function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateDDMMYYYY_HHMM(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();
  const hour = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${day}/${month}/${year} · ${hour}:${min}`;
}

function startOfWeekMonday(d: Date) {
  const day = d.getDay(); // 0..6 (Sun..Sat)
  const diff = (day + 6) % 7; // days since Monday
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - diff, 0, 0, 0, 0);
}

function endOfWeekSunday(d: Date) {
  const s = startOfWeekMonday(d);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6, 23, 59, 59, 999);
}

function labelWeekRange(start: Date, end: Date) {
  return `${pad2(start.getDate())}/${pad2(start.getMonth() + 1)} – ${pad2(end.getDate())}/${pad2(end.getMonth() + 1)}`;
}

export default function PublicWeekMatches() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [matches, setMatches] = useState<MatchRow[]>([]);

  const weekStart = useMemo(() => startOfWeekMonday(new Date()), []);
  const weekEnd = useMemo(() => endOfWeekSunday(new Date()), []);

  const summary = useMemo(() => {
  const ajornats = matches.filter((m) => m.display_status === "AJORNAT").length;
  const finished = matches.filter((m) => m.is_finished).length;
  const live = matches.filter((m) => !!m.started_at && !m.is_finished && m.display_status !== "AJORNAT").length;
  const pending = matches.length - finished - live - ajornats;
  return { total: matches.length, finished, live, pending, ajornats };
}, [matches]);

  const load = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      else setLoading(true);

      // Active championship
      const { data: ch, error: chErr } = await supabase
        .from("championship")
        .select("id")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (chErr) {
        Alert.alert("Error", chErr.message);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      if (!ch?.id) {
        setMatches([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const startIso = weekStart.toISOString();
      const endIso = weekEnd.toISOString();

      const { data, error } = await supabase
        .from("match")
        .select(
          "id, match_date, started_at,display_status, is_finished, score_team_a, score_team_b, team_a_id, team_b_id, team_a:team_a_id(id,name,short_name), team_b:team_b_id(id,name,short_name), slot:slot_id(field_code), phase:phase_id(name)"
        )
        .eq("championship_id", ch.id)
        .gte("match_date", startIso)
        .lte("match_date", endIso)
        .order("match_date", { ascending: true });

      if (error) {
        Alert.alert("Error", error.message);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const sortedMatches = ((data ?? []) as unknown as MatchRow[]).slice().sort(compareMatches);
      setMatches(sortedMatches);
      setLoading(false);
      setRefreshing(false);
    },
    [weekStart, weekEnd]
  );

  useFocusEffect(
    useCallback(() => {
      load(false);
    }, [load])
  );

  if (loading) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 10, color: colors.muted, fontWeight: "700" }}>Carregant…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />

      {/* Top bar: same feel as match-summary */}
      <View style={styles.topBarRow}>
<BackButton
          onPress={() => router.back()}
          style={{ marginTop:5 }}
        />

<RefreshButton
          onPress={() => load(true)}
          style={{ alignSelf: "flex-end",marginTop:5 }}
        />
      </View>

      {/* Title under buttons */}
      <View style={styles.titleWrap}>
        <Text style={styles.title}>Partits d’aquesta setmana</Text>
        <Text style={styles.weekRange}>{labelWeekRange(weekStart, weekEnd)}</Text>
      </View>

      {/* Summary (same style as public-matches) */}
      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View style={[styles.summaryPill, styles.pillPending]}>
            <Text style={styles.pillValue}>{summary.pending}</Text>
            <Text style={styles.pillLabel}>Pendents</Text>
          </View>
<View style={[styles.summaryPill, styles.pillLive]}>
            <Text style={styles.pillValue}>{summary.live}</Text>
            <Text style={styles.pillLabel}>En joc</Text>
          </View>
          <View style={[styles.summaryPill, styles.pillFinished]}>
            <Text style={styles.pillValue}>{summary.finished}</Text>
            <Text style={styles.pillLabel}>Finalitzats</Text>
          </View>
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ paddingBottom: 18 }}
        data={matches}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyTitle}>Sense partits</Text>
            <Text style={styles.emptySub}>No hi ha partits aquesta setmana.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const aName = trimCharField(item.team_a?.name) || item.team_a?.short_name || "Equip A";
          const bName = trimCharField(item.team_b?.name) || item.team_b?.short_name || "Equip B";

          const isAjornat = item.display_status === "AJORNAT";
          const isLive = !!item.started_at && !item.is_finished && !isAjornat;
          const score = isLive || isAjornat ? "" : `${item.score_team_a ?? 0} - ${item.score_team_b ?? 0}`;
          const canOpenSummary = !isAjornat && (item.is_finished || !!item.started_at);

          return (
            <Pressable
              onPress={() => {
                if (!canOpenSummary) return;
                router.push({ pathname: "/match-summary", params: { id: item.id } });
              }}
              onLongPress={() => Alert.alert("ID del partit", String(item.id))}
              delayLongPress={350}
             style={({ pressed }) => [
              styles.matchCard,
              isAjornat
                ? styles.matchCardAjornat
                : isLive
                ? styles.matchCardLive
                : item.is_finished
                ? styles.matchCardFinished
                : styles.matchCardPending,
                pressed && canOpenSummary ? { transform: [{ scale: 0.99 }], opacity: 0.95 } : null,
              ]}
            >
              <View style={styles.matchTopRow}>
  <Text style={styles.matchTitle} numberOfLines={1}>
    {aName} <Text style={styles.vs}>vs</Text> {bName}
  </Text>
  

  <View style={styles.matchMetaRow}>
    <View style={styles.metaRow}>
      {item.match_date ? (
        <Text style={styles.metaText}>🗓️ {formatDateDDMMYYYY_HHMM(item.match_date)}</Text>
      ) : (
        <Text style={styles.metaMuted}>🗓️ Data pendent</Text>
      )}
      {item.slot?.field_code ? (
        <Text style={styles.metaText}> · 🏟️ {item.slot.field_code}</Text>
      ) : null}
    </View>

    <View
  style={[
    styles.badge,
    isAjornat
      ? styles.pillAjornat
      : isLive
      ? styles.pillLive
      : item.is_finished
      ? styles.pillFinished
      : styles.pillPending,
  ]}
>
  <Text
    style={[
      styles.badgeText,
      isAjornat ? styles.badgeTextAjornat : null,
      isLive ? styles.badgeTextLive : null,
    ]}
  >
    {isAjornat ? "AJORNAT" : item.is_finished ? "FINAL" : item.started_at ? "EN JOC" : "PENDENT"}
  </Text>
</View>
  </View>

  <View style={styles.matchBottomRow}>
    {!!item.phase?.name ? (
      <Text style={styles.phaseText} numberOfLines={1}>
        {item.phase.name}
      </Text>
    ) : (
      <View style={{ flex: 1 }} />
    )}

   <Text
  style={[
    styles.scoreText,
    isAjornat
      ? styles.scoreAjornat
      : isLive
      ? styles.scoreLive
      : item.is_finished
      ? styles.scoreFinished
      : styles.scorePending,
  ]}
>
  {score}
</Text>
  </View>
</View>

{(isAjornat || (!item.is_finished && !item.started_at)) && (
  <View style={styles.bottomRow}>
    <Text style={styles.pendingHint}>
      {isAjornat
        ? "Partit ajornat"
        : "Encara no hi ha resum (partit no iniciat)"}
    </Text>

    {/*<Text style={styles.matchIdBottom}>#{item.id}</Text>*/}
  </View>
)}

{!item.is_finished && !!item.started_at && (
  <Text style={styles.pendingHint}>Partit en joc: resum en directe (marcador provisional)</Text>
)}

              {item.is_finished && (
                <Text style={styles.openHint}>{Platform.OS === "ios" ? "Toca per veure el resum" : "Prem per veure el resum"}</Text>
              )}
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

function getStyles(colors: AppColors, isDark = false) {
  return StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  loadingWrap: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
matchCardAjornat: {
  borderLeftWidth: 6,
  borderLeftColor: "#DC2626",
  //backgroundColor: "#FEF2F2",
},
badgeAjornat: {
  backgroundColor: "#FEE2E2",
  borderColor: "#FCA5A5",
},
badgeTextAjornat: {
  color: "#B91C1C",
},
scoreAjornat: {
  color: "#B91C1C",
},
bottomRow: {
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  marginTop: 8,
},

matchIdBottom: {
  fontSize: 11,
  fontWeight: "700",
  color: colors.muted,
},
  // top header (match-summary-like buttons)
  topBarRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  navButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 2 },
    }),
  },
  navButtonText: {
    fontWeight: "900",
    fontSize: 16,
  },

  titleWrap: {
    alignItems: "center",
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "900",
    color: colors.text,
  },
  weekRange: {
    marginTop: 6,
    color: colors.muted,
    fontWeight: "700",
  },

  summaryCard: {
    backgroundColor: colors.card,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 2 },
    }),
  },
  summaryRow: {
    flexDirection: "row",
    gap: 10,
  },
  summaryPill: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 10,
    paddingHorizontal: 10,
    backgroundColor: colors.cardAlt,
  },
  pillFinished: {
    backgroundColor: isDark ? "#122A1C" : "#F2FFF7",
    borderColor: isDark ? "#22543D" : "#D7F5E3",
  },
  pillPending: {
    backgroundColor: isDark ? "#2C1E03" : "#FFF9F2",
    borderColor: isDark ? "#7B4F01" : "#F8E2C3",
  },
  pillLive: {
    backgroundColor: isDark ? "#071529" : "#EFF6FF",
    borderColor: isDark ? "#1E3A8A" : "#3B82F6",
  },
  pillAjornat: {
    backgroundColor: isDark ? "#2C1E1E" : "#FEF2F2",
    borderColor: isDark ? "#7B4F4F" : "#FCA5A5",
  },
  pillValue: {
    fontWeight: "900",
    fontSize: 18,
    color: colors.text,
  },
  pillLabel: {
    marginTop: 2,
    fontWeight: "800",
    color: isDark ? colors.text : colors.muted,
    fontSize: 12,
  },

  matchCard: {
    backgroundColor: colors.card,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 12,
    ...Platform.select({
      ios: {
        shadowColor: "#000",
        shadowOpacity: 0.06,
        shadowRadius: 10,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 2 },
    }),
  },
  matchCardFinished: {
    borderLeftWidth: 6,
    borderLeftColor: "#22C55E",
    backgroundColor: isDark ? "#0D2818" : "#F2FFF7",
  },
  matchCardPending: {
    borderLeftWidth: 6,
    borderLeftColor: "#F59E0B",
    backgroundColor: colors.card,
  },
  matchCardLive: {
    borderLeftWidth: 6,
    borderLeftColor: "#3B82F6",
    backgroundColor: isDark ? "#071529" : "#EFF6FF",
  },

  matchTopRow: {
  gap: 8,
},
matchTitle: {
  fontWeight: "900",
  fontSize: 14,
  color: colors.text,
},
matchMetaRow: {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
},
metaRow: {
  flexDirection: "row",
  flexWrap: "wrap",
  flex: 1,
  marginTop: 0,
},
matchBottomRow: {
  flexDirection: "row",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
},
phaseText: {
  flex: 1,
  color: colors.muted,
  fontWeight: "800",
  fontSize: 12,
},
scoreText: {
  fontWeight: "900",
  fontSize: 16,
  textAlign: "right",
},
  vs: {
    color: colors.muted,
    fontWeight: "900",
  },
  metaText: {
    color: colors.muted,
    fontWeight: "700",
    fontSize: 12,
  },
  metaMuted: {
    color: colors.muted,
    fontWeight: "700",
    fontSize: 12,
  },
  badge: {
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderWidth: 1,
    alignSelf: "flex-end",
  },
  badgeFinished: {
    backgroundColor: "#DCFCE7",
    borderColor: "#BBF7D0",
  },
  badgePending: {
    backgroundColor: "#FFFBEB",
    borderColor: "#FED7AA",
  },
  badgeLive: {
    backgroundColor: "#DBEAFE",
    borderColor: "#BFDBFE",
  },
  badgeText: {
    fontWeight: "900",
    fontSize: 12,
    color: colors.text,
  },
  badgeTextLive: {
    color: "#1D4ED8",
  },
  scoreFinished: {
    color: "#15803D",
  },
  scorePending: {
    color: "#F59E0B",
  },
  scoreLive: {
    color: "#1D4ED8",
  },

  pendingHint: {
    marginTop: 10,
    fontWeight: "700",
    color: colors.muted,
    fontSize: 12,
  },
  openHint: {
    marginTop: 10,
    fontWeight: "800",
    color: colors.text,
    fontSize: 12,
  },

  emptyWrap: {
    paddingVertical: 48,
    alignItems: "center",
  },
  emptyTitle: {
    fontWeight: "900",
    fontSize: 18,
    color: colors.text,
  },
  emptySub: {
    marginTop: 8,
    color: colors.muted,
    fontWeight: "700",
    textAlign: "center",
  },
  });
}
