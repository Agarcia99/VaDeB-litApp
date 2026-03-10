import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Modal,
  ActivityIndicator,
  Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";
import { supabase } from "../../src/supabase";

type Championship = {
  id: number;
  name: string;
};

type DrawRun = {
  id: number;
  championship_id: number;
  created_at: string;
  seed: number;
  kind: string;
  params: any;
};

type Team = {
  id: number;
  name: string;
  short_name?: string | null;
};

type MatchSlot = {
  id: number;
  championship_id: number;
  starts_at: string;
  field_code: string; // "A" | "B"
  game_slot_id: number;
};

type MatchRow = {
  id: number;
  championship_id: number;
  phase_id: number;
  draw_run_id: number | null;
  slot_id: number | null;
  team_a_id: number | null;
  team_b_id: number | null;
  is_finished: boolean;
  match_date: string | null;
  score_team_a: number;
  score_team_b: number;
};

type ConfigRow = {
  key: string;
  value: any;
};

type PreferenceRow = {
  team_id: number;
  game_slot_id: number;
};

type RankingRow = {
  team_id: number;
  team_name: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scored: number;
  conceded: number;
  dg: number;
};

type Pairing = {
  teamAId: number;
  teamBId: number;
  teamAName: string;
  teamBName: string;
};

type WeekendOpt = {
  key: string; // "YYYY-MM-DD_YYYY-MM-DD"
  label: string; // "dd-mm-yyyy - dd-mm-yyyy"
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}

