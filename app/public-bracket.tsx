// public-bracket.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../src/supabase";
import { BackButton } from "../components/HeaderButtons";
import { useAppTheme, AppColors } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";

type TeamRef = { id: number; name?: string | null };

type MatchRow = {
  id: number;
  phase_id: number;
  team_a_id: number | null;
  team_b_id: number | null;
  score_team_a: number;
  score_team_b: number;
  is_finished: boolean;
  team_a?: TeamRef | null;
  team_b?: TeamRef | null;
};

const PHASE_LABEL_KEY: Record<number, string> = {
  2: "bracket.phase2",
  3: "bracket.phase3",
  4: "bracket.phase4",
  5: "bracket.phase5",
};

const PHASES_ORDER = [2, 3, 4, 5] as const;

const CARD_H = 108;
const GAP = 20;
const COL_W = 300;

function getWinnerSide(m: MatchRow): "A" | "B" | null {
  if (!m?.is_finished) return null;

  const a = Number(m.score_team_a ?? 0);
  const b = Number(m.score_team_b ?? 0);

  if (a === b) return null;

  return a > b ? "A" : "B";
}

function winnerTeam(m?: MatchRow | null): TeamRef | null {
  if (!m) return null;

  const w = getWinnerSide(m);

  if (w === "A") return (m.team_a ?? null) as any;
  if (w === "B") return (m.team_b ?? null) as any;

  return null;
}

function buildTeamToMatchMap(matches: MatchRow[]) {
  const map = new Map<number, MatchRow>();

  for (const match of matches) {
    if (match.team_a_id != null) map.set(match.team_a_id, match);
    if (match.team_b_id != null) map.set(match.team_b_id, match);
  }

  return map;
}

type Slot = {
  index: number;
  top: number;
  match: MatchRow | null;
  derivedA?: string;
  derivedB?: string;
};

type RoundCol = {
  phaseId: number;
  titleKey: string;
  slots: Slot[];
};

function buildBracket(matchesByPhase: Record<number, MatchRow[]>): RoundCol[] {
  const basePhase = PHASES_ORDER.find((p) => (matchesByPhase[p]?.length ?? 0) > 0);
  if (!basePhase) return [];

  const phaseStartIndex = PHASES_ORDER.indexOf(basePhase);
  const phases = PHASES_ORDER.slice(phaseStartIndex);

  const deepestPhase =
    [...phases].reverse().find((p) => (matchesByPhase[p]?.length ?? 0) > 0) ?? basePhase;

  const desiredOrder: Record<number, MatchRow[]> = {};

  desiredOrder[deepestPhase] = [...(matchesByPhase[deepestPhase] ?? [])].sort(
    (a, b) => a.id - b.id
  );

  for (let idx = phases.indexOf(deepestPhase) - 1; idx >= 0; idx--) {
    const prevPhase = phases[idx];
    const curPhase = phases[idx + 1];

    const prevMatches = [...(matchesByPhase[prevPhase] ?? [])].sort((a, b) => a.id - b.id);
    const curOrdered = desiredOrder[curPhase] ?? [];

    const teamToPrev = buildTeamToMatchMap(prevMatches);

    const picked: MatchRow[] = [];
    const used = new Set<number>();

    for (const parent of curOrdered) {
      const ta = parent.team_a_id ?? null;
      const tb = parent.team_b_id ?? null;

      const mA = ta != null ? teamToPrev.get(ta) ?? null : null;
      const mB = tb != null ? teamToPrev.get(tb) ?? null : null;

      if (mA && !used.has(mA.id)) {
        picked.push(mA);
        used.add(mA.id);
      }

      if (mB && !used.has(mB.id)) {
        picked.push(mB);
        used.add(mB.id);
      }
    }

    for (const match of prevMatches) {
      if (!used.has(match.id)) picked.push(match);
    }

    desiredOrder[prevPhase] = picked;
  }

  const baseMatches =
    desiredOrder[basePhase] ??
    [...(matchesByPhase[basePhase] ?? [])].sort((a, b) => a.id - b.id);

  const baseCount = baseMatches.length;

  const topsByRound: number[][] = [];
  topsByRound[0] = Array.from({ length: baseCount }, (_, i) => i * (CARD_H + GAP));

  const roundCounts = phases.map((_, idx) =>
    Math.max(1, Math.ceil(baseCount / Math.pow(2, idx)))
  );

  for (let round = 1; round < roundCounts.length; round++) {
    const count = roundCounts[round];
    const prev = topsByRound[round - 1];
    const next: number[] = [];

    for (let i = 0; i < count; i++) {
      const c1 = prev[Math.min(prev.length - 1, 2 * i)];
      const c2 = prev[Math.min(prev.length - 1, 2 * i + 1)];
      next.push((c1 + c2) / 2);
    }

    topsByRound[round] = next;
  }

  const assigned: RoundCol[] = [];

  assigned.push({
    phaseId: basePhase,
    titleKey: PHASE_LABEL_KEY[basePhase] ?? "bracket.phaseFallback",
    slots: baseMatches.map((match, i) => ({
      index: i,
      top: topsByRound[0][i],
      match,
    })),
  });

  for (let round = 1; round < phases.length; round++) {
    const phaseId = phases[round];
    const expectedCount = roundCounts[round];

    const prevSlots = assigned[round - 1].slots;

    const candidates =
      desiredOrder[phaseId] ??
      [...(matchesByPhase[phaseId] ?? [])].sort((a, b) => a.id - b.id);

    const slots: Slot[] = [];

    for (let i = 0; i < expectedCount; i++) {
      const best = candidates[i] ?? null;

      const child1 = prevSlots[Math.min(prevSlots.length - 1, 2 * i)]?.match;
      const child2 = prevSlots[Math.min(prevSlots.length - 1, 2 * i + 1)]?.match;

      const w1 = winnerTeam(child1);
      const w2 = winnerTeam(child2);

      const derivedA = w1?.name ? w1.name : child1 ? "PENDING_TRANSLATION" : "PENDING_TRANSLATION";
      const derivedB = w2?.name ? w2.name : child2 ? "PENDING_TRANSLATION" : "PENDING_TRANSLATION";

      slots.push({
        index: i,
        top: topsByRound[round][i] ?? i * (CARD_H + GAP),
        match: best,
        derivedA,
        derivedB,
      });
    }

    assigned.push({
      phaseId,
      titleKey: PHASE_LABEL_KEY[phaseId] ?? "bracket.phaseFallback",
      slots,
    });
  }

  return assigned;
}

