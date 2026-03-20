import React, { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { BackButton, RefreshButton } from "../components/HeaderButtons";
// ✅ Ajusta aquest import si al teu projecte el client està a una altra ruta
import { supabase } from "../src/supabase";

type Championship = {
  id: number;
  name: string;
  year: number;
  is_active: boolean;
};

type TeamRow = {
  id: number;
  name: string;
};

type MatchRow = {
  id: number;
  championship_id: number | null;
  phase_id: number;
  is_finished: boolean;
  team_a_id: number | null;
  team_b_id: number | null;
  score_team_a: number;
  score_team_b: number;
  draw_run_id: number | null;
};

type DrawRunRow = {
  id: number;
  kind: string;
  params: any;
};

type Scoring = { victoria: number; empat: number; derrota: number };

type StandingRow = {
  teamId: number;
  teamName: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  diff: number;
};

type TeamSanctionRow = {
  championship_team_id: number;
  points_value: number;
  canes_value: number;
  championship_team?: {
    team_id: number;
  } | null;
};

type SanctionTotalsByTeam = Record<
  number,
  {
    points: number;
    canes: number;
  }
>;

function safeNum(v: any, fallback = 0) {
  const n = typeof v === "string" ? parseInt(v, 10) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

function parseJsonMaybe(value: any) {
  try {
    if (value == null) return null;
    if (typeof value === "string") return JSON.parse(value);
    return value;
  } catch {
    return null;
  }
}

function parseGroupsFromDrawRunParams(params: any): Record<string, number[]> | null {
  // Expected:
  // params = { format:"groups2", groups:[{code:"A", team_ids:[...]}, {code:"B", team_ids:[...]}], ... }
  const p = parseJsonMaybe(params);
  if (!p) return null;

  const groups = p.groups ?? p.grouped_teams ?? p.groupedTeams ?? null;

  // Array of objects: [{code, team_ids}]
  if (Array.isArray(groups) && groups.length && typeof groups[0] === "object" && !Array.isArray(groups[0])) {
    const out: Record<string, number[]> = {};
    for (const g of groups) {
      const code = String((g as any).code ?? "").trim();
      const ids = (g as any).team_ids ?? (g as any).teamIds ?? [];
      if (!code || !Array.isArray(ids)) continue;
      out[code] = ids.map((x: any) => safeNum(x, NaN)).filter((n: number) => Number.isFinite(n)) as number[];
    }
    return Object.keys(out).length ? out : null;
  }

  // Object map: {A:[...],B:[...]}
  if (groups && typeof groups === "object" && !Array.isArray(groups)) {
    const out: Record<string, number[]> = {};
    for (const [k, v] of Object.entries(groups)) {
      if (!Array.isArray(v)) continue;
      out[String(k)] = (v as any[]).map((x) => safeNum(x, NaN)).filter((n) => Number.isFinite(n)) as number[];
    }
    return Object.keys(out).length ? out : null;
  }

  // Array of arrays -> A,B,C...
  if (Array.isArray(groups) && groups.length && Array.isArray(groups[0])) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const out: Record<string, number[]> = {};
    groups.forEach((arr: any, idx: number) => {
      if (!Array.isArray(arr)) return;
      const key = letters[idx] ?? `G${idx + 1}`;
      out[key] = arr.map((x: any) => safeNum(x, NaN)).filter((n: number) => Number.isFinite(n)) as number[];
    });
    return Object.keys(out).length ? out : null;
  }

  return null;
}

function buildStandings(
  teams: TeamRow[],
  matches: MatchRow[],
  scoring: Scoring,
  sanctionsByTeam: SanctionTotalsByTeam = {}
): StandingRow[] {
  const byId = new Map<number, StandingRow>();

  for (const t of teams) {
    byId.set(t.id, {
      teamId: t.id,
      teamName: t.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      diff: 0,
    });
  }

  for (const m of matches) {
    if (!m.is_finished) continue;
    const a = m.team_a_id;
    const b = m.team_b_id;
    if (!a || !b) continue;
    if (!byId.has(a) || !byId.has(b)) continue;

    const sa = safeNum(m.score_team_a, 0);
    const sb = safeNum(m.score_team_b, 0);

    const A = byId.get(a)!;
    const B = byId.get(b)!;

    A.played += 1;
    B.played += 1;

    if (sa > sb) {
      A.wins += 1;
      B.losses += 1;
      A.points += scoring.victoria;
      B.points += scoring.derrota;
      A.diff += sa - sb;
      B.diff += sb - sa;
    } else if (sb > sa) {
      B.wins += 1;
      A.losses += 1;
      B.points += scoring.victoria;
      A.points += scoring.derrota;
      B.diff += sb - sa;
      A.diff += sa - sb;
    } else {
      A.draws += 1;
      B.draws += 1;
      A.points += scoring.empat;
      B.points += scoring.empat;
    }
  }

  // aplicar sancions després de calcular la classificació esportiva
  for (const row of byId.values()) {
    const sanction = sanctionsByTeam[row.teamId];
    if (!sanction) continue;

    row.points -= safeNum(sanction.points, 0);
    row.diff -= safeNum(sanction.canes, 0);
  }

  const rows = Array.from(byId.values());

  rows.sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.diff !== x.diff) return y.diff - x.diff;
    return x.teamName.localeCompare(y.teamName);
  });

  return rows;
}

