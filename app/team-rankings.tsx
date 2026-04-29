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
import { BackButton } from "../components/HeaderButtons";
import { useAppTheme } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";
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

type Scoring = {
  victoria: number;
  empat: number;
  derrota: number;
};

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
  const p = parseJsonMaybe(params);
  if (!p) return null;

  const groups = p.groups ?? p.grouped_teams ?? p.groupedTeams ?? null;

  if (Array.isArray(groups) && groups.length && typeof groups[0] === "object" && !Array.isArray(groups[0])) {
    const out: Record<string, number[]> = {};

    for (const group of groups) {
      const code = String((group as any).code ?? "").trim();
      const ids = (group as any).team_ids ?? (group as any).teamIds ?? [];

      if (!code || !Array.isArray(ids)) continue;

      out[code] = ids
        .map((x: any) => safeNum(x, NaN))
        .filter((n: number) => Number.isFinite(n)) as number[];
    }

    return Object.keys(out).length ? out : null;
  }

  if (groups && typeof groups === "object" && !Array.isArray(groups)) {
    const out: Record<string, number[]> = {};

    for (const [key, value] of Object.entries(groups)) {
      if (!Array.isArray(value)) continue;

      out[String(key)] = (value as any[])
        .map((x) => safeNum(x, NaN))
        .filter((n) => Number.isFinite(n)) as number[];
    }

    return Object.keys(out).length ? out : null;
  }

  if (Array.isArray(groups) && groups.length && Array.isArray(groups[0])) {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const out: Record<string, number[]> = {};

    groups.forEach((arr: any, idx: number) => {
      if (!Array.isArray(arr)) return;

      const key = letters[idx] ?? `G${idx + 1}`;

      out[key] = arr
        .map((x: any) => safeNum(x, NaN))
        .filter((n: number) => Number.isFinite(n)) as number[];
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

  for (const team of teams) {
    byId.set(team.id, {
      teamId: team.id,
      teamName: team.name,
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      diff: 0,
    });
  }

  for (const match of matches) {
    if (!match.is_finished) continue;

    const teamAId = match.team_a_id;
    const teamBId = match.team_b_id;

    if (!teamAId || !teamBId) continue;
    if (!byId.has(teamAId) || !byId.has(teamBId)) continue;

    const scoreA = safeNum(match.score_team_a, 0);
    const scoreB = safeNum(match.score_team_b, 0);

    const teamA = byId.get(teamAId)!;
    const teamB = byId.get(teamBId)!;

    teamA.played += 1;
    teamB.played += 1;

    if (scoreA > scoreB) {
      teamA.wins += 1;
      teamB.losses += 1;
      teamA.points += scoring.victoria;
      teamB.points += scoring.derrota;
      teamA.diff += scoreA - scoreB;
      teamB.diff += scoreB - scoreA;
    } else if (scoreB > scoreA) {
      teamB.wins += 1;
      teamA.losses += 1;
      teamB.points += scoring.victoria;
      teamA.points += scoring.derrota;
      teamB.diff += scoreB - scoreA;
      teamA.diff += scoreA - scoreB;
    } else {
      teamA.draws += 1;
      teamB.draws += 1;
      teamA.points += scoring.empat;
      teamB.points += scoring.empat;
    }
  }

  for (const row of byId.values()) {
    const sanction = sanctionsByTeam[row.teamId];
    if (!sanction) continue;

    row.points -= safeNum(sanction.points, 0);
    row.diff -= safeNum(sanction.canes, 0);
  }

  return Array.from(byId.values()).sort((x, y) => {
    if (y.points !== x.points) return y.points - x.points;
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.diff !== x.diff) return y.diff - x.diff;
    return x.teamName.localeCompare(y.teamName);
  });
}

export default function TeamRankingsScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [activeChamp, setActiveChamp] = useState<Championship | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [scoring, setScoring] = useState<Scoring>({ victoria: 3, empat: 1, derrota: 0 });
  const [sanctionsByTeam, setSanctionsByTeam] = useState<SanctionTotalsByTeam>({});

  const [drawFormat, setDrawFormat] = useState<string | null>(null);
  const [groupsMap, setGroupsMap] = useState<Record<string, number[]> | null>(null);

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
    teams.forEach((team) => byTeamId.set(team.id, team));

    const out: Record<string, StandingRow[]> = {};

    for (const [groupKey, ids] of Object.entries(groupsMap)) {
      const groupTeams = ids
        .map((id) => byTeamId.get(id))
        .filter(Boolean) as TeamRow[];

      const idSet = new Set(ids);

      const gMatches = groupMatches.filter(
        (match) => idSet.has(match.team_a_id ?? -1) && idSet.has(match.team_b_id ?? -1)
      );

      out[groupKey] = buildStandings(groupTeams, gMatches, scoring, sanctionsByTeam);
    }

    return out;
  }, [groupsMap, groupMatches, teams, scoring, sanctionsByTeam]);

  const groupsCount = useMemo(() => {
    return groupStandings ? Object.keys(groupStandings).length : 0;
  }, [groupStandings]);

  const bestSixthTeamId = useMemo(() => {
    if (!groupStandings) return null;

    const keys = Object.keys(groupStandings);
    if (keys.length !== 3) return null;

    const sixthRows = keys
      .map((key) => groupStandings[key]?.[5])
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
    const { data: cData, error: cErr } = await supabase
      .from("championship")
      .select("id,name,year,is_active")
      .eq("is_active", true)
      .order("year", { ascending: false })
      .limit(1);

    if (cErr) throw new Error(cErr.message);

    const champ = (cData?.[0] ?? null) as Championship | null;
    if (!champ) throw new Error(t("teamRankings.noActiveChampionship"));

    setActiveChamp(champ);

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
      // Keep default scoring.
    }

    const { data: ctData, error: ctErr } = await supabase
      .from("championship_team")
      .select("team_id")
      .eq("championship_id", champ.id);

    if (ctErr) throw new Error(ctErr.message);

    const teamIds = (ctData ?? [])
      .map((row: any) => safeNum(row.team_id, NaN))
      .filter((n) => Number.isFinite(n)) as number[];

    if (teamIds.length === 0) {
      setTeams([]);
    } else {
      const { data: tData, error: tErr } = await supabase
        .from("team")
        .select("id,name")
        .in("id", teamIds);

      if (tErr) throw new Error(tErr.message);

      setTeams((tData ?? []) as TeamRow[]);
    }

    const { data: sData, error: sErr } = await supabase
      .from("team_sanction")
      .select(
        `
        championship_team_id,
        points_value,
        canes_value,
        championship_team:championship_team_id(
          team_id
        )
      `
      )
      .eq("championship_id", champ.id);

    if (sErr) throw new Error(sErr.message);

    const sanctionTotals: SanctionTotalsByTeam = {};

    for (const row of (sData ?? []) as unknown as TeamSanctionRow[]) {
      const teamId = safeNum(row.championship_team?.team_id, NaN);

      if (!Number.isFinite(teamId)) continue;

      if (!sanctionTotals[teamId]) {
        sanctionTotals[teamId] = { points: 0, canes: 0 };
      }

      sanctionTotals[teamId].points += safeNum(row.points_value, 0);
      sanctionTotals[teamId].canes += safeNum(row.canes_value, 0);
    }

    setSanctionsByTeam(sanctionTotals);

    const { data: mData, error: mErr } = await supabase
      .from("match")
      .select(
        "id,championship_id,phase_id,is_finished,team_a_id,team_b_id,score_team_a,score_team_b,draw_run_id"
      )
      .eq("championship_id", champ.id)
      .in("phase_id", [1, 8]);

    if (mErr) throw new Error(mErr.message);

    setMatches((mData ?? []) as MatchRow[]);

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
      alert(e?.message ?? t("common.error"));
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
          alert(e?.message ?? t("common.error"));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const TableHeader = (
    <View
      style={{
        flexDirection: "row",
        paddingHorizontal: 12,
        paddingVertical: 10,
        borderBottomWidth: 1,
        borderColor: colors.border,
      }}
    >
      <Text style={{ width: 26, color: colors.muted, fontWeight: "800" }}>#</Text>

      <Text style={{ minWidth: 220, flexShrink: 0, color: colors.muted, fontWeight: "800" }}>
        {t("teamRankings.team")}
      </Text>

      <Text style={{ width: 40, textAlign: "right", color: colors.muted, fontWeight: "800" }}>
        Pts
      </Text>

      <Text style={{ width: 34, textAlign: "right", color: colors.muted, fontWeight: "800" }}>
        PJ
      </Text>

      <Text style={{ width: 34, textAlign: "right", color: colors.muted, fontWeight: "800" }}>
        G
      </Text>

      <Text style={{ width: 34, textAlign: "right", color: colors.muted, fontWeight: "800" }}>
        E
      </Text>

      <Text style={{ width: 34, textAlign: "right", color: colors.muted, fontWeight: "800" }}>
        P
      </Text>

      <Text style={{ width: 44, textAlign: "right", color: colors.muted, fontWeight: "800" }}>
        DC
      </Text>
    </View>
  );

  function renderStandingCard(title: string, rows: StandingRow[], isGroup: boolean) {
    return (
      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: colors.border,
          marginHorizontal: 16,
          marginBottom: 14,
          overflow: "hidden",
        }}
      >
        <View style={{ padding: 14, paddingBottom: 10 }}>
          <Text style={{ fontSize: 16, fontWeight: "900", color: colors.text }}>
            {title}
          </Text>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View>
            {TableHeader}

            {rows.map((row, idx) => {
              const rank = idx + 1;
              const isLeague = !isGroup;

              let cutoff = isLeague ? 16 : 8;

              if (isGroup && groupsCount === 3) {
                cutoff = 5;

                if (bestSixthTeamId && rows[5]?.teamId === bestSixthTeamId) {
                  cutoff = 6;
                }
              }

              const showSeparator = rank === cutoff + 1;
              const isEliminated = rank > cutoff;

              return (
                <React.Fragment key={row.teamId}>
                  {showSeparator ? (
                    <View
                      style={{
                        height: 5,
                        backgroundColor: isDark ? "rgba(239, 68, 68, 0.3)" : "#FECACA",
                        marginHorizontal: 0,
                        marginVertical: 6,
                        borderRadius: 8,
                      }}
                    />
                  ) : null}

                  <View
                    style={{
                      flexDirection: "row",
                      paddingHorizontal: 12,
                      paddingVertical: 11,
                      borderTopWidth: idx === 0 ? 0 : 1,
                      borderColor: isEliminated
                        ? isDark
                          ? "rgba(239, 68, 68, 0.3)"
                          : "#FCA5A5"
                        : colors.border,
                      backgroundColor: isEliminated
                        ? isDark
                          ? "rgba(239, 68, 68, 0.12)"
                          : "#FEF2F2"
                        : idx % 2 === 0
                        ? colors.card
                        : colors.cardAlt,
                    }}
                  >
                    <Text
                      style={{
                        width: 26,
                        fontWeight: "900",
                        color: isEliminated
                          ? isDark
                            ? "#f87171"
                            : "#991B1B"
                          : colors.text,
                      }}
                    >
                      {idx === 0 ? "🥇" : idx === 1 ? "🥈" : idx === 2 ? "🥉" : rank}
                    </Text>

                    <Text
                      style={{
                        minWidth: 220,
                        flexShrink: 0,
                        fontWeight: "800",
                        color: isEliminated
                          ? isDark
                            ? "#fca5a5"
                            : "#7F1D1D"
                          : colors.text,
                        paddingRight: 10,
                      }}
                    >
                      {row.teamName}
                    </Text>

                    <Text style={{ width: 40, textAlign: "right", fontWeight: "900", color: colors.text }}>
                      {row.points}
                    </Text>

                    <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: colors.text }}>
                      {row.played}
                    </Text>

                    <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: colors.text }}>
                      {row.wins}
                    </Text>

                    <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: colors.text }}>
                      {row.draws}
                    </Text>

                    <Text style={{ width: 34, textAlign: "right", fontWeight: "800", color: colors.text }}>
                      {row.losses}
                    </Text>

                    <Text
                      style={{
                        width: 70,
                        textAlign: "right",
                        fontWeight: "900",
                        color: row.diff >= 0 ? "#16a34a" : "#dc2626",
                      }}
                    >
                      {row.diff}
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
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
        <View style={{ padding: 16 }}>
          <ActivityIndicator color={colors.primary} />

          <Text style={{ marginTop: 10, color: colors.muted }}>
            {t("teamRankings.loading")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={reload} />}
        contentContainerStyle={{ paddingBottom: 24 }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <BackButton
              onPress={() => router.replace("/public-menu")}
              style={{ marginTop: 5 }}
            />

            <View style={{ flex: 1 }} />
          </View>

          <Text
            style={{
              fontSize: 20,
              fontWeight: "900",
              color: colors.text,
              textAlign: "center",
              paddingTop: 10,
            }}
          >
            {t("teamRankings.title")}
          </Text>

          <View style={{ alignItems: "center", paddingTop: 10 }}>
            <Pressable
              onPress={() => router.push("/public-bracket")}
              style={({ pressed }) => [
                {
                  alignSelf: "center",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderRadius: 12,
                  backgroundColor: colors.card,
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
              ]}
            >
              <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>
                {t("teamRankings.viewBracket")}
              </Text>
            </Pressable>

            <View style={{ flex: 1 }} />
          </View>

          <View style={{ marginTop: 12 }}>
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 16,
                padding: 14,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>
                {t("teamRankings.format")}
              </Text>

              <Text style={{ marginTop: 4, fontSize: 16, fontWeight: "900", color: colors.text }}>
                {mode === "groups" ? t("teamRankings.groupStage") : t("teamRankings.league")}
              </Text>

              <Text style={{ marginTop: 6, color: colors.muted }}>
                {t("teamRankings.formatHelp")}
              </Text>
            </View>
          </View>
        </View>

        {mode === "groups" && groupsMap && groupStandings
          ? Object.entries(groupStandings)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([group, rows]) => (
                <View key={`group-${group}`}>
                  {renderStandingCard(t("teamRankings.group", { group }), rows, true)}
                </View>
              ))
          : renderStandingCard(t("teamRankings.standings"), leagueStandings, false)}
      </ScrollView>
    </SafeAreaView>
  );
}