// public-bracket.tsx
import React, { useEffect, useMemo, useState } from "react";
import { View, Text, ScrollView, StyleSheet, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../src/supabase";
import { BackButton, RefreshButton } from "../components/HeaderButtons";

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

const PHASE_LABEL: Record<number, string> = {
  2: "Vuitens",
  3: "Quarts",
  4: "Semis",
  5: "Final",
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

function matchKeyTeams(m?: MatchRow | null): number[] {
  if (!m) return [];
  const ids: number[] = [];
  if (m.team_a_id != null) ids.push(m.team_a_id);
  if (m.team_b_id != null) ids.push(m.team_b_id);
  return ids;
}



function buildTeamToMatchMap(matches: MatchRow[]) {
  const map = new Map<number, MatchRow>();
  for (const m of matches) {
    if (m.team_a_id != null) map.set(m.team_a_id, m);
    if (m.team_b_id != null) map.set(m.team_b_id, m);
  }
  return map;
}


type Slot = {
  index: number;
  top: number;
  match: MatchRow | null;
  // Derived display names when match teams aren't set yet
  derivedA?: string;
  derivedB?: string;
};

type RoundCol = {
  phaseId: number;
  title: string;
  slots: Slot[];
};

function buildBracket(matchesByPhase: Record<number, MatchRow[]>): RoundCol[] {
  const basePhase = PHASES_ORDER.find((p) => (matchesByPhase[p]?.length ?? 0) > 0);
  if (!basePhase) return [];

  // Phases present from basePhase upwards
  const phaseStartIndex = PHASES_ORDER.indexOf(basePhase);
  const phases = PHASES_ORDER.slice(phaseStartIndex);

  // Choose the highest (deepest) phase that already exists (most recently created round),
  // so when later rounds change rivals, earlier rounds can be reordered to stay consistent.
  const deepestPhase =
    [...phases].reverse().find((p) => (matchesByPhase[p]?.length ?? 0) > 0) ?? basePhase;

  const desiredOrder: Record<number, MatchRow[]> = {};

  // Top round: stable order by id
  desiredOrder[deepestPhase] = [...(matchesByPhase[deepestPhase] ?? [])].sort((a, b) => a.id - b.id);

  // Propagate backwards (deepest -> base): reorder previous round so the two matches that contain the
  // parent rivals appear together under that parent match.
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

    // Append any remaining matches (by id) to keep things stable even with null/byes
    for (const m of prevMatches) {
      if (!used.has(m.id)) picked.push(m);
    }

    desiredOrder[prevPhase] = picked;
  }

  const baseMatches =
    desiredOrder[basePhase] ?? [...(matchesByPhase[basePhase] ?? [])].sort((a, b) => a.id - b.id);

  const baseCount = baseMatches.length;

  // Helper to compute slot top positions
  const topsByRound: number[][] = [];
  topsByRound[0] = Array.from({ length: baseCount }, (_, i) => i * (CARD_H + GAP));

  // Build expected slot counts per phase starting at basePhase
  const roundCounts = phases.map((_, idx) => Math.max(1, Math.ceil(baseCount / Math.pow(2, idx))));

  // For each next round, compute positions centered between children
  for (let r = 1; r < roundCounts.length; r++) {
    const count = roundCounts[r];
    const prev = topsByRound[r - 1];
    const next: number[] = [];
    for (let i = 0; i < count; i++) {
      const c1 = prev[Math.min(prev.length - 1, 2 * i)];
      const c2 = prev[Math.min(prev.length - 1, 2 * i + 1)];
      next.push((c1 + c2) / 2);
    }
    topsByRound[r] = next;
  }

  const assigned: RoundCol[] = [];

  // Round 0 slots
  assigned.push({
    phaseId: basePhase,
    title: PHASE_LABEL[basePhase] ?? `Fase ${basePhase}`,
    slots: baseMatches.map((m, i) => ({ index: i, top: topsByRound[0][i], match: m })),
  });

  // Build later rounds
  for (let r = 1; r < phases.length; r++) {
    const phaseId = phases[r];
    const title = PHASE_LABEL[phaseId] ?? `Fase ${phaseId}`;
    const expectedCount = roundCounts[r];

    const prevSlots = assigned[r - 1].slots;

    // Use the computed order if available; otherwise stable by id
    const candidates = desiredOrder[phaseId] ?? [...(matchesByPhase[phaseId] ?? [])].sort((a, b) => a.id - b.id);

    const slots: Slot[] = [];

    for (let i = 0; i < expectedCount; i++) {
      const best = candidates[i] ?? null;

      // Derived labels for placeholders: winners from child matches
      const child1 = prevSlots[Math.min(prevSlots.length - 1, 2 * i)]?.match;
      const child2 = prevSlots[Math.min(prevSlots.length - 1, 2 * i + 1)]?.match;

      const w1 = winnerTeam(child1);
      const w2 = winnerTeam(child2);

      const derivedA = w1?.name ? w1.name : child1 ? `Pendent` : "Pendent";
      const derivedB = w2?.name ? w2.name : child2 ? `Pendent` : "Pendent";

      slots.push({
        index: i,
        top: topsByRound[r][i] ?? i * (CARD_H + GAP),
        match: best,
        derivedA,
        derivedB,
      });
    }

    assigned.push({ phaseId, title, slots });
  }

  return assigned;
}



export default function PublicBracket() {
  const router = useRouter();
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

    setMatches((data ?? []) as MatchRow[]);
    setLoading(false);
  }

  const matchesByPhase = useMemo(() => {
    const map: Record<number, MatchRow[]> = {};
    for (const p of PHASES_ORDER) map[p] = [];
    for (const m of matches) {
      const pid = Number(m.phase_id);
      if (!map[pid]) map[pid] = [];
      map[pid].push(m);
    }
    // ensure stable ordering
    for (const pid of Object.keys(map)) {
      map[Number(pid)] = map[Number(pid)].sort((a, b) => a.id - b.id);
    }
    return map;
  }, [matches]);

  const bracket = useMemo(() => buildBracket(matchesByPhase), [matchesByPhase]);

  const contentHeight = useMemo(() => {
    const basePhase = bracket[0]?.phaseId;
    const baseCount = basePhase ? (matchesByPhase[basePhase]?.length ?? 0) : 0;
    // Ensure cards never overlap and leave a clean 20px margin between matches
    // and an extra 20px at the bottom so the last "Veure partit" button is always visible.
    const h = baseCount <= 0 ? 240 : baseCount * CARD_H + (baseCount - 1) * GAP + 20;
    return Math.max(240, h);
  }, [bracket, matchesByPhase]);

  const hasAny = useMemo(() => bracket.length > 0 && bracket.some((c) => c.slots.some((s) => s.match != null)), [bracket]);

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.container}>
<BackButton
          onPress={() => router.replace("/team-rankings")}
          style={{ marginTop:5 }}
        />

      <Text style={styles.title}>Eliminatòries</Text>

      {loading ? (
        <Text style={styles.loading}>Carregant eliminatòries...</Text>
      ) : !hasAny ? (
        <View style={styles.emptyWrap}>
          <Text style={styles.emptyTitle}>Encara no s&apos;han creat eliminatòries</Text>
          <Text style={styles.emptyText}>
            Quan l&apos;admin generi vuitens/quarts/semis/final, aquí es veuran els encreuaments i resultats.
          </Text>
        </View>
      ) : (
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingTop: 14, paddingBottom: 20 }}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingTop: 10, paddingBottom: 40 }}>
            {bracket.map((col, colIdx) => (
              <View key={String(col.phaseId)} style={[styles.column, { height: contentHeight, width: COL_W }]}>
                <View style={styles.phasePill}>
                  <Text style={styles.phaseTitle}>{col.title}</Text>
                </View>

                <View style={{ flex: 1, position: "relative" }}>
                  {col.slots.map((slot) => (
                    <BracketMatchCard
                      key={`${col.phaseId}-${slot.index}`}
                      top={slot.top}
                      match={slot.match}
                      derivedA={slot.derivedA}
                      derivedB={slot.derivedB}
                      onOpen={(id) => router.push({ pathname: "/match-summary", params: { id: String(id) } })}
                      isLastCol={colIdx === bracket.length - 1}
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
}: {
  top: number;
  match: MatchRow | null;
  derivedA?: string;
  derivedB?: string;
  onOpen: (id: number) => void;
  isLastCol: boolean;
}) {
  const w = match ? getWinnerSide(match) : null;
  const aWin = w === "A";
  const bWin = w === "B";

  const aName = match?.team_a?.name ?? derivedA ?? "TBD";
  const bName = match?.team_b?.name ?? derivedB ?? "TBD";

  return (
    <View style={[styles.card, { position: "absolute", top }]}>
      <View style={[styles.teamRow, aWin ? styles.winRow : null]}>
        <Text numberOfLines={1} style={[styles.team, aWin ? styles.winText : null]}>
          {aName}
        </Text>
        <Text style={[styles.score, aWin ? styles.winText : null]}>{match ? match.score_team_a : "-"}</Text>
      </View>

      <View style={[styles.teamRow, bWin ? styles.winRow : null]}>
        <Text numberOfLines={1} style={[styles.team, bWin ? styles.winText : null]}>
          {bName}
        </Text>
        <Text style={[styles.score, bWin ? styles.winText : null]}>{match ? match.score_team_b : "-"}</Text>
      </View>

      <View style={styles.cardFooter}>
        <Text style={styles.status}>
          {!match ? "No jugat" : match.is_finished ? (w ? "Finalitzat" : "Empat") : "No jugat"}
        </Text>

        {match ? (
          <Pressable onPress={() => onOpen(match.id)} style={styles.openBtn}>
            <Text style={styles.openBtnText}>Veure partit</Text>
          </Pressable>
        ) : (
          <View style={[styles.openBtn, styles.openBtnDisabled]}>
            <Text style={styles.openBtnTextDisabled}>{isLastCol ? "Esperant" : "Esperant"}</Text>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f6f7fb",
    padding: 16,
  },
  backBtn: {
    alignSelf: "flex-start",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#e5e7eb",
    backgroundColor: "#fff",
    marginBottom: 12,
  },
  backText: {
    fontWeight: "900",
    color: "#111827",
  },
  title: {
    fontSize: 20,
    textAlign: "center",
    fontWeight: "900",
    color: "#111827",
  },
  loading: {
    textAlign: "center",
    marginTop: 28,
    fontSize: 16,
    color: "#6b7280",
    fontWeight: "700",
  },
  emptyWrap: {
    marginTop: 24,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: "#e5e7eb",
  },
  emptyTitle: {
    fontWeight: "900",
    fontSize: 16,
    color: "#111827",
  },
  emptyText: {
    marginTop: 6,
    color: "#6b7280",
    fontWeight: "700",
    lineHeight: 18,
  },
  column: {
    marginRight: 14,
  },
  phasePill: {
    alignSelf: "flex-start",
    backgroundColor: "#111827",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginBottom: 10,
  },
  phaseTitle: {
    color: "#fff",
    fontWeight: "900",
  },
  card: {
    width: COL_W - 8,
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "rgba(16, 24, 40, 0.08)",
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
    color: "#111827",
  },
  score: {
    width: 100,
    textAlign: "right",
    fontWeight: "900",
    color: "#111827",
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
    color: "#6b7280",
  },
  openBtn: {
    backgroundColor: "#111827",
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  openBtnText: {
    color: "#fff",
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