export default function PublicBracket() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<MatchRow[]>([]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function load() {
    setLoading(true);

    const { data: championship, error: champErr } = await supabase
      .from("championship")
      .select("id")
      .eq("is_active", true)
      .single();

    if (champErr || !championship) {
      setMatches([]);
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("match")
      .select(
        `
        id,
        phase_id,
        team_a_id,
        team_b_id,
        score_team_a,
        score_team_b,
        is_finished,
        team_a:team_a_id(id,name),
        team_b:team_b_id(id,name)
      `
      )
      .eq("championship_id", championship.id)
      .in("phase_id", PHASES_ORDER as unknown as number[])
      .order("phase_id", { ascending: true })
      .order("id", { ascending: true });

    if (error) {
      setMatches([]);
      setLoading(false);
      return;
    }

    setMatches(((data ?? []) as unknown) as MatchRow[]);
    setLoading(false);
  }

  const matchesByPhase = useMemo(() => {
    const map: Record<number, MatchRow[]> = {};

    for (const phase of PHASES_ORDER) {
      map[phase] = [];
    }

    for (const match of matches) {
      const phaseId = Number(match.phase_id);
      if (!map[phaseId]) map[phaseId] = [];
      map[phaseId].push(match);
    }

    for (const phaseId of Object.keys(map)) {
      map[Number(phaseId)] = map[Number(phaseId)].sort((a, b) => a.id - b.id);
    }

    return map;
  }, [matches]);

  const bracket = useMemo(() => buildBracket(matchesByPhase), [matchesByPhase]);

  const contentHeight = useMemo(() => {
    const basePhase = bracket[0]?.phaseId;
    const baseCount = basePhase ? matchesByPhase[basePhase]?.length ?? 0 : 0;
    const height = baseCount <= 0 ? 240 : baseCount * CARD_H + (baseCount - 1) * GAP + 20;

    return Math.max(240, height);
  }, [bracket, matchesByPhase]);

  const hasAny = useMemo(
    () => bracket.length > 0 && bracket.some((col) => col.slots.some((slot) => slot.match != null)),
    [bracket]
  );

  const styles = useMemo(() => getStyles(colors), [colors]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.container}>
      <BackButton
        onPress={() => router.replace("/team-rankings")}
        style={{ marginTop: 5 }}
      />

      <Text style={styles.title}>{t("bracket.title")}</Text>

      {loading ? (
        <Text style={styles.loading}>{t("bracket.loading")}</Text>
      ) : !hasAny ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>{t("bracket.emptyTitle")}</Text>
          <Text style={styles.emptyText}>{t("bracket.emptyText")}</Text>
        </View>
      ) : (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingTop: 14, paddingBottom: 20 }}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingTop: 10, paddingBottom: 40 }}
          >
            {bracket.map((col, colIdx) => (
              <View
                key={String(col.phaseId)}
                style={[styles.column, { height: contentHeight, width: COL_W }]}
              >
                <View style={styles.phasePill}>
                  <Text style={styles.phaseTitle}>
                    {col.titleKey === "bracket.phaseFallback"
                      ? t("bracket.phaseFallback", { phase: col.phaseId })
                      : t(col.titleKey)}
                  </Text>
                </View>

                <View style={{ flex: 1, position: "relative" }}>
                  {col.slots.map((slot) => (
                    <BracketMatchCard
                      key={`${col.phaseId}-${slot.index}`}
                      top={slot.top}
                      match={slot.match}
                      derivedA={
                        slot.derivedA === "PENDING_TRANSLATION"
                          ? t("bracket.pending")
                          : slot.derivedA
                      }
                      derivedB={
                        slot.derivedB === "PENDING_TRANSLATION"
                          ? t("bracket.pending")
                          : slot.derivedB
                      }
                      onOpen={(id) =>
                        router.push({
                          pathname: "/match-summary",
                          params: { id: String(id) },
                        })
                      }
                      isLastCol={colIdx === bracket.length - 1}
                      styles={styles}
                    />
                  ))}
                </View>
              </View>
            ))}
          </ScrollView>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function BracketMatchCard({
  top,
  match,
  derivedA,
  derivedB,
  onOpen,
  isLastCol,
  styles,
}: {
  top: number;
  match: MatchRow | null;
  derivedA?: string;
  derivedB?: string;
  onOpen: (id: number) => void;
  isLastCol: boolean;
  styles: ReturnType<typeof getStyles>;
}) {
  const { t } = useLanguage();

  const winnerSide = match ? getWinnerSide(match) : null;
  const aWin = winnerSide === "A";
  const bWin = winnerSide === "B";

  const aName = match?.team_a?.name ?? derivedA ?? t("bracket.tbd");
  const bName = match?.team_b?.name ?? derivedB ?? t("bracket.tbd");

  return (
    <View style={[styles.card, { position: "absolute", top }]}>
      <View style={[styles.teamRow, aWin ? styles.winRow : null]}>
        <Text numberOfLines={1} style={[styles.team, aWin ? styles.winText : null]}>
          {aName}
        </Text>
        <Text style={[styles.score, aWin ? styles.winText : null]}>
          {match ? match.score_team_a : "-"}
        </Text>
      </View>

      <View style={[styles.teamRow, bWin ? styles.winRow : null]}>
        <Text numberOfLines={1} style={[styles.team, bWin ? styles.winText : null]}>
          {bName}
        </Text>
        <Text style={[styles.score, bWin ? styles.winText : null]}>
          {match ? match.score_team_b : "-"}
        </Text>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.status}>
          {!match
            ? t("bracket.notPlayed")
            : match.is_finished
            ? winnerSide
              ? t("bracket.finished")
              : t("bracket.draw")
            : t("bracket.notPlayed")}
        </Text>

        {match ? (
          <Pressable onPress={() => onOpen(match.id)} style={styles.openBtn}>
            <Text style={styles.openBtnText}>{t("bracket.viewMatch")}</Text>
          </Pressable>
        ) : (
          <View style={[styles.openBtn, styles.openBtnDisabled]}>
            <Text style={styles.openBtnTextDisabled}>
              {isLastCol ? t("bracket.waiting") : t("bracket.waiting")}
            </Text>
          </View>
        )}
      </View>
    </View>
  );
}