export default function TeamRankingsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [activeChamp, setActiveChamp] = useState<Championship | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [scoring, setScoring] = useState<Scoring>({ victoria: 3, empat: 1, derrota: 0 });
  const [sanctionsByTeam, setSanctionsByTeam] = useState<SanctionTotalsByTeam>({});

  const [drawFormat, setDrawFormat] = useState<string | null>(null);
  const [groupsMap, setGroupsMap] = useState<Record<string, number[]> | null>(null);

  const champLabel = useMemo(() => {
    if (!activeChamp) return "Campionat actiu";
    return `${activeChamp.name} ${activeChamp.year}`;
  }, [activeChamp]);

  const mode: "groups" | "league" = useMemo(() => {
    if (groupsMap) return "groups";
    if (drawFormat && drawFormat.startsWith("groups")) return "groups";
    return "league";
  }, [groupsMap, drawFormat]);

  const leagueMatches = useMemo(() => matches.filter((m) => m.phase_id === 8), [matches]);
  const groupMatches = useMemo(() => matches.filter((m) => m.phase_id === 1), [matches]);

  const leagueStandings = useMemo(
  () => buildStandings(teams, leagueMatches, scoring, sanctionsByTeam),
  [teams, leagueMatches, scoring, sanctionsByTeam]
);

  const groupStandings = useMemo(() => {
    if (!groupsMap) return null;

    const byTeamId = new Map<number, TeamRow>();
    teams.forEach((t) => byTeamId.set(t.id, t));

    const out: Record<string, StandingRow[]> = {};
    for (const [groupKey, ids] of Object.entries(groupsMap)) {
      const groupTeams = ids.map((id) => byTeamId.get(id)).filter(Boolean) as TeamRow[];
      const idSet = new Set(ids);
      const gMatches = groupMatches.filter((m) => idSet.has(m.team_a_id ?? -1) && idSet.has(m.team_b_id ?? -1));
      out[groupKey] = buildStandings(groupTeams, gMatches, scoring, sanctionsByTeam);
    }
    return out;
  }, [groupsMap, groupMatches, teams, scoring, sanctionsByTeam]);

  const groupsCount = useMemo(() => {
    return groupStandings ? Object.keys(groupStandings).length : 0;
  }, [groupStandings]);

  // Special rule for 3 groups: top 5 per group + best 6th overall (to make 16 teams)
  const bestSixthTeamId = useMemo(() => {
    if (!groupStandings) return null;
    const keys = Object.keys(groupStandings);
    if (keys.length !== 3) return null;

    const sixthRows = keys
      .map((k) => groupStandings[k]?.[5])
      .filter(Boolean) as StandingRow[];

    if (sixthRows.length === 0) return null;

    sixthRows.sort((a, b) => {
      if (b.points !== a.points) return b.points - a.points;
      if (b.diff !== a.diff) return b.diff - a.diff;
      return (a.teamName ?? "").localeCompare(b.teamName ?? "");
    });

    return sixthRows[0]?.teamId ?? null;
  }, [groupStandings]);

  async function loadAll() {
    // 1) Active championship
    const { data: cData, error: cErr } = await supabase
      .from("championship")
      .select("id,name,year,is_active")
      .eq("is_active", true)
      .order("year", { ascending: false })
      .limit(1);

    if (cErr) throw new Error(cErr.message);
    const champ = (cData?.[0] ?? null) as Championship | null;
    if (!champ) throw new Error("No hi ha cap campionat actiu.");
    setActiveChamp(champ);

    // 2) scoring config (key="punts", phase_id null)
    try {
      const { data: pData, error: pErr } = await supabase
        .from("championship_config")
        .select("value")
        .eq("championship_id", champ.id)
        .eq("key", "punts")
        .is("phase_id", null)
        .limit(1);

      if (!pErr) {
        const obj = parseJsonMaybe(pData?.[0]?.value);
        setScoring({
          victoria: safeNum(obj?.victoria, 3),
          empat: safeNum(obj?.empat, 1),
          derrota: safeNum(obj?.derrota, 0),
        });
      }
    } catch {
      // keep defaults
    }

    // 3) teams in championship (always show even if no matches)
    const { data: ctData, error: ctErr } = await supabase
      .from("championship_team")
      .select("team_id")
      .eq("championship_id", champ.id);

    if (ctErr) throw new Error(ctErr.message);

    const teamIds = (ctData ?? [])
      .map((r: any) => safeNum(r.team_id, NaN))
      .filter((n) => Number.isFinite(n)) as number[];

    if (teamIds.length === 0) {
      setTeams([]);
    } else {
      const { data: tData, error: tErr } = await supabase.from("team").select("id,name").in("id", teamIds);
      if (tErr) throw new Error(tErr.message);
      setTeams((tData ?? []) as TeamRow[]);
    }
// 4) team sanctions
    const { data: sData, error: sErr } = await supabase
      .from("team_sanction")
      .select(`
        championship_team_id,
        points_value,
        canes_value,
        championship_team:championship_team_id(
          team_id
        )
      `)
      .eq("championship_id", champ.id);

    if (sErr) throw new Error(sErr.message);

    const sanctionTotals: SanctionTotalsByTeam = {};

    for (const row of (sData ?? []) as TeamSanctionRow[]) {
      const teamId = safeNum(row.championship_team?.team_id, NaN);
      if (!Number.isFinite(teamId)) continue;

      if (!sanctionTotals[teamId]) {
        sanctionTotals[teamId] = { points: 0, canes: 0 };
      }

      sanctionTotals[teamId].points += safeNum(row.points_value, 0);
      sanctionTotals[teamId].canes += safeNum(row.canes_value, 0);
    }

    setSanctionsByTeam(sanctionTotals);

    // 5) matches for league/groups
    const { data: mData, error: mErr } = await supabase
      .from("match")
      .select("id,championship_id,phase_id,is_finished,team_a_id,team_b_id,score_team_a,score_team_b,draw_run_id")
      .eq("championship_id", champ.id)
      .in("phase_id", [1, 8]);

    if (mErr) throw new Error(mErr.message);
    setMatches((mData ?? []) as MatchRow[]);

    // 6) latest draw_run tells us the format (groups2/groups3/league) and group membership
    const { data: drData, error: drErr } = await supabase
  .from("draw_run")
  .select("id,kind,params,created_at")
  .eq("championship_id", champ.id)
  .in("kind", ["groups2", "groups3"])
  .order("created_at", { ascending: false })
  .limit(1);

    if (drErr) throw new Error(drErr.message);

    const dr = (drData?.[0] ?? null) as DrawRunRow | null;
    const params = parseJsonMaybe(dr?.params);
    const format = String(params?.format ?? dr?.kind ?? "").trim() || null;
    setDrawFormat(format);

    // only set groupsMap when format is groups*
    if (format && format.startsWith("groups")) {
      setGroupsMap(parseGroupsFromDrawRunParams(params));
    } else {
      setGroupsMap(null);
    }
  }

  async function reload() {
    setRefreshing(true);
    try {
      await loadAll();
    } catch (e: any) {
      // eslint-disable-next-line no-alert
      alert(e?.message ?? "Error");
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        await loadAll();
      } catch (e: any) {
        if (!cancelled) {
          // eslint-disable-next-line no-alert
          alert(e?.message ?? "Error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const TableHeader = (
    <View
      style={{
        flexDirection: "row",
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: "#e5e7eb",
      }}
    >
      <Text style={{ width: 26, color: "#6b7280", fontWeight: "800" }}>#</Text>
      <Text style={{ minWidth: 220, flexShrink: 0, color: "#6b7280", fontWeight: "800" }}>Equip</Text>
      <Text style={{ width: 40, textAlign: "right", color: "#6b7280", fontWeight: "800" }}>Pts</Text>
      <Text style={{ width: 34, textAlign: "right", color: "#6b7280", fontWeight: "800" }}>PJ</Text>
      <Text style={{ width: 34, textAlign: "right", color: "#6b7280", fontWeight: "800" }}>G</Text>
      <Text style={{ width: 34, textAlign: "right", color: "#6b7280", fontWeight: "800" }}>E</Text>
      <Text style={{ width: 34, textAlign: "right", color: "#6b7280", fontWeight: "800" }}>P</Text>
      <Text style={{ width: 44, textAlign: "right", color: "#6b7280", fontWeight: "800" }}>DC</Text>
    </View>
  );

  function renderStandingCard(title: string, rows: StandingRow[]) {
    return (
      <View
        style={{
          backgroundColor: "white",
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "#e5e7eb",
          marginHorizontal: 16,
          marginBottom: 14,
          overflow: "hidden",
        }}
      >
        <View style={{ padding: 14, paddingBottom: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: "900", color: "#111827" }}>{title}</Text>
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {TableHeader}

            {rows.map((r, idx) => {
              const rank = idx + 1;
              const isGroup = /^Grup\s/i.test(title);
              const isLeague = !isGroup;

              let cutoff = isLeague ? 16 : 8;

              // 3 groups: top 5 + best 6th overall
              if (isGroup && groupsCount === 3) {
                cutoff = 5;
                if (bestSixthTeamId && rows[5]?.teamId === bestSixthTeamId) cutoff = 6;
              }

              const showSeparator = rank === cutoff + 1;
              const isEliminated = rank > cutoff;

              return (
                <React.Fragment key={r.teamId}>
                  {showSeparator ? (
                    <View
                      style={{
                        height: 5,
                        backgroundColor: "#FECACA",
                        marginHorizontal: 0,
                        marginVertical: 6,
                        borderRadius: 8,
                      }}
                    />
                  ) : null}

                  <View
                key={r.teamId}
                style={{
                  flexDirection: "row",
                  paddingHorizontal: 12,
                  paddingVertical: 11,
                  borderTopWidth: idx === 0 ? 0 : 1,
                  borderColor: isEliminated ? "#FCA5A5" : "#f3f4f6",
                  backgroundColor: isEliminated ? "#FEF2F2" : (idx % 2 === 0 ? "white" : "#fafafa"),
                }}
              >
                <Text style={{ width: 26, fontWeight: "900", color: isEliminated ? "#991B1B" : "#111827" }}>
                  {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : rank}
                </Text>

                <Text
                  style={{
                    minWidth: 220,
                    flexShrink: 0,
                    fontWeight: "800",
                    color: isEliminated ? "#7F1D1D" : "#111827",
                    paddingRight: 10,
                  }}
                >
                  {r.teamName}
                </Text>
                <Text style={{ width: 40, textAlign: "right", fontWeight: "900", color: "#111827" }}>
                  {r.points}
                </Text>
                <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: "#111827" }}>
                  {r.played}
                </Text>
                <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: "#111827" }}>
                  {r.wins}
                </Text>
                <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: "#111827" }}>
                  {r.draws}
                </Text>
                <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: "#111827" }}>
                  {r.losses}
                </Text>
                <Text
                  style={{
                    width: 44,
                    textAlign: "right",
                    fontWeight: "900",
                    color: r.diff >= 0 ? "#16a34a" : "#dc2626",
                  }}
                >
                  {r.diff}
                </Text>
              </View>
                </React.Fragment>
              );
            })}
          </View>
        </ScrollView>
      </View>
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#f3f4f6" }}>
        <View style={{ padding: 16 }}>
          <ActivityIndicator />
          <Text style={{ marginTop: 10, color: "#6b7280" }}>Carregant classificació...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left","right","bottom"]} style={{ flex: 1, backgroundColor: "#f3f4f6" }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        {/* Header */}
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <BackButton
          onPress={() => router.replace("/public-menu")}
          style={{ marginTop:5 }}
        />

            <View style={{ flex: 1 }} />
          </View>