function toLocalDateKey(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function saturdayOfWeekend(d: Date) {
  const day = d.getDay(); // 0=dg ... 6=ds
  const diffToSaturday = (day + 1) % 7;
  const sat = new Date(d);
  sat.setHours(12, 0, 0, 0);
  sat.setDate(sat.getDate() - diffToSaturday);
  sat.setHours(12, 0, 0, 0);
  return sat;
}
function parseMatchDateToLocal(dstr: string) {
  // Si és només YYYY-MM-DD, crea-la en "local" al migdia per evitar shift de timezone
  if (/^\d{4}-\d{2}-\d{2}$/.test(dstr)) {
    const [y, m, d] = dstr.split("-").map(Number);
    return new Date(y, m - 1, d, 12, 0, 0, 0);
  }
  return new Date(dstr);
}
function weekendKeyFromDate(d: Date) {
  const sat = saturdayOfWeekend(d);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return `${toLocalDateKey(sat)}_${toLocalDateKey(sun)}`;
}

function weekendLabelFromKey(key: string) {
  const [from, to] = key.split("_");
  const fmt = (k: string) => {
    const [y, m, d] = k.split("-").map(Number);
    return `${pad2(d)}-${pad2(m)}-${y}`;
  };
  return `${fmt(from)} - ${fmt(to)}`;
}

function formatHour(d: Date) {
  return d.toLocaleTimeString("ca-ES", { hour: "2-digit", minute: "2-digit" });
}

function formatDayBadge(d: Date) {
  const day = d.getDay(); // 0 dg, 6 ds
  const map: Record<number, string> = { 0: "Dg", 1: "Dl", 2: "Dt", 3: "Dc", 4: "Dj", 5: "Dv", 6: "Ds" };
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yy = d.getFullYear();
  return `${map[day] ?? ""} ${dd}/${mm}/${yy}`;
}

function shuffle<T>(arr: T[], seed: number) {
  const a = [...arr];
  let s = seed >>> 0;
  const rand = () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const ELIM_PHASES: { id: number; code: string; label: string; need: number }[] = [
  { id: 2, code: "vuitens", label: "Vuitens", need: 16 },
  { id: 3, code: "quarts", label: "Quarts", need: 8 },
  { id: 4, code: "semis", label: "Semis", need: 4 },
  { id: 5, code: "final", label: "Final", need: 2 },
];

export default function DrawElimination() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  const [championship, setChampionship] = useState<Championship | null>(null);

  const [lastDrawRun, setLastDrawRun] = useState<DrawRun | null>(null);
  const [prevPhaseId, setPrevPhaseId] = useState<number | null>(null);
  const [prevPhaseName, setPrevPhaseName] = useState<string>("");

  const [prevMatches, setPrevMatches] = useState<MatchRow[]>([]);
  const [prevIncompleteCount, setPrevIncompleteCount] = useState<number>(0);

  const [teamsById, setTeamsById] = useState<Map<number, Team>>(new Map());
  const [rankingByGroup, setRankingByGroup] = useState<
    { groupCode: string; rows: RankingRow[] }[]
  >([]);
  const [rankingLeague, setRankingLeague] = useState<RankingRow[]>([]);

  const [pointsConfig, setPointsConfig] = useState<{
    victoria: number;
    empat: number;
    derrota: number;
  }>({ victoria: 3, empat: 1, derrota: 0 });

  const [calendarConfig, setCalendarConfig] = useState<any>(null);
  const [preferences, setPreferences] = useState<PreferenceRow[]>([]);

  const [allSlots, setAllSlots] = useState<MatchSlot[]>([]);
  const [occupiedSlotIds, setOccupiedSlotIds] = useState<Set<number>>(new Set());

  const [selectedElimPhaseId, setSelectedElimPhaseId] = useState<number>(3);
  const [mode, setMode] = useState<"auto" | "manual" | "random">("auto");

  const [weekendModalOpen, setWeekendModalOpen] = useState(false);
  const [selectedWeekends, setSelectedWeekends] = useState<Set<string>>(new Set());

  const [manualPairings, setManualPairings] = useState<Pairing[]>([]);
  const [slotPickerOpen, setSlotPickerOpen] = useState(false);
  const [slotPickerPairIdx, setSlotPickerPairIdx] = useState<number | null>(null);
  const [manualSlotByPairIdx, setManualSlotByPairIdx] = useState<Record<number, number>>({});

  const [selectedTeamForManual, setSelectedTeamForManual] = useState<number | null>(null);

  // ✅ Admin decides slots: per pairing (index) we store chosen slot_id
  const [slotPickOpen, setSlotPickOpen] = useState(false);
  const [slotPickForIndex, setSlotPickForIndex] = useState<number | null>(null);
  const [slotAssignment, setSlotAssignment] = useState<Record<number, number>>({}); // index -> slot_id

  const [busyCreating, setBusyCreating] = useState(false);
  const [existingElimCount, setExistingElimCount] = useState<number>(0);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);

      const { data: champ, error: champErr } = await supabase
        .from("championship")
        .select("id,name")
        .eq("is_active", true)
        .single();

      if (!mounted) return;
      if (champErr || !champ) {
        console.warn("No active championship:", champErr?.message);
        setLoading(false);
        return;
      }
      setChampionship(champ);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      let admin = false;
      if (user?.id) {
        const { data: adminRow } = await supabase
          .from("championship_admin_user")
          .select("user_id")
          .eq("user_id", user.id)
          .limit(1);
        admin = !!(adminRow && adminRow.length > 0);
      }
      if (!mounted) return;
      setIsAdmin(admin);

      const { data: drRows } = await supabase
        .from("draw_run")
        .select("id,championship_id,created_at,seed,kind,params")
        .eq("championship_id", champ.id)
        .order("created_at", { ascending: false })
        .limit(1);

      const last = drRows && drRows[0] ? ((drRows[0] as any) as DrawRun) : null;
      setLastDrawRun(last);

      const { data: cfgRows } = await supabase
        .from("championship_config")
        .select("key,value")
        .eq("championship_id", champ.id);

      const cfg = ((cfgRows ?? []) as any) as ConfigRow[];
      const punts = cfg.find((c) => c.key === "punts")?.value;
      if (punts && typeof punts === "object") {
        setPointsConfig({
          victoria: Number(punts.victoria ?? 3),
          empat: Number(punts.empat ?? 1),
          derrota: Number(punts.derrota ?? 0),
        });
      }
      const cal = cfg.find((c) => c.key === "calendar")?.value;
      setCalendarConfig(cal ?? null);

      const { data: prefRows } = await supabase
        .from("championship_team_game_preference")
        .select("team_id,game_slot_id")
        .eq("championship_id", champ.id);
      setPreferences((prefRows as any) ?? []);

      const { data: slotRows } = await supabase
        .from("match_slot")
        .select("id,championship_id,starts_at,field_code,game_slot_id")
        .eq("championship_id", champ.id)
        .order("starts_at", { ascending: true });
      setAllSlots((slotRows as any) ?? []);

      const { data: anyMatches } = await supabase
        .from("match")
        .select(
          "id,slot_id,phase_id,is_finished,championship_id,draw_run_id,team_a_id,team_b_id,match_date,score_team_a,score_team_b"
        )
        .eq("championship_id", champ.id);

      const occ = new Set<number>();
      (anyMatches ?? []).forEach((m: any) => {
        if (m.slot_id != null) occ.add(m.slot_id);
      });
      setOccupiedSlotIds(occ);

      let prevPhase: number | null = null;
      let prevName = "";
      if (last?.kind === "league" || last?.kind === "lliga") prevPhase = 8;
      if (last?.kind === "groups2" || last?.kind === "groups3" || last?.kind === "grups") prevPhase = 1;
      if (last?.params?.phase_id) prevPhase = Number(last.params.phase_id);

      if (prevPhase) {
        const { data: ph } = await supabase.from("phase").select("id,name").eq("id", prevPhase).single();
        prevName = (ph as any)?.name ?? "";
      }

      setPrevPhaseId(prevPhase);
      setPrevPhaseName(prevName);

      let prevMs: MatchRow[] = [];
      if (prevPhase && last?.id) {
        const { data: pm } = await supabase
          .from("match")
          .select(
            "id,championship_id,phase_id,draw_run_id,slot_id,team_a_id,team_b_id,is_finished,match_date,score_team_a,score_team_b"
          )
          .eq("championship_id", champ.id)
          .eq("draw_run_id", last.id);

        prevMs = (((pm as any) ?? []) as MatchRow[]) ?? [];
      } else if (prevPhase) {
        const { data: pm } = await supabase
          .from("match")
          .select(
            "id,championship_id,phase_id,draw_run_id,slot_id,team_a_id,team_b_id,is_finished,match_date,score_team_a,score_team_b"
          )
          .eq("championship_id", champ.id)
          .eq("phase_id", prevPhase);

        prevMs = (((pm as any) ?? []) as MatchRow[]) ?? [];
      }

      setPrevMatches(prevMs);
      setPrevIncompleteCount(prevMs.filter((m) => !m.is_finished).length);

      const teamIds = new Set<number>();
      prevMs.forEach((m) => {
        if (m.team_a_id) teamIds.add(m.team_a_id);
        if (m.team_b_id) teamIds.add(m.team_b_id);
      });

      if (last?.params?.groups && Array.isArray(last.params.groups)) {
        for (const g of last.params.groups) {
          if (Array.isArray(g.team_ids)) {
            g.team_ids.forEach((id: number) => teamIds.add(Number(id)));
          }
        }
      }

      if (teamIds.size > 0) {
        const { data: teamRows } = await supabase
          .from("team")
          .select("id,name,short_name")
          .in("id", Array.from(teamIds));

        const map = new Map<number, Team>();
        (teamRows ?? []).forEach((t: any) => map.set(Number(t.id), t as Team));
        setTeamsById(map);
      } else {
        setTeamsById(new Map());
      }

      setLoading(false);
    }

    load();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!championship || !prevPhaseId) return;

    const stats = new Map<number, RankingRow>();
    const ensure = (teamId: number) => {
      if (!stats.has(teamId)) {
        const t = teamsById.get(teamId);
        stats.set(teamId, {
          team_id: teamId,
          team_name: t?.name ?? `Equip ${teamId}`,
          played: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          points: 0,
          scored: 0,
          conceded: 0,
          dg: 0,
        });
      }
      return stats.get(teamId)!;
    };

    if (lastDrawRun?.params?.groups && Array.isArray(lastDrawRun.params.groups)) {
      for (const g of lastDrawRun.params.groups) {
        if (Array.isArray(g.team_ids)) {
          g.team_ids.forEach((id: number) => ensure(Number(id)));
        }
      }
    }

    prevMatches.forEach((m) => {
      if (!m.team_a_id || !m.team_b_id) return;
      const a = ensure(m.team_a_id);
      const b = ensure(m.team_b_id);
      if (!m.is_finished) return;

      a.played += 1;
      b.played += 1;

      const sa = Number(m.score_team_a ?? 0);
      const sb = Number(m.score_team_b ?? 0);

      a.scored += sa;
      a.conceded += sb;
      b.scored += sb;
      b.conceded += sa;

      if (sa > sb) {
        a.wins += 1;
        b.losses += 1;
        a.points += pointsConfig.victoria;
        b.points += pointsConfig.derrota;
      } else if (sb > sa) {
        b.wins += 1;
        a.losses += 1;
        b.points += pointsConfig.victoria;
        a.points += pointsConfig.derrota;
      } else {
        a.draws += 1;
        b.draws += 1;
        a.points += pointsConfig.empat;
        b.points += pointsConfig.empat;
      }
    });

    stats.forEach((r) => {
      r.dg = r.scored - r.conceded;
    });

    const sortRanking = (rows: RankingRow[]) =>
      rows.sort((x, y) => {
        if (y.points !== x.points) return y.points - x.points;
        if (y.dg !== x.dg) return y.dg - x.dg;
        if (y.scored !== x.scored) return y.scored - x.scored;
        return x.team_name.localeCompare(y.team_name);
      });

    const leagueRows = sortRanking(Array.from(stats.values()));
    setRankingLeague(leagueRows);

    if (lastDrawRun?.params?.groups && Array.isArray(lastDrawRun.params.groups)) {
      const groupRankings: { groupCode: string; rows: RankingRow[] }[] = [];
      for (const g of lastDrawRun.params.groups) {
        const code = String(g.code ?? "");
        const ids: number[] = Array.isArray(g.team_ids) ? g.team_ids.map((n: any) => Number(n)) : [];
        const rows = ids.map((id) => ensure(id));
        groupRankings.push({ groupCode: code, rows: sortRanking([...rows]) });
      }
      setRankingByGroup(groupRankings);
    } else {
      setRankingByGroup([]);
    }
  }, [prevMatches, teamsById, pointsConfig, lastDrawRun, championship, prevPhaseId]);

  useEffect(() => {
    let mounted = true;
    async function checkExisting() {
      if (!championship) return;
      const { data } = await supabase
        .from("match")
        .select("id")
        .eq("championship_id", championship.id)
        .eq("phase_id", selectedElimPhaseId);

      if (!mounted) return;
      setExistingElimCount((data ?? []).length);
    }
    checkExisting();
    return () => {
      mounted = false;
    };
  }, [championship, selectedElimPhaseId]);

  const availableWeekendOptions: WeekendOpt[] = useMemo(() => {
    if (!allSlots.length) return [];

    // ✅ Special case: for the Final we must always allow selecting the LAST weekend of the championship,
    // even if that weekend already has matches (e.g. semis) or there are no free slots left.
    const isFinalPhase = selectedElimPhaseId === 5;
    const finalWeekendKey = (() => {
      // Prefer calendarConfig.end_date if present, otherwise fallback to the last slot date.
      const endDateStr = calendarConfig?.end_date;
      if (typeof endDateStr === "string" && endDateStr.length >= 10) {
        return weekendKeyFromDate(parseMatchDateToLocal(endDateStr));
      }
      const lastSlot = allSlots[allSlots.length - 1];
      return lastSlot ? weekendKeyFromDate(new Date(lastSlot.starts_at)) : null;
    })();

    let lastPrelim: Date | null = null;
    prevMatches.forEach((m) => {
      if (m.match_date) {
        const d = parseMatchDateToLocal(m.match_date);
        if (!lastPrelim || d > lastPrelim) lastPrelim = d;
      }
    });

    const map = new Map<string, true>();
    for (const s of allSlots) {
      const d = new Date(s.starts_at);
      const key = weekendKeyFromDate(d);

      // For the Final, always include the last weekend as an option.
      if (isFinalPhase && finalWeekendKey && key === finalWeekendKey) {
        map.set(key, true);
        continue;
      }

      if (occupiedSlotIds.has(s.id)) continue;
      if (lastPrelim && d <= lastPrelim) continue;
      map.set(key, true);
    }

    const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ key: k, label: weekendLabelFromKey(k) }));
  }, [allSlots, occupiedSlotIds, prevMatches, selectedElimPhaseId, calendarConfig]);

  const qualifiedTeams = useMemo(() => {
    const need = ELIM_PHASES.find((p) => p.id === selectedElimPhaseId)?.need ?? 8;

    if (rankingByGroup.length > 0) {
      if (rankingByGroup.length === 2) {
        const perGroup = Math.floor(need / 2);
        const a = rankingByGroup[0].rows.slice(0, perGroup);
        const b = rankingByGroup[1].rows.slice(0, perGroup);
        return { format: "groups2" as const, need, groups: [a, b] };
      }

      const combined = rankingByGroup.flatMap((g) => g.rows);
      const sorted = [...combined].sort((x, y) => {
        if (y.points !== x.points) return y.points - x.points;
        if (y.dg !== x.dg) return y.dg - x.dg;
        if (y.scored !== x.scored) return y.scored - x.scored;
        return x.team_name.localeCompare(y.team_name);
      });
      return { format: "groupsN" as const, need, rows: sorted.slice(0, need) };
    }

    return { format: "league" as const, need, rows: rankingLeague.slice(0, need) };
  }, [rankingByGroup, rankingLeague, selectedElimPhaseId]);

  const autoPairings = useMemo(() => {
    const need = ELIM_PHASES.find((p) => p.id === selectedElimPhaseId)?.need ?? 8;

    // ✅ Special case: 3 groups -> 16 qualified (Top5 from each group + best 6th overall)
    // We MUST avoid same-group matchups.
    if (
      qualifiedTeams.format === "groupsN" &&
      rankingByGroup.length === 3 &&
      need === 16
    ) {
      // Take Top5 per group
      const groups = rankingByGroup
        .map((g) => ({ groupCode: String(g.groupCode), rows: g.rows }))
        .filter((g) => g.rows.length >= 5);

      if (groups.length === 3) {
        const [gA, gB, gC] = groups;

        const top5A = gA.rows.slice(0, 5);
        const top5B = gB.rows.slice(0, 5);
        const top5C = gC.rows.slice(0, 5);

        // Candidates for best 6th: 6th place of each group if present
        const sixthCandidates = [gA, gB, gC]
          .map((g) => ({ groupCode: g.groupCode, row: g.rows[5] as RankingRow | undefined }))
          .filter((x) => !!x.row)
          .map((x) => ({ groupCode: x.groupCode, row: x.row as RankingRow }));

        if (sixthCandidates.length) {
          const bestSixth = [...sixthCandidates].sort((a, b) => {
            const x = a.row;
            const y = b.row;
            if (y.points !== x.points) return y.points - x.points;
            if (y.dg !== x.dg) return y.dg - x.dg;
            if (y.scored !== x.scored) return y.scored - x.scored;
            return x.team_name.localeCompare(y.team_name);
          })[0];

          // Rotate group order so that g6 is first in the cycle.
          const order = [gA.groupCode, gB.groupCode, gC.groupCode];
          const idx = order.indexOf(bestSixth.groupCode);
          const cycle = idx >= 0 ? [...order.slice(idx), ...order.slice(0, idx)] : order;
          const [g6, g1, g2] = cycle;

          const byCode: Record<string, RankingRow[]> = {
            [gA.groupCode]: top5A,
            [gB.groupCode]: top5B,
            [gC.groupCode]: top5C,
          };

          const get = (gc: string, rank: number) => {
            const arr = byCode[gc] ?? [];
            return arr[rank - 1];
          };

          const g6_1 = get(g6, 1);
          const g6_2 = get(g6, 2);
          const g6_3 = get(g6, 3);
          const g6_4 = get(g6, 4);
          const g6_5 = get(g6, 5);

          const g1_1 = get(g1, 1);
          const g1_2 = get(g1, 2);
          const g1_3 = get(g1, 3);
          const g1_4 = get(g1, 4);
          const g1_5 = get(g1, 5);

          const g2_1 = get(g2, 1);
          const g2_2 = get(g2, 2);
          const g2_3 = get(g2, 3);
          const g2_4 = get(g2, 4);
          const g2_5 = get(g2, 5);

          // If any required seed is missing, fallback to the generic pairing.
          if (
            g6_1 &&
            g6_2 &&
            g6_3 &&
            g6_4 &&
            g6_5 &&
            g1_1 &&
            g1_2 &&
            g1_3 &&
            g1_4 &&
            g1_5 &&
            g2_1 &&
            g2_2 &&
            g2_3 &&
            g2_4 &&
            g2_5
          ) {
            // Pattern (guaranteed inter-group):
            // 1g1-5g2, 1g2-6g6, 1g6-5g1,
            // 2g1-4g2, 2g2-5g6, 2g6-4g1,
            // 3g6-3g1, 4g6-3g2
            const pairs: Pairing[] = [
              {
                teamAId: g1_1.team_id,
                teamBId: g2_5.team_id,
                teamAName: g1_1.team_name,
                teamBName: g2_5.team_name,
              },
              {
                teamAId: g2_1.team_id,
                teamBId: bestSixth.row.team_id,
                teamAName: g2_1.team_name,
                teamBName: bestSixth.row.team_name,
              },
              {
                teamAId: g6_1.team_id,
                teamBId: g1_5.team_id,
                teamAName: g6_1.team_name,
                teamBName: g1_5.team_name,
              },
              {
                teamAId: g1_2.team_id,
                teamBId: g2_4.team_id,
                teamAName: g1_2.team_name,
                teamBName: g2_4.team_name,
              },
              {
                teamAId: g2_2.team_id,
                teamBId: g6_5.team_id,
                teamAName: g2_2.team_name,
                teamBName: g6_5.team_name,
              },
              {
                teamAId: g6_2.team_id,
                teamBId: g1_4.team_id,
                teamAName: g6_2.team_name,
                teamBName: g1_4.team_name,
              },
              {
                teamAId: g6_3.team_id,
                teamBId: g1_3.team_id,
                teamAName: g6_3.team_name,
                teamBName: g1_3.team_name,
              },
              {
                teamAId: g6_4.team_id,
                teamBId: g2_3.team_id,
                teamAName: g6_4.team_name,
                teamBName: g2_3.team_name,
              },
            ];

            // Safety: ensure no duplicate teams
            const used = new Set<number>();
            for (const p of pairs) {
              if (used.has(p.teamAId) || used.has(p.teamBId)) {
                break;
              }
              used.add(p.teamAId);
              used.add(p.teamBId);
            }

            if (used.size === 16) return pairs;
          }
        }
      }
    }

    if (qualifiedTeams.format === "groups2") {
      const [ga, gb] = qualifiedTeams.groups;
      const pairs: Pairing[] = [];
      const n = Math.min(ga.length, gb.length);
      for (let i = 0; i < n; i++) {
        const a = ga[i];
        const b = gb[n - 1 - i];
        pairs.push({
          teamAId: a.team_id,
          teamBId: b.team_id,
          teamAName: a.team_name,
          teamBName: b.team_name,
        });
      }
      return pairs;
    }

    const rows =
      qualifiedTeams.format === "league"
        ? qualifiedTeams.rows
        : qualifiedTeams.format === "groupsN"
        ? qualifiedTeams.rows
        : [];

    const slice = rows.slice(0, need);
    const pairs: Pairing[] = [];
    for (let i = 0; i < Math.floor(slice.length / 2); i++) {
      const a = slice[i];
      const b = slice[slice.length - 1 - i];
      pairs.push({
        teamAId: a.team_id,
        teamBId: b.team_id,
        teamAName: a.team_name,
        teamBName: b.team_name,
      });
    }
    return pairs;
  }, [qualifiedTeams, selectedElimPhaseId, rankingByGroup]);

  const randomPairings = useMemo(() => {
    const seed = Number(lastDrawRun?.seed ?? Date.now());
    const need = ELIM_PHASES.find((p) => p.id === selectedElimPhaseId)?.need ?? 8;

    let rows: RankingRow[] = [];
    if (qualifiedTeams.format === "groups2") {
      rows = [...qualifiedTeams.groups[0], ...qualifiedTeams.groups[1]];
    } else if (qualifiedTeams.format === "league") {
      rows = qualifiedTeams.rows;
    } else if (qualifiedTeams.format === "groupsN") {
      rows = qualifiedTeams.rows;
    }

    const picked = rows.slice(0, need);
    const shuffled = shuffle(picked, seed);
    const pairs: Pairing[] = [];
    for (let i = 0; i < Math.floor(shuffled.length / 2); i++) {
      const a = shuffled[2 * i];
      const b = shuffled[2 * i + 1];
      if (!a || !b) continue;
      pairs.push({
        teamAId: a.team_id,
        teamBId: b.team_id,
        teamAName: a.team_name,
        teamBName: b.team_name,
      });
    }
    return pairs;
  }, [qualifiedTeams, selectedElimPhaseId, lastDrawRun]);

  const previewPairings = useMemo(() => {
    if (mode === "manual") return manualPairings;
    if (mode === "random") return randomPairings;
    return autoPairings;
  }, [mode, manualPairings, autoPairings, randomPairings]);

  function getHourPriorityList(): string[] {
    const p =
      lastDrawRun?.params?.priority_match_order_hours ??
      calendarConfig?.priority_match_order_hours;
    if (Array.isArray(p) && p.length > 0) return p.map(String);
    return ["10:30", "12:00", "09:00", "16:00", "17:30"];
  }

  function getEligibleFreeSlots(): MatchSlot[] {
    const hourPriority = getHourPriorityList();
    const weekendSet = selectedWeekends;

    let lastPrelimDate: Date | null = null;
    prevMatches.forEach((m) => {
      if (m.match_date) {
        const d = new Date(m.match_date);
        if (!lastPrelimDate || d > lastPrelimDate) lastPrelimDate = d;
      }
    });

    const free = allSlots.filter((s) => {
      if (occupiedSlotIds.has(s.id)) return false;

      const d = new Date(s.starts_at);
      if (lastPrelimDate && d <= lastPrelimDate) return false;

      const wk = weekendKeyFromDate(d);
      if (!weekendSet.has(wk)) return false;

      return true;
    });

    const prioIndex = (hhmm: string) => {
      const i = hourPriority.indexOf(hhmm);
      return i === -1 ? 999 : i;
    };

    return free.sort((a, b) => {
      const da = new Date(a.starts_at);
      const db = new Date(b.starts_at);

      const ta = formatHour(da);
      const tb = formatHour(db);

      const pa = prioIndex(ta);
      const pb = prioIndex(tb);
      if (pa !== pb) return pa - pb;

      const diff = da.getTime() - db.getTime();
      if (diff !== 0) return diff;

      return a.field_code.localeCompare(b.field_code); // A before B
    });
  }

  function slotLabel(slot: MatchSlot) {
    const d = new Date(slot.starts_at);
    return `${formatDayBadge(d)}, ${formatHour(d)} · Camp ${slot.field_code}`;
  }

  function teamPrefSet(teamId: number): Set<number> {
    const s = new Set<number>();
    preferences.forEach((p) => {
      if (p.team_id === teamId) s.add(p.game_slot_id);
    });
    return s;
  }

  function getQualifiedListFlat(): RankingRow[] {
    const need = ELIM_PHASES.find((p) => p.id === selectedElimPhaseId)?.need ?? 8;
    if (qualifiedTeams.format === "groups2") {
      return [...qualifiedTeams.groups[0], ...qualifiedTeams.groups[1]].slice(0, need);
    }
    if (qualifiedTeams.format === "groupsN") return qualifiedTeams.rows.slice(0, need);
    return qualifiedTeams.rows.slice(0, need);
  }

  const qualifiedListFlat = useMemo(() => getQualifiedListFlat(), [qualifiedTeams, selectedElimPhaseId]);

  useEffect(() => {
    setManualPairings([]);
    setSelectedTeamForManual(null);
    setSlotAssignment({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedElimPhaseId, mode]);

  useEffect(() => {
    // If weekends changed, clear chosen slots that are no longer eligible
    const eligibleIds = new Set(getEligibleFreeSlots().map((s) => s.id));
    setSlotAssignment((prev) => {
      const next: Record<number, number> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const idx = Number(k);
        if (eligibleIds.has(Number(v))) next[idx] = Number(v);
      });
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWeekends]);

  function addManualToNextSlot(teamId: number) {
    if (manualPairings.some((p) => p.teamAId === teamId || p.teamBId === teamId)) {
      Alert.alert("Avis", "Aquest equip ja està assignat en un encreuament.");
      return;
    }

    if (selectedTeamForManual == null) {
      setSelectedTeamForManual(teamId);
      return;
    }

    const teamAId = selectedTeamForManual;
    const teamAName = teamsById.get(teamAId)?.name ?? `Equip ${teamAId}`;
    const teamBName = teamsById.get(teamId)?.name ?? `Equip ${teamId}`;

    const targetPairsCount = Math.floor(
      (ELIM_PHASES.find((p) => p.id === selectedElimPhaseId)?.need ?? 8) / 2
    );

    if (manualPairings.length >= targetPairsCount) {
      Alert.alert("Avis", "Ja tens tots els encreuaments creats.");
      setSelectedTeamForManual(null);
      return;
    }

    setManualPairings([
      ...manualPairings,
      { teamAId, teamBId: teamId, teamAName, teamBName },
    ]);
    setSelectedTeamForManual(null);
  }

  const usedSlotIdsInUI = useMemo(() => {
    const s = new Set<number>();
    Object.values(slotAssignment).forEach((id) => s.add(Number(id)));
    return s;
  }, [slotAssignment]);

  const canCreate = useMemo(() => {
    if (!isAdmin) return false;
    if (!championship) return false;
    if (!lastDrawRun) return false;
    if (!prevPhaseId) return false;
    if (prevMatches.length === 0) return false;
    if (prevIncompleteCount > 0) return false;
    if (existingElimCount > 0) return false;

    const need = ELIM_PHASES.find((p) => p.id === selectedElimPhaseId)?.need ?? 8;
    const count =
      qualifiedTeams.format === "groups2"
        ? qualifiedTeams.groups[0].length + qualifiedTeams.groups[1].length
        : qualifiedTeams.format === "league"
        ? qualifiedTeams.rows.length
        : qualifiedTeams.format === "groupsN"
        ? qualifiedTeams.rows.length
        : 0;
    if (count < need) return false;

    if (selectedWeekends.size === 0) return false;

    const slots = getEligibleFreeSlots();
    if (slots.length < previewPairings.length) return false;

    if (mode === "manual") {
      const targetPairs = Math.floor(need / 2);
      if (manualPairings.length !== targetPairs) return false;
    }

    // ✅ Require admin to choose a slot for every pairing
    if (Object.keys(slotAssignment).length !== previewPairings.length) return false;

    return true;
  }, [
    isAdmin,
    championship,
    lastDrawRun,
    prevPhaseId,
    prevMatches,
    prevIncompleteCount,
    existingElimCount,
    selectedElimPhaseId,
    qualifiedTeams,
    selectedWeekends,
    previewPairings,
    mode,
    manualPairings,
    slotAssignment,
  ]);

  async function handleCreate() {
    if (!championship || !lastDrawRun) return;

    if (prevIncompleteCount > 0) {
      Alert.alert("No es pot crear", "Encara hi ha partits pendents de la fase prèvia.");
      return;
    }
    if (existingElimCount > 0) {
      Alert.alert("No es pot crear", "Aquesta eliminatòria ja existeix.");
      return;
    }
    if (selectedWeekends.size === 0) {
      Alert.alert("No es pot crear", "Selecciona com a mínim un cap de setmana.");
      return;
    }

    const pairs = previewPairings;
    if (pairs.length === 0) {
      Alert.alert("No es pot crear", "No hi ha encreuaments a crear.");
      return;
    }

    const freeSlots = getEligibleFreeSlots();
    if (freeSlots.length < pairs.length) {
      Alert.alert("No es pot crear", "No hi ha slots suficients als caps de setmana seleccionats.");
      return;
    }

    if (Object.keys(slotAssignment).length !== pairs.length) {
      Alert.alert("Falten slots", "Has d'assignar un slot a cada partit.");
      return;
    }

    const slotById = new Map<number, MatchSlot>();
    freeSlots.forEach((s) => slotById.set(s.id, s));

    const assignments: { pair: Pairing; slot: MatchSlot }[] = [];
    for (let i = 0; i < pairs.length; i++) {
      const slotId = Number(slotAssignment[i]);
      const slot = slotById.get(slotId);
      if (!slot) {
        Alert.alert("Slot invàlid", "Alguns slots seleccionats ja no són disponibles.");
        return;
      }
      assignments.push({ pair: pairs[i], slot });
    }

    // Safety: ensure no duplicate slot_id in chosen assignment
    const chosenIds = assignments.map((a) => a.slot.id);
    const unique = new Set(chosenIds);
    if (unique.size !== chosenIds.length) {
      Alert.alert("Error", "Has assignat el mateix slot a més d'un partit.");
      return;
    }

    const phaseMeta = ELIM_PHASES.find((p) => p.id === selectedElimPhaseId);
    const kind = `elimination_${phaseMeta?.code ?? selectedElimPhaseId}`;
    const seed = Number(Date.now());

    const params = {
      format: kind,
      mode,
      phase_id: selectedElimPhaseId,
      source_draw_run_id: lastDrawRun.id,
      source_kind: lastDrawRun.kind,
      qualified_teams: getQualifiedListFlat().map((r) => r.team_id),
      pairings: assignments.map((a) => ({
        team_a: a.pair.teamAId,
        team_b: a.pair.teamBId,
        slot_id: a.slot.id,
        match_date: a.slot.starts_at,
        field_code: a.slot.field_code,
        game_slot_id: a.slot.game_slot_id,
      })),
      allowed_weekends: Array.from(selectedWeekends),
    };

    Alert.alert(
      "Confirmació",
      `Crear ${phaseMeta?.label ?? "eliminatòria"} amb ${assignments.length} partits?`,
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Crear",
          style: "destructive",
          onPress: async () => {
            setBusyCreating(true);
            try {
              const { data: drIns, error: drErr } = await supabase
                .from("draw_run")
                .insert({
                  championship_id: championship.id,
                  seed,
                  kind,
                  params,
                })
                .select("id")
                .single();

              if (drErr || !drIns) throw new Error(drErr?.message ?? "No s'ha pogut crear draw_run.");
              const drawRunId = Number((drIns as any).id);

              const payload = assignments.map(({ pair, slot }) => ({
                championship_id: championship.id,
                phase_id: selectedElimPhaseId,
                team_a_id: pair.teamAId,
                team_b_id: pair.teamBId,
                slot_id: slot.id,
                match_date: slot.starts_at,
                referee_id: 1,
                is_finished: false,
                score_team_a: 0,
                score_team_b: 0,
                preference_conflict: false,
                preference_notes: {},
                draw_run_id: drawRunId,
              }));

              const { error: mErr } = await supabase.from("match").insert(payload);
              if (mErr) throw new Error(mErr.message);

              Alert.alert("Creat!", "Eliminatòria creada correctament.");
              const newOcc = new Set(occupiedSlotIds);
              assignments.forEach(({ slot }) => newOcc.add(slot.id));
              setOccupiedSlotIds(newOcc);
              setExistingElimCount(assignments.length);
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Error inesperat.");
            } finally {
              setBusyCreating(false);
            }
          },
        },
      ]
    );
  }