function getStyles(colors: AppColors) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      padding: 16,
    },
    backBtn: {
      alignSelf: "flex-start",
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      marginBottom: 12,
    },
    backText: {
      fontWeight: "900",
      color: colors.text,
    },
    title: {
      fontSize: 20,
      textAlign: "center",
      fontWeight: "900",
      color: colors.text,
    },
    loading: {
      textAlign: "center",
      marginTop: 28,
      fontSize: 16,
      color: colors.muted,
      fontWeight: "700",
    },
    emptyWrap: {
      marginTop: 24,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.border,
    },
    emptyTitle: {
      fontWeight: "900",
      fontSize: 16,
      color: colors.text,
    },
    emptyText: {
      marginTop: 6,
      color: colors.muted,
      fontWeight: "700",
      lineHeight: 18,
    },
    column: {
      marginRight: 14,
    },
    phasePill: {
      alignSelf: "flex-start",
      backgroundColor: colors.primary,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      marginBottom: 10,
    },
    phaseTitle: {
      color: colors.primaryText,
      fontWeight: "900",
    },
    card: {
      width: COL_W - 8,
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: "#000",
      shadowOpacity: 0.07,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 7 },
      elevation: 3,
    },
    teamRow: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingVertical: 2,
      borderRadius: 10,
      paddingHorizontal: 8,
    },
    team: {
      flex: 1,
      marginRight: 10,
      fontWeight: "900",
      color: colors.text,
    },
    score: {
      width: 100,
      textAlign: "right",
      fontWeight: "900",
      color: colors.text,
    },
    winRow: {
      backgroundColor: "rgba(34,197,94,0.12)",
    },
    winText: {
      color: "#166534",
    },
    cardFooter: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    status: {
      fontWeight: "800",
      color: colors.muted,
    },
    openBtn: {
      backgroundColor: colors.primary,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
    },
    openBtnText: {
      color: colors.primaryText,
      fontWeight: "900",
    },
    openBtnDisabled: {
      backgroundColor: "rgba(17,24,39,0.12)",
    },
    openBtnTextDisabled: {
      color: "rgba(17,24,39,0.55)",
      fontWeight: "900",
    },
  });
}