<Text style={{ fontSize: 20, fontWeight: "900", color: "#111827",textAlign: "center",paddingTop:10 }}>Classificació equips</Text>
<View style={{ alignItems: "center",paddingTop:10 }}>
            <Pressable
              onPress={() => router.push("public-bracket")}
              style={({ pressed }) => [
	            {
	              alignSelf: "center",
	              flexDirection: "row",
	              alignItems: "center",
	              gap: 8,
	              paddingVertical: 8,
	              paddingHorizontal: 10,
	              borderRadius: 12,
	              backgroundColor: "white",
	              opacity: pressed ? 0.85 : 1,
	            },
	            (Platform.select({
	              ios: {
	                shadowColor: "#000",
	                shadowOpacity: 0.06,
	                shadowRadius: 10,
	                shadowOffset: { width: 0, height: 6 },
	              },
	              android: { elevation: 2 },
	            }) as any),
	          ]}
            >
              <Text style={{ fontSize: 16, fontWeight: "700" }}>Veure eliminatòries</Text>
            </Pressable>

            <View style={{ flex: 1 }} />
          </View>
          <View style={{ marginTop: 12 }}>
            <View
              style={{
                backgroundColor: "white",
                borderRadius: 16,
                padding: 14,
                borderWidth: 1,
                borderColor: "#e5e7eb",
              }}
            >
              <Text style={{ color: "#6b7280", fontSize: 12, fontWeight: "700" }}>Format</Text>
              <Text style={{ marginTop: 4, fontSize: 16, fontWeight: "900", color: "#111827" }}>
                {mode === "groups" ? "Fase de grups" : "Lliga"}
              </Text>
              <Text style={{ marginTop: 6, color: "#6b7280" }}>
                Es mostren tots els equips encara que no s’hagin jugat partits. Els punts es calculen amb la configuració
                del campionat.
              </Text>
            </View>
          </View>
        </View>

        {mode === "groups" && groupsMap && groupStandings ? (
  Object.entries(groupStandings)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([g, rows]) => (
      <View key={`group-${g}`}>
        {renderStandingCard(`Grup ${g}`, rows)}
      </View>
    ))
) : (
  renderStandingCard("Classificació", leagueStandings)
)}
      </ScrollView>
    </SafeAreaView>
  );
}