const phaseMeta = ELIM_PHASES.find((p) => p.id === selectedElimPhaseId);
  const need = phaseMeta?.need ?? 8;

  const qualifiedCount =
    qualifiedTeams.format === "groups2"
      ? qualifiedTeams.groups[0].length + qualifiedTeams.groups[1].length
      : qualifiedTeams.format === "league"
      ? qualifiedTeams.rows.length
      : qualifiedTeams.format === "groupsN"
      ? qualifiedTeams.rows.length
      : 0;

  const targetPairsCount = Math.floor(need / 2);
  const eligibleSlots = getEligibleFreeSlots();

  const slotCountEligible = eligibleSlots.length;

  const slotById = new Map<number, MatchSlot>();
  eligibleSlots.forEach((s) => slotById.set(s.id, s));
  
  const slotCandidatesForPick = useMemo(() => {
    if (slotPickForIndex == null) return[];
    const already = new Set<number>(Object.entries(slotAssignment).filter(([k]) => Number(k) !== slotPickForIndex).map(([, v]) => Number(v)));
    return eligibleSlots.filter((s) => !already.has(s.id));
  }, [slotPickForIndex, eligibleSlots, slotAssignment]);
  const statusCard = useMemo(() => {
    if (!lastDrawRun) {
      return {
        tone: "warn" as const,
        title: "No hi ha sorteig previ",
        desc: "Primer has de crear la lliga o els grups abans de crear eliminatòries.",
      };
    }
    if (!prevPhaseId) {
      return {
        tone: "warn" as const,
        title: "Fase prèvia desconeguda",
        desc: "No s'ha pogut determinar la fase prèvia.",
      };
    }
    if (prevMatches.length === 0) {
      return {
        tone: "warn" as const,
        title: "No hi ha partits previs",
        desc: "No es troben partits de la fase prèvia.",
      };
    }
    if (prevIncompleteCount > 0) {
      return {
        tone: "danger" as const,
        title: "Fase prèvia no finalitzada",
        desc: `Queden ${prevIncompleteCount} partits pendents (${prevPhaseName || "fase"}).`,
      };
    }
    return {
      tone: "ok" as const,
      title: "Fase prèvia completada",
      desc: "Ja pots crear la següent eliminatòria.",
    };
  }, [lastDrawRun, prevPhaseId, prevMatches, prevIncompleteCount, prevPhaseName]);

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  if (!championship) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <Text style={{ fontWeight: "900", fontSize: 18, marginBottom: 8 }}>
          No hi ha campionat actiu
        </Text>
        <Text style={{ color: "#6b7280" }}>
          Activa un campionat per crear eliminatòries.
        </Text>
      </SafeAreaView>
    );
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <Text style={{ fontWeight: "900", fontSize: 18, marginBottom: 8 }}>
          Accés restringit
        </Text>
        <Text style={{ color: "#6b7280" }}>
          Aquesta pantalla és només per administradors.
        </Text>
        <BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView edges={[ "left", "right", "bottom"]} style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={{ padding: 16 }}>
        <BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />

        <Text style={{ fontSize: 26, fontWeight: "900", marginBottom: 4,textAlign:"center" }}>
          Crear eliminatòries
        </Text>
        <Text style={{ color: "#6b7280", marginBottom: 14,textAlign:"center" }}>
          {championship.name}
        </Text>

        <View
          style={{
            backgroundColor:
              statusCard.tone === "ok"
                ? "#ecfdf5"
                : statusCard.tone === "danger"
                ? "#fef2f2"
                : "#fffbeb",
            borderColor:
              statusCard.tone === "ok"
                ? "#10b981"
                : statusCard.tone === "danger"
                ? "#ef4444"
                : "#f59e0b",
            borderWidth: 1,
            borderRadius: 14,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <Text style={{ fontWeight: "900", marginBottom: 4 }}>
            {statusCard.title}
          </Text>
          <Text style={{ color: "#374151", fontWeight: "600" }}>
            {statusCard.desc}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", marginBottom: 10 }}>
            Fase a crear
          </Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {ELIM_PHASES.map((p) => {
              const selected = p.id === selectedElimPhaseId;
              return (
                <Pressable
                  key={p.id}
                  onPress={() => setSelectedElimPhaseId(p.id)}
                  style={{
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: selected ? "#111827" : "#d1d5db",
                    backgroundColor: selected ? "#111827" : "#fff",
                    marginRight: 8,
                    marginBottom: 8,
                  }}
                >
                  <Text style={{ fontWeight: "800", color: selected ? "#fff" : "#111827" }}>
                    {p.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={{ color: "#6b7280", marginTop: 6 }}>
            Necessaris: <Text style={{ fontWeight: "900" }}>{need}</Text> equips ·{" "}
            <Text style={{ fontWeight: "900" }}>{targetPairsCount}</Text> partits
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", marginBottom: 10 }}>Mode</Text>

          <View style={{ flexDirection: "row" }}>
            {[
              { key: "auto" as const, label: "Automàtic" },
              { key: "random" as const, label: "Random" },
              { key: "manual" as const, label: "Manual" },
            ].map((m) => {
              const selected = m.key === mode;
              return (
                <Pressable
                  key={m.key}
                  onPress={() => setMode(m.key)}
                  style={{
                    flex: 1,
                    paddingVertical: 10,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: selected ? "#111827" : "#d1d5db",
                    backgroundColor: selected ? "#111827" : "#fff",
                    alignItems: "center",
                    marginRight: m.key === "manual" ? 0 : 8,
                  }}
                >
                  <Text style={{ fontWeight: "900", color: selected ? "#fff" : "#111827" }}>
                    {m.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={{ color: "#6b7280", marginTop: 8 }}>
            {mode === "auto" &&
              "Encreuaments segons classificació (1 vs últim, 2 vs penúltim, etc.)."}
            {mode === "random" && "Encreuaments aleatoris."}
            {mode === "manual" && "Selecciona equips manualment (A i després B)."}
          </Text>
        </View>

        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", marginBottom: 10 }}>
            Caps de setmana
          </Text>

          <Pressable
            onPress={() => setWeekendModalOpen(true)}
            style={{
              paddingVertical: 10,
              paddingHorizontal: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#d1d5db",
              backgroundColor: "#fff",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontWeight: "800" }}>
              {selectedWeekends.size === 0
                ? "Selecciona caps de setmana"
                : `${selectedWeekends.size} seleccionat(s)`}
            </Text>
            <Text style={{ fontWeight: "900" }}>▾</Text>
          </Pressable>

          <Text style={{ color: "#6b7280", marginTop: 8 }}>
            Slots disponibles amb el filtre:{" "}
            <Text style={{ fontWeight: "900" }}>{slotCountEligible}</Text>
          </Text>
        </View>

        <Modal
          visible={weekendModalOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setWeekendModalOpen(false)}
        >
          <Pressable
            onPress={() => setWeekendModalOpen(false)}
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.35)",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <View
              style={{
                backgroundColor: "#fff",
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: "#e5e7eb",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "900", marginBottom: 12 }}>
                Selecciona caps de setmana
              </Text>

              {availableWeekendOptions.length === 0 ? (
                <Text style={{ color: "#6b7280" }}>
                  No hi ha caps de setmana amb slots buits.
                </Text>
              ) : (
                availableWeekendOptions.map((w) => {
                  const checked = selectedWeekends.has(w.key);
                  return (
                    <Pressable
                      key={w.key}
                      onPress={() => {
                        const next = new Set(selectedWeekends);
                        if (checked) next.delete(w.key);
                        else next.add(w.key);
                        setSelectedWeekends(next);
                      }}
                      style={{
                        paddingVertical: 10,
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ fontWeight: checked ? "900" : "600" }}>
                        {w.label}
                      </Text>
                      <Text style={{ fontWeight: "900" }}>{checked ? "✓" : ""}</Text>
                    </Pressable>
                  );
                })
              )}

              <Pressable
                onPress={() => setWeekendModalOpen(false)}
                style={{
                  marginTop: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: "#111827",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>Fet</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", marginBottom: 6 }}>
            Equips classificats
          </Text>
          <Text style={{ color: "#6b7280", marginBottom: 10 }}>
            Detectat:{" "}
            <Text style={{ fontWeight: "900" }}>
              {rankingByGroup.length > 0 ? "Grups" : "Lliga"}
            </Text>{" "}
            · Equips disponibles:{" "}
            <Text style={{ fontWeight: "900" }}>{qualifiedCount}</Text>
          </Text>

          <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
            {qualifiedListFlat.slice(0, need).map((t) => (
              <View
                key={t.team_id}
                style={{
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 999,
                  borderWidth: 1,
                  borderColor: "#e5e7eb",
                  backgroundColor: "#f9fafb",
                  marginRight: 8,
                  marginBottom: 8,
                }}
              >
                <Text style={{ fontWeight: "800" }}>{t.team_name}</Text>
                
              </View>
            ))}
          </View>

          {qualifiedCount < need && (
            <Text style={{ marginTop: 6, color: "#ef4444", fontWeight: "800" }}>
              No hi ha prou equips (calen {need}).
            </Text>
          )}
        </View>

        {mode === "manual" && (
          <View
            style={{
              backgroundColor: "#fff",
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#e5e7eb",
              padding: 12,
              marginBottom: 12,
            }}
          >
            <Text style={{ fontWeight: "900", marginBottom: 6 }}>
              Encreuaments manuals
            </Text>

            {selectedTeamForManual != null && (
              <View
                style={{
                  backgroundColor: "#111827",
                  borderRadius: 12,
                  padding: 10,
                  marginBottom: 10,
                }}
              >
                <Text style={{ color: "#fff", fontWeight: "900" }}>
                  Equip A:{" "}
                  {teamsById.get(selectedTeamForManual)?.name ?? `Equip ${selectedTeamForManual}`}
                </Text>
                <Pressable onPress={() => setSelectedTeamForManual(null)} style={{ marginTop: 6 }}>
                  <Text style={{ color: "#fff", fontWeight: "900" }}>Cancel·lar</Text>
                </Pressable>
              </View>
            )}

            <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
              {qualifiedListFlat.slice(0, need).map((t) => {
                const used = manualPairings.some((p) => p.teamAId === t.team_id || p.teamBId === t.team_id);
                const selected = selectedTeamForManual === t.team_id;
                return (
                  <Pressable
                    key={t.team_id}
                    onPress={() => {
                      if (used) return;
                      addManualToNextSlot(t.team_id);
                    }}
                    style={{
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 999,
                      borderWidth: 1,
                      borderColor: selected ? "#111827" : "#e5e7eb",
                      backgroundColor: used ? "#f3f4f6" : selected ? "#111827" : "#fff",
                      marginRight: 8,
                      marginBottom: 8,
                      opacity: used ? 0.6 : 1,
                    }}
                  >
                    <Text style={{ fontWeight: "900", color: selected ? "#fff" : "#111827" }}>
                      {t.team_name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={{ marginTop: 6, color: "#6b7280" }}>
              Encreuaments:{" "}
              <Text style={{ fontWeight: "900" }}>{manualPairings.length}</Text> /{" "}
              <Text style={{ fontWeight: "900" }}>{targetPairsCount}</Text>
            </Text>

            <Pressable
              onPress={() => {
                setManualPairings([]);
                setSelectedTeamForManual(null);
                setSlotAssignment({});
              }}
              style={{
                marginTop: 10,
                paddingVertical: 10,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#d1d5db",
                backgroundColor: "#fff",
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "900" }}>Reiniciar</Text>
            </Pressable>
          </View>
        )}

        <View
          style={{
            backgroundColor: "#fff",
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            padding: 12,
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "900", marginBottom: 10 }}>
            Encreuaments i slots (decideix l'admin)
          </Text>

          {existingElimCount > 0 && (
            <Text style={{ color: "#ef4444", fontWeight: "900", marginBottom: 10 }}>
              Ja existeixen partits per aquesta fase.
            </Text>
          )}

          {previewPairings.length === 0 ? (
            <Text style={{ color: "#6b7280" }}>
              No hi ha encreuaments disponibles.
            </Text>
          ) : (
            previewPairings.map((p, idx) => {
              const assignedSlotId = slotAssignment[idx];
              const assignedSlot = assignedSlotId ? slotById.get(Number(assignedSlotId)) : undefined;
              const isAssigned = !!assignedSlot;
              return (
                <View
                  key={`${p.teamAId}-${p.teamBId}-${idx}`}
                  style={{
                    paddingVertical: 12,
                    borderBottomWidth: idx === previewPairings.length - 1 ? 0 : 1,
                    borderBottomColor: "#e5e7eb",
                  }}
                >
                  <Text style={{ fontWeight: "900", marginBottom: 8 }}>
                    {p.teamAName} <Text style={{ color: "#6b7280" }}>vs</Text>{" "}
                    {p.teamBName}
                {mode === "manual" && (
                  <Text style={{ color: "#6b7280", marginTop: 4 }}>
                    Slot: {manualSlotByPairIdx[idx] ? `#${manualSlotByPairIdx[idx]}` : "No assignat"}
                  </Text>
                )}
                  </Text>

                  <Pressable
                    onPress={() => {
                      setSlotPickForIndex(idx);
                      setSlotPickOpen(true);
                    }}
                    style={{
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: isAssigned ? "#111827" : "#d1d5db",
                      backgroundColor: isAssigned ? "#111827" : "#fff",
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ fontWeight: "900", color: isAssigned ? "#fff" : "#111827" }}>
                      {isAssigned ? slotLabel(assignedSlot!) : "Assignar slot"}
                    </Text>
                    <Text style={{ fontWeight: "900", color: isAssigned ? "#fff" : "#111827" }}>
                      ▾
                    </Text>
                  </Pressable>
                </View>
              );
            })
          )}

          {previewPairings.length > 0 && Object.keys(slotAssignment).length !== previewPairings.length && (
            <Text style={{ marginTop: 10, color: "#ef4444", fontWeight: "800" }}>
              Falta assignar slot a {previewPairings.length - Object.keys(slotAssignment).length} partit(s).
            </Text>
          )}
        </View>

        <Modal
          visible={slotPickOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setSlotPickOpen(false)}
        >
          <Pressable
            onPress={() => setSlotPickOpen(false)}
            style={{
              flex: 1,
              backgroundColor: "rgba(0,0,0,0.35)",
              justifyContent: "center",
              padding: 24,
            }}
          >
            <View
              style={{
                backgroundColor: "#fff",
                borderRadius: 16,
                padding: 16,
                borderWidth: 1,
                borderColor: "#e5e7eb",
                maxHeight: "80%",
              }}
            >
              <Text style={{ fontSize: 16, fontWeight: "900", marginBottom: 10 }}>
                Selecciona slot
              </Text>
              <Text style={{ color: "#6b7280", marginBottom: 12 }}>
                Només surten slots lliures del(s) cap(s) de setmana seleccionat(s).
              </Text>

              <ScrollView>
                {slotCandidatesForPick.length === 0 ? (
                  <Text style={{ color: "#6b7280" }}>
                    No hi ha slots disponibles (potser ja assignats).
                  </Text>
                ) : (
                  slotCandidatesForPick.map((s) => {
                    const label = slotLabel(s);
                    return (
                      <Pressable
                        key={s.id}
                        onPress={() => {
                          if (slotPickForIndex == null) return;
                          setSlotAssignment((prev) => ({ ...prev, [slotPickForIndex]: s.id }));
                          setSlotPickOpen(false);
                          setSlotPickForIndex(null);
                        }}
                        style={{
                          paddingVertical: 10,
                          borderBottomWidth: 1,
                          borderBottomColor: "#f3f4f6",
                        }}
                      >
                        <Text style={{ fontWeight: "900" }}>{label}</Text>
                      </Pressable>
                    );
                  })
                )}
              </ScrollView>

              <Pressable
                onPress={() => {
                  setSlotPickOpen(false);
                  setSlotPickForIndex(null);
                }}
                style={{
                  marginTop: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#d1d5db",
                  backgroundColor: "#fff",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900" }}>Tancar</Text>
              </Pressable>
            </View>
          </Pressable>
        </Modal>

        <Pressable
          onPress={() => handleCreate()}
          disabled={!canCreate || busyCreating}
          style={{
            paddingVertical: 14,
            borderRadius: 14,
            backgroundColor: !canCreate || busyCreating ? "#9ca3af" : "#111827",
            alignItems: "center",
            marginBottom: 20,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "900", fontSize: 16 }}>
            {busyCreating ? "Creant..." : `Crear ${phaseMeta?.label ?? "eliminatòria"}`}
          </Text>
        </Pressable>

        {!canCreate && (
          <Text style={{ color: "#6b7280", marginBottom: 30 }}>
            Per crear: fase prèvia finalitzada, fase no creada, caps de setmana seleccionats, slots suficients i un slot assignat per cada partit.
          </Text>
        )}

      </ScrollView>
    </SafeAreaView>
  );
}
