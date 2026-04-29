import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  FlatList,
  Pressable,
  Alert,
  StyleSheet,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../src/supabase";
import { useAppTheme, AppColors } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";
import { BackButton, RefreshButton } from "../components/HeaderButtons";
import { formatDateDDMMYYYY_HHMM } from "../src/utils/format";

type PlayerMap = Record<number, string>;
type TeamMap = Record<number, { name: string; short_name: string }>;

type PdfEventRow = {
  mrNumber: number;
  turn: number;
  when: string;
  team: string;
  player: string;
  type: string;
  value: string;
  attackTeam: string;
  defenseTeam: string;
};

type MatchInfo = {
  id: number;
  championship_id?: number | null;
  phase?: { name: string | null } | null;
  match_date: string | null;
  started_at?: string | null;
  score_team_a: number;
  score_team_b: number;
  finished_at: string | null;
  is_finished: boolean;
  team_a_id: number | null;
  team_b_id: number | null;
  team_a?: { name: string | null; short_name: string | null } | null;
  team_b?: { name: string | null; short_name: string | null } | null;
  slot?: { field_code: string | null } | null;
};

type MatchRoundRow = { id: number; number: number };

type RoundRow = {
  id: number;
  turn: number | null;
  match_round_id: number | null;
  attacking_team_id: number | null;
  defending_team_id: number | null;
};

type PlayRow = {
  id: number;
  round_id: number | null;
  attacker_player_id: number | null;
  eliminated_by_player_id: number | null;
};

type PlayEventRow = {
  id: number;
  play_id: number | null;
  event_type: string | null;
  value: number | null;
  player_id: number | null;
  created_at: string | null;
};

type RoundLineupRow = {
  id: number;
  round_id: number;
  team_id: number;
  player_id: number;
  role: string | null;
  order_in_role: number | null;
  created_at: string | null;
};

type CaptainOverrideRow = { team_id: number; player_id: number };

type TimelineItem =
  | { key: string; kind: "turn_header"; text: string }
  | {
      key: string;
      kind: "play";
      text: string;
      badge?: { label: string; variant: "green" | "red" | "blue" | "purple" | "gray" };
    }
  | { key: string; kind: "turn_end"; text: string };


type LineupListItem =
  | { key: string; kind: "lineup_header"; text: string }
  | {
      key: string;
      kind: "lineup_round";
      roundNumber: number | null; // match_round.number
      turn: number | null;
      attackTeamLabel: string;
      defenseTeamLabel: string;
      playersAttack: { id: number; name: string; order: number | null; isCaptain: boolean }[];
      playersDefense: { id: number; name: string; order: number | null; isCaptain: boolean }[];
    }
  | {
      key: string;
      kind: "lineup_team";
      teamLabel: string;
      playersAttack: { id: number; name: string; order: number | null; isCaptain: boolean }[];
      playersDefense: { id: number; name: string; order: number | null; isCaptain: boolean }[];
    };

type StatListItem =
  | { key: string; kind: "stat_header"; text: string }
  | { key: string; kind: "stat_row"; label: string; a: number; b: number }
  | {
      key: string;
      kind: "stat_top";
      title: string;
      rows: { label: string; value: number }[];
    };

type ListItem = TimelineItem | LineupListItem | StatListItem;

type TabKey = "summary" | "lineups" | "stats";

function trimCharField(s?: string | null) {
  return (s ?? "").trim();
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildActaHtml(params: {
  title: string;
  phaseName: string;
  datePrevText: string;
  dateRealText: string;
  fieldCode: string;
  referee: string;
  scoreA: number;
  scoreB: number;
  teamA: string;
  teamB: string;
  status: string;
  eventRows: PdfEventRow[];
}) {
  const {
    title,
    phaseName,
    datePrevText,
    dateRealText,
    fieldCode,
    referee,
    scoreA,
    scoreB,
    teamA,
    teamB,
    status,
    eventRows,
  } = params;

  function roundLabel(n: number) {
    if (n === 1) return "PRIMERA RONDA";
    if (n === 2) return "SEGONA RONDA";
    if (n === 3) return "TERCERA RONDA";
    if (n === 4) return "QUARTA RONDA";
    return `RONDA ${n}`;
  }

  const grouped = new Map<
    string,
    { mrNumber: number; turn: number; attackTeam: string; defenseTeam: string; rows: PdfEventRow[] }
  >();
  for (const r of eventRows ?? []) {
    const key = `${r.mrNumber}|${r.turn}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        mrNumber: r.mrNumber,
        turn: r.turn,
        attackTeam: r.attackTeam,
        defenseTeam: r.defenseTeam,
        rows: [],
      });
    }
    grouped.get(key)!.rows.push(r);
  }

  const groupsSorted = Array.from(grouped.values()).sort((a, b) => {
    if (a.mrNumber !== b.mrNumber) return a.mrNumber - b.mrNumber;
    return a.turn - b.turn;
  });

  let currentMr = -1;
  const eventsHtml = groupsSorted
    .map((g) => {
      const header = g.mrNumber !== currentMr;
      currentMr = g.mrNumber;

      const rows = (g.rows ?? [])
        .map(
          (r) => `
            <tr>
              <td class="td">${escapeHtml(r.when || "-")}</td>
              <td class="td">${escapeHtml(r.team || "-")}</td>
              <td class="td">${escapeHtml(r.player || "-")}</td>
              <td class="td">${escapeHtml(r.type || "-")}</td>
              <td class="td" style="text-align:right;">${escapeHtml(r.value || "")}</td>
            </tr>`
        )
        .join("");

      return `
        ${header ? `<div class="ronda">${escapeHtml(roundLabel(g.mrNumber))}</div>` : ""}
        <div class="torn">Torn ${escapeHtml(String(g.turn))} · Atac: ${escapeHtml(g.attackTeam || "—")} · Defensa: ${escapeHtml(
        g.defenseTeam || "—"
      )}</div>
        <table class="tbl">
          <thead>
            <tr>
              <th>Hora</th>
              <th>Equip</th>
              <th>Jugador/a</th>
              <th>Tipus</th>
              <th style="text-align:right;">Valor</th>
            </tr>
          </thead>
          <tbody>
            ${rows || `<tr><td class="td" colspan="5">—</td></tr>`}
          </tbody>
        </table>
      `;
    })
    .join("\n");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; padding: 24px; color: #111827; }
    .top { display:flex; align-items:flex-start; justify-content:space-between; gap: 14px; }
    .org { font-size: 12px; color: #6b7280; font-weight: 700; }
    .h1 { font-size: 20px; font-weight: 900; margin: 2px 0 2px; letter-spacing: -0.2px; }
    .sub { color: #6b7280; margin: 0 0 14px; font-weight: 700; }
    .card { border: 1px solid #e5e7eb; border-radius: 14px; padding: 16px; margin-bottom: 14px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .k { font-size: 12px; color: #6b7280; margin-bottom: 3px; }
    .v { font-size: 14px; font-weight: 700; }
    .score { font-size: 34px; font-weight: 900; letter-spacing: -0.5px; margin: 10px 0 0; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-size: 11px; color: #6b7280; font-weight: 800; border-bottom: 1px solid #e5e7eb; padding: 8px 0; }
    .td { padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 12px; }
    .footer { margin-top: 18px; font-size: 11px; color: #6b7280; }
    .ronda { margin: 10px 0 6px; font-weight: 900; letter-spacing: 0.2px; color:#111827; }
    .torn { margin: 0 0 8px; font-size: 12px; color:#374151; font-weight: 800; }
    .tbl { margin-bottom: 12px; }
  </style>
</head>
<body>
  <div class="top">
    <div>
      <div class="org">Associació Cultural del Bèlit</div>
      <div class="h1">ACTA · ${escapeHtml(title)}</div>
      <div class="sub">Acta del partit</div>
    </div>
    <div style="text-align:right;">
      <div class="k">DATA</div>
      <div class="v">${escapeHtml((datePrevText || "—").split(" - ")[0] || "—")}</div>
    </div>
  </div>

  <div class="card">
    <div class="grid">
      <div>
        <div class="k">Fase</div>
        <div class="v">${escapeHtml(phaseName || "—")}</div>
      </div>
      <div>
        <div class="k">Camp</div>
        <div class="v">${escapeHtml(fieldCode || "—")}</div>
      </div>
      <div>
        <div class="k">Àrbitre</div>
        <div class="v">${escapeHtml(referee || "—")}</div>
      </div>
      <div>
        <div class="k">Estat</div>
        <div class="v">${escapeHtml(status || "—")}</div>
      </div>
      <div>
        <div class="k">Hora prevista</div>
        <div class="v">${escapeHtml(datePrevText || "—")}</div>
      </div>
      <div>
        <div class="k">Hora real</div>
        <div class="v">${escapeHtml(dateRealText || "—")}</div>
      </div>
    </div>

    <div class="score">${escapeHtml(teamA)} ${scoreA} — ${scoreB} ${escapeHtml(teamB)}</div>
  </div>

  <div class="card">
    <div class="k" style="font-size:13px;font-weight:800;color:#111827;margin-bottom:8px;">Esdeveniments per ronda</div>
    ${eventsHtml || `<div class="td">—</div>`}
  </div>

  <div class="footer">Generat per Belit • ${escapeHtml(new Date().toLocaleString())}</div>
</body>
</html>`;
}

function teamLabel(teamMap: TeamMap, teamId?: number | null) {
  if (!teamId) return "—";
  const t = teamMap[teamId];
  if (!t) return `#${teamId}`;
  return t.short_name ? `${t.name}` : t.name;
}

function sortByOrderNullLast(a: { order: number | null }, b: { order: number | null }) {
  const ao = a.order;
  const bo = b.order;
  if (ao == null && bo == null) return 0;
  if (ao == null) return 1;
  if (bo == null) return -1;
  return ao - bo;
}

export default function MatchSummary() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const matchId = Number(id);
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { t } = useLanguage();
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const [loading, setLoading] = useState(true);
  const [match, setMatch] = useState<MatchInfo | null>(null);
  // Provisional score while match is in progress (computed from plays/events)
  const [liveScore, setLiveScore] = useState<{ a: number; b: number } | null>(null);
  const [items, setItems] = useState<TimelineItem[]>([]);
  const [notPresentedInfo, setNotPresentedInfo] = useState<{ absent: string; awarded: string; points: number } | null>(null);
  const [hasBelitDor, setHasBelitDor] = useState(false);
  const [refereeName, setRefereeName] = useState<string | null>(null);

  const [pdfEventRows, setPdfEventRows] = useState<PdfEventRow[]>([]);

  const [exportingPdf, setExportingPdf] = useState(false);

  const [tab, setTab] = useState<TabKey>("summary");
  const [lineupItems, setLineupItems] = useState<LineupListItem[]>([]);
  const [statItems, setStatItems] = useState<StatListItem[]>([]);

  const headerTeams = useMemo(() => {
    const a = match?.team_a?.name ?? t("publicMatches.teamA");
    const b = match?.team_b?.name ?? t("publicMatches.teamB");
    const sa = trimCharField(match?.team_a?.short_name);
    const sb = trimCharField(match?.team_b?.short_name);
    const aLabel = sa ? `${a}` : a;
    const bLabel = sb ? `${b} ` : b;
    return `${aLabel} ${t("publicMatches.vs")} ${bLabel}`;
  }, [match, t]);

  const belitDorWinnerName = useMemo(() => {
    if (!hasBelitDor) return null;
    if (!match?.finished_at) return null;
    const aName = match?.team_a?.name ?? t("publicMatches.teamA");
    const bName = match?.team_b?.name ?? t("publicMatches.teamB");
    const sa = match?.score_team_a ?? 0;
    const sb = match?.score_team_b ?? 0;
    if (sa === sb) return null;
    return sa > sb ? aName : bName;
  }, [hasBelitDor, match, t]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [matchId,t])
  );

  async function load() {
    if (!matchId || Number.isNaN(matchId)) {
      Alert.alert(t("common.error"), t("matchSummary.invalidMatchId"));
      return;
    }

    setLoading(true);

    const { data: matchData, error: matchErr } = await supabase
      .from("match")
      .select(
        "id, championship_id, referee_id, phase:phase_id(name), match_date, started_at, score_team_a, score_team_b, finished_at, is_finished, team_a_id, team_b_id, slot:slot_id(field_code), team_a:team_a_id(name, short_name), team_b:team_b_id(name, short_name)"
      )
      .eq("id", matchId)
      .single();

    if (matchErr || !matchData) {
      Alert.alert(t("common.error"), matchErr?.message ?? t("matchSummary.loadError"));
      setLoading(false);
      return;
    }

    if (matchData.referee_id) {
      const { data: ref, error } = await supabase
        .from("referee")
        .select("name")
        .eq("id", matchData.referee_id)
        .single();

      if (!error) {
        setRefereeName(ref?.name ?? null);
      }
    }

    setMatch(matchData as unknown as MatchInfo);

    const { data: matchRounds, error: mrErr } = await supabase
      .from("match_round")
      .select("id, number")
      .eq("match_id", matchId)
      .order("number", { ascending: true });

    if (mrErr) {
      Alert.alert(t("common.error"), mrErr.message);
      setLoading(false);
      return;
    }

	// Normalize match_round rows for later lineup grouping
	const matchRoundRows = (matchRounds ?? []) as MatchRoundRow[];

	const mrIds = matchRoundRows.map((x) => x.id);
    if (mrIds.length === 0) {
      setItems([]);
      setLineupItems([]);
      setStatItems([]);
      setPdfEventRows([]);
      setLoading(false);
      return;
    }

    const { data: rounds, error: rErr } = await supabase
      .from("round")
      .select("id, turn, match_round_id, attacking_team_id, defending_team_id")
      .in("match_round_id", mrIds);

    if (rErr) {
      Alert.alert(t("common.error"), rErr.message);
      setLoading(false);
      return;
    }

    const roundRows = (rounds ?? []) as RoundRow[];
    const roundIds = roundRows.map((r) => r.id);

    const { data: plays, error: pErr } = await supabase
      .from("play")
      .select("id, round_id, attacker_player_id, eliminated_by_player_id")
      .in("round_id", roundIds);

    if (pErr) {
      Alert.alert(t("common.error"), pErr.message);
      setLoading(false);
      return;
    }

    const playRows = (plays ?? []) as PlayRow[];
    const playIds = playRows.map((p) => p.id);

    const { data: events, error: eErr } = await supabase
      .from("play_event")
      .select("id, play_id, event_type, value, player_id, created_at")
      .in("play_id", playIds)
      .order("created_at", { ascending: true });

    if (eErr) {
      Alert.alert(t("common.error"), eErr.message);
      setLoading(false);
      return;
    }

    const eventRows = (events ?? []) as PlayEventRow[];

    // Round lineups (public)
    const { data: rlData } = await supabase
      .from("round_lineup")
      .select("id,round_id,team_id,player_id,role,order_in_role,created_at")
      .in("round_id", roundIds)
      .order("created_at", { ascending: true });

    const roundLineups = (rlData ?? []) as RoundLineupRow[];

    // Captain overrides (public)
    const { data: capData } = await supabase
      .from("match_captain_override")
      .select("team_id,player_id")
      .eq("match_id", matchId);

    const captainOverrides = (capData ?? []) as CaptainOverrideRow[];
    const captainByTeam = new Map<number, number>();
    for (const co of captainOverrides) captainByTeam.set(co.team_id, co.player_id);

// Default captains from team_player (public)
const defaultCaptainByTeam = new Map<number, number>();
try {
  const champId = matchData.championship_id ?? null;
  const aTeamId0 = matchData.team_a_id ?? null;
  const bTeamId0 = matchData.team_b_id ?? null;
  if (champId && (aTeamId0 || bTeamId0)) {
    const teamIds = [aTeamId0, bTeamId0].filter(Boolean) as number[];
    const { data: tpData } = await supabase
      .from("team_player")
      .select("team_id,player_id,is_captain")
      .eq("championship_id", champId)
      .in("team_id", teamIds)
      .eq("is_captain", true);

    for (const row of (tpData ?? []) as any[]) {
      if (row?.team_id && row?.player_id) defaultCaptainByTeam.set(row.team_id, row.player_id);
    }
  }
} catch {
  // If RLS blocks it, we just won't show default captain marks.
}

function captainForTeam(teamId: number) {
  return captainByTeam.get(teamId) ?? defaultCaptainByTeam.get(teamId) ?? null;
}


    // NOT PRESENTED (incompareixença)
    const npEvent = eventRows.find((ev) => ev.event_type === "NOT_PRESENTED");
    if (npEvent) {
      const aName = matchData.team_a?.name ?? t("publicMatches.teamA");
      const bName = matchData.team_b?.name ?? t("publicMatches.teamB");
      const sa = matchData.score_team_a ?? 0;
      const sb = matchData.score_team_b ?? 0;

      let awarded = aName;
      let absent = bName;
      if (sb > sa) {
        awarded = bName;
        absent = aName;
      } else if (sa > sb) {
        awarded = aName;
        absent = bName;
      }

      const pts = typeof npEvent.value === "number" ? npEvent.value : parseInt(String(npEvent.value ?? 5), 10) || 5;
      setNotPresentedInfo({ absent, awarded, points: pts });
    } else {
      setNotPresentedInfo(null);
    }

    // BELIT D'OR (per resum)
    setHasBelitDor(eventRows.some((e) => e.event_type === "BELIT_DOR"));

    // Player names
    const playerIds = new Set<number>();
    for (const p of playRows) {
      if (p.attacker_player_id) playerIds.add(p.attacker_player_id);
      if (p.eliminated_by_player_id) playerIds.add(p.eliminated_by_player_id);
    }
    for (const ev of eventRows) {
      if (ev.player_id) playerIds.add(ev.player_id);
    }
    for (const rl of roundLineups) {
      if (rl.player_id) playerIds.add(rl.player_id);
    }
    for (const co of captainOverrides) {
      if (co.player_id) playerIds.add(co.player_id);
    }

    let pMap: PlayerMap = {};
    if (playerIds.size > 0) {
      const idsArr = Array.from(playerIds);
      const { data: playersData, error: playersErr } = await supabase
        .from("player")
        .select("id, name")
        .in("id", idsArr);

      if (playersErr) {
        Alert.alert(t("common.error"), playersErr.message);
        setLoading(false);
        return;
      }

      for (const pl of playersData ?? []) {
        pMap[pl.id] = pl.name;
      }
    }

    // Team map (for labels)
    const teamIds = new Set<number>();
    if (matchData.team_a_id) teamIds.add(matchData.team_a_id);
    if (matchData.team_b_id) teamIds.add(matchData.team_b_id);
    for (const r of roundRows) {
      if (r.attacking_team_id) teamIds.add(r.attacking_team_id);
      if (r.defending_team_id) teamIds.add(r.defending_team_id);
    }

    let teamMap: TeamMap = {};
    if (teamIds.size > 0) {
      const idsArr = Array.from(teamIds);
      const { data: teamsData, error: teamsErr } = await supabase
        .from("team")
        .select("id, name, short_name")
        .in("id", idsArr);

      if (teamsErr) {
        Alert.alert(t("common.error"), teamsErr.message);
        setLoading(false);
        return;
      }

      for (const t of teamsData ?? []) {
        teamMap[t.id] = { name: t.name, short_name: trimCharField(t.short_name) };
      }
    }

    const mrNumberById = new Map<number, number>();
    for (const mr of (matchRounds ?? []) as MatchRoundRow[]) {
      mrNumberById.set(mr.id, mr.number);
    }

    const roundById = new Map<number, RoundRow>();
    for (const r of roundRows) roundById.set(r.id, r);

    const eventsByPlayId = new Map<number, PlayEventRow[]>();
    for (const ev of eventRows) {
      const pid = ev.play_id;
      if (!pid) continue;
      if (!eventsByPlayId.has(pid)) eventsByPlayId.set(pid, []);
      eventsByPlayId.get(pid)!.push(ev);
    }

    // ✅ No volem mostrar la "jugada" del bélit d'or al resum (ja es mostra a baix de tot)
    const belitDorPlayIds = new Set<number>();
    for (const ev of eventRows) {
      if (ev.event_type === "BELIT_DOR" && ev.play_id) belitDorPlayIds.add(ev.play_id);
    }

    function playerName(pid?: number | null) {
      if (!pid) return "—";
      return pMap[pid] ?? `#${pid}`;
    }

    function eventTypeLabel(et?: string | null) {
  const type = (et ?? "").toUpperCase();
  if (type === "CANAS_SCORED") return t("matchSummary.canes");
  if (type === "TEAM_BONUS_CANAS") return t("matchSummary.bonusTeam");
  if (type === "DEFENDER_BONUS_CANAS") return t("matchSummary.bonusDefense");
  if (type === "AIR_CATCH") return t("matchSummary.aircatch");
  if (type === "MATACANAS") return t("matchSummary.killed");
  if (!type) return "—";
  return type;
}

    // Build PDF event rows (acta): one row per play_event
    const playByIdForPdf = new Map<number, PlayRow>();
    for (const p of playRows) playByIdForPdf.set(p.id, p);

    function infoForPlayForPdf(playId: number | null) {
      if (!playId) {
        return {
          atk: null as number | null,
          def: null as number | null,
          mrNumber: 0,
          turn: 0,
        };
      }
      const pl = playByIdForPdf.get(playId);
      if (!pl?.round_id) {
        return {
          atk: null as number | null,
          def: null as number | null,
          mrNumber: 0,
          turn: 0,
        };
      }
      const rr = roundById.get(pl.round_id);
      const mrNumber = rr?.match_round_id ? mrNumberById.get(rr.match_round_id) ?? 0 : 0;
      const turn = rr?.turn ?? 0;
      return { atk: rr?.attacking_team_id ?? null, def: rr?.defending_team_id ?? null, mrNumber, turn };
    }

    const pdfRows: PdfEventRow[] = [];
    for (const ev of eventRows) {
      const et = (ev.event_type ?? "").toUpperCase();
      if (et === "BELIT_DOR" || et === "NOT_PRESENTED") continue;

      const when = ev.created_at ? formatDateDDMMYYYY_HHMM(ev.created_at) : "";
      const info = infoForPlayForPdf(ev.play_id ?? null);
      const atkId = info.atk;
      const defId = info.def;

      const attackTeam = atkId ? teamLabel(teamMap, atkId) : "—";
      const defenseTeam = defId ? teamLabel(teamMap, defId) : "—";

      // Equip/ jugador segons tipus:
      // - AIR_CATCH / MATACANAS: volem mostrar DEFENSOR
      // - Altres: per defecte mostrem ATACANT
      let team = attackTeam;

      // Prefer explicit event player_id; fallback to attacker
const attackerPid = ev.play_id ? playByIdForPdf.get(ev.play_id)?.attacker_player_id ?? null : null;
const eliminatedByPid = ev.play_id ? playByIdForPdf.get(ev.play_id)?.eliminated_by_player_id ?? null : null;

const attackerName = playerName(attackerPid);
const defenderName = playerName(ev.player_id ?? eliminatedByPid);

let player = playerName(ev.player_id ?? attackerPid);

if (et === "AIR_CATCH" || et === "MATACANAS") {
  team = defenseTeam;

  if (attackerName !== "—" && defenderName !== "—") {
    player =
      et === "AIR_CATCH"
        ? `${attackerName} escapsat per ${defenderName}`
        : `${attackerName} matacanat per ${defenderName}`;
  } else if (attackerName !== "—") {
    player =
      et === "AIR_CATCH"
        ? `${attackerName} escapsat`
        : `${attackerName} matacanat`;
  } else {
    player = defenderName;
  }
}

      const type = eventTypeLabel(ev.event_type);
      const value = typeof ev.value === "number" ? String(ev.value) : ev.value != null ? String(ev.value) : "";

      // si no podem inferir ronda/torn, igualment el posem al final
      pdfRows.push({
        mrNumber: info.mrNumber || 999,
        turn: info.turn || 999,
        when,
        team,
        player,
        type,
        value,
        attackTeam,
        defenseTeam,
      });
    }
    // Orden estable per ronda/torn i temps
    pdfRows.sort((a, b) => {
      if (a.mrNumber !== b.mrNumber) return a.mrNumber - b.mrNumber;
      if (a.turn !== b.turn) return a.turn - b.turn;
      return (a.when || "").localeCompare(b.when || "");
    });
    setPdfEventRows(pdfRows);

    // Group plays by (match_round.number, turn)
    type TurnKey = string; // `${mrNumber}|${turn}`
    const turnGroups = new Map<
      TurnKey,
      {
        mrNumber: number;
        turn: number;
        attackingTeamId: number | null;
        defendingTeamId: number | null;
        plays: PlayRow[];
        attackerPoints: number;
        defenderPoints: number;
      }
    >();

    function pointsForPlay(playId: number) {
      const evs = eventsByPlayId.get(playId) ?? [];
      let attacker = 0;
      let defender = 0;
      for (const ev of evs) {
        const t = ev.event_type ?? "";
        const v = typeof ev.value === "number" ? ev.value : 0;
        if (t === "CANAS_SCORED") attacker += v;
        else if (t === "TEAM_BONUS_CANAS") attacker += v; // metre guanyat (atacant)
        else if (t === "DEFENDER_BONUS_CANAS") defender += v; // metre perdut (defensor)
      }
      return { attacker, defender };
    }

    for (const pl of playRows) {
      if (belitDorPlayIds.has(pl.id)) continue;
      if (!pl.round_id) continue;
      const r = roundById.get(pl.round_id);
      if (!r) continue;

      const mrN = r.match_round_id ? mrNumberById.get(r.match_round_id) : undefined;
      const turn = r.turn ?? undefined;
      if (typeof mrN !== "number" || typeof turn !== "number") continue;

      const key = `${mrN}|${turn}`;
      if (!turnGroups.has(key)) {
        turnGroups.set(key, {
          mrNumber: mrN,
          turn,
          attackingTeamId: r.attacking_team_id ?? null,
          defendingTeamId: r.defending_team_id ?? null,
          plays: [],
          attackerPoints: 0,
          defenderPoints: 0,
        });
      }

      const g = turnGroups.get(key)!;
      g.plays.push(pl);

      const pts = pointsForPlay(pl.id);
      g.attackerPoints += pts.attacker;
      g.defenderPoints += pts.defender;
    }

    const sortedTurns = Array.from(turnGroups.values()).sort((a, b) => {
      if (a.mrNumber !== b.mrNumber) return a.mrNumber - b.mrNumber;
      return a.turn - b.turn;
    });

    // Build timeline: turn header -> plays -> turn end (winner + score)
    let cumA = 0;
    let cumB = 0;

    const out: TimelineItem[] = [];

    for (const turnGroup of sortedTurns) {
      const atkLabel = teamLabel(teamMap, turnGroup.attackingTeamId);
      const defLabel = teamLabel(teamMap, turnGroup.defendingTeamId);

      out.push({
        key: `h-${turnGroup.mrNumber}-${turnGroup.turn}`,
        kind: "turn_header",
        text: `${t("matchSummary.round")} ${turnGroup.mrNumber} · ${t("matchSummary.turn")} ${turnGroup.turn} — ${t("matchSummary.attack")}: ${atkLabel}`,
      });

      const playsSorted = [...turnGroup.plays].sort((a, b) => a.id - b.id);

      function playText(pl: PlayRow) {
        const attacker = playerName(pl.attacker_player_id);
        const byDefault = pl.eliminated_by_player_id ? playerName(pl.eliminated_by_player_id) : null;

        const evs = eventsByPlayId.get(pl.id) ?? [];
        const parts: string[] = [];

        for (const ev of evs) {
          const et = ev.event_type ?? "";
          if (et === "CANAS_SCORED") {
            const v = typeof ev.value === "number" ? ev.value : 0;
            parts.push(`${attacker} ${t("matchSummary.done").toLowerCase()} ${v} ${t("matchSummary.canes").toLowerCase()}`);
            continue;
          }
          if (et === "AIR_CATCH") {
            const byName = byDefault ?? (ev.player_id ? playerName(ev.player_id) : null);
            parts.push(byName ? `${attacker} ${t("matchSummary.aircatchby").toLowerCase()} ${byName}` : `${attacker} ${t("matchSummary.aircatchby").toLowerCase()}`);
            continue;
          }
          if (et === "MATACANAS") {
            const byName = byDefault ?? (ev.player_id ? playerName(ev.player_id) : null);
            parts.push(byName ? `${attacker} ${t("matchSummary.killedby").toLowerCase()} ${byName}` : `${attacker} ${t("matchSummary.killedby").toLowerCase()}`);
            continue;
          }
          if (et === "TEAM_BONUS_CANAS") {
            const v = typeof ev.value === "number" ? ev.value : 0;
            parts.push(`${t("matchSummary.metersWon")}: +${v} (${atkLabel})`);
            continue;
          }
          if (et === "DEFENDER_BONUS_CANAS") {
            const v = typeof ev.value === "number" ? ev.value : 0;
            parts.push(`${t("matchSummary.metersLost")}: +${v} (${defLabel})`);
            continue;
          }

          if (et) {
            const who = ev.player_id ? playerName(ev.player_id) : attacker;
            const v = typeof ev.value === "number" ? ` (${ev.value})` : "";
            parts.push(`${who}: ${et}${v}`);
            }
          }

        if (parts.length === 0) return `${t("matchSummary.plays")} #${pl.id}`;
        return parts.join(" · ");
      }

      function badgeForPlay(pl: PlayRow) {
        const evs = eventsByPlayId.get(pl.id) ?? [];
        const types = new Set<string>(evs.map((e) => (e.event_type ?? "").toUpperCase()).filter(Boolean));

        if (types.has("MATACANAS")) return { label: t("matchSummary.killed"), variant: "red" as const };
        if (types.has("AIR_CATCH")) return { label: t("matchSummary.aircatch"), variant: "blue" as const };

        if (
          types.has("METERS_REQUESTED") ||
          types.has("METERS_ACCEPTED") ||
          types.has("METERS_MEASURED") ||
          types.has("TEAM_BONUS_CANAS") ||
          types.has("DEFENDER_BONUS_CANAS")
        ) {
          return { label: t("matchSummary.meters"), variant: "purple" as const };
        }

        if (types.has("CANAS_SCORED")) return { label: t("matchSummary.canes"), variant: "green" as const };
        return { label: t("matchSummary.plays"), variant: "gray" as const };
      }

      playsSorted.forEach((pl, idx) => {
        out.push({
          key: `p-${pl.id}`,
          kind: "play",
          badge: badgeForPlay(pl),
          text: `${idx + 1}. ${playText(pl)}`,
        });
      });

      const aId = matchData.team_a_id;
      const bId = matchData.team_b_id;

      if (turnGroup.attackingTeamId && aId && turnGroup.attackingTeamId === aId) cumA += turnGroup.attackerPoints;
      else if (turnGroup.attackingTeamId && bId && turnGroup.attackingTeamId === bId) cumB += turnGroup.attackerPoints;

      if (turnGroup.defendingTeamId && aId && turnGroup.defendingTeamId === aId) cumA += turnGroup.defenderPoints;
      else if (turnGroup.defendingTeamId && bId && turnGroup.defendingTeamId === bId) cumB += turnGroup.defenderPoints;

      let winner = "";
      const aLabel = teamLabel(teamMap, matchData.team_a_id);
      const bLabel = teamLabel(teamMap, matchData.team_b_id);
      if (cumA > cumB) winner = `${t("matchSummary.winner")} ${aLabel}`;
      else if (cumB > cumA) winner = `${t("matchSummary.winner")} ${bLabel}`;
      else winner = `${t("matchSummary.draw")}`;

      out.push({
        key: `e-${turnGroup.mrNumber}-${turnGroup.turn}`,
        kind: "turn_end",
        text: `${t("matchSummary.changeTurn")} — ${winner} · ${t("matchSummary.score")}: ${cumA} - ${cumB}`,
      });
    }

    // ✅ Keep provisional score in sync while the match is in progress.
    // Match table scores are only final, so during live we show computed totals.
    if (!matchData.is_finished) {
      setLiveScore({ a: cumA, b: cumB });
    } else {
      setLiveScore(null);
    }

    // Build lineups tab items
    
const lineupOut: LineupListItem[] = [];
lineupOut.push({ key: "lh", kind: "lineup_header", text: t("matchSummary.lineupsByRound") });

// Group lineups by round_id
const rlByRound = new Map<number, RoundLineupRow[]>();
for (const rl of roundLineups) {
  if (!rl.round_id) continue;
  if (!rlByRound.has(rl.round_id)) rlByRound.set(rl.round_id, []);
  rlByRound.get(rl.round_id)!.push(rl);
}

// Map match_round id -> number (Ronda)
const matchRoundNumberById = new Map<number, number>();
for (const mr of matchRoundRows) matchRoundNumberById.set(mr.id, mr.number);

// Sort rounds by (match_round.number, turn)
const roundsSorted = [...roundRows].sort((a, b) => {
  const aMr = a.match_round_id ? (matchRoundNumberById.get(a.match_round_id) ?? 9999) : 9999;
  const bMr = b.match_round_id ? (matchRoundNumberById.get(b.match_round_id) ?? 9999) : 9999;
  if (aMr !== bMr) return aMr - bMr;
  const at = a.turn ?? 9999;
  const bt = b.turn ?? 9999;
  return at - bt;
});

for (const r of roundsSorted) {
  const rows = rlByRound.get(r.id) ?? [];

  const atkTeamId = r.attacking_team_id ?? null;
  const defTeamId = r.defending_team_id ?? null;

  const atkCap = atkTeamId ? captainForTeam(atkTeamId) : null;
  const defCap = defTeamId ? captainForTeam(defTeamId) : null;

  const atkPlayers = rows
    .filter((x) => (x.role ?? "").toLowerCase() === "attack")
    .map((x) => ({
      id: x.player_id,
      name: playerName(x.player_id),
      order: x.order_in_role ?? null,
      isCaptain: atkCap === x.player_id,
    }))
    .sort(sortByOrderNullLast);

  const defPlayers = rows
    .filter((x) => (x.role ?? "").toLowerCase() === "defense")
    .map((x) => ({
      id: x.player_id,
      name: playerName(x.player_id),
      order: x.order_in_role ?? null,
      isCaptain: defCap === x.player_id,
    }))
    .sort(sortByOrderNullLast);

  lineupOut.push({
    key: `lr-${r.id}`,
    kind: "lineup_round",
    roundNumber: r.match_round_id ? (matchRoundNumberById.get(r.match_round_id) ?? null) : null,
    turn: r.turn ?? null,
    attackTeamLabel: atkTeamId ? teamLabel(teamMap, atkTeamId) : t("matchSummary.attack"),
    defenseTeamLabel: defTeamId ? teamLabel(teamMap, defTeamId) : t("matchSummary.defense"),
    playersAttack: atkPlayers,
    playersDefense: defPlayers,
  });
}

// Build stats tab items
    const statsOut: StatListItem[] = [];
    statsOut.push({ key: "sh", kind: "stat_header", text: t("matchSummary.statsTitle") });

    // Build helper maps: play -> round -> teams
    const playById = new Map<number, PlayRow>();
    for (const p of playRows) playById.set(p.id, p);

    function teamsForPlay(playId: number) {
      const p = playById.get(playId);
      if (!p?.round_id) return { atk: null as number | null, def: null as number | null };
      const r = roundById.get(p.round_id);
      return { atk: r?.attacking_team_id ?? null, def: r?.defending_team_id ?? null };
    }

    const totals = {
      canesA: 0,
      canesB: 0,
      matA: 0,
      matB: 0,
      airA: 0,
      airB: 0,
      metresGainA: 0,
      metresGainB: 0,
      metresLostA: 0,
      metresLostB: 0,
    };

    const topCanes = new Map<number, number>();
    const topMat = new Map<number, number>();
    const topAir = new Map<number, number>();

    // Team ids for A/B (used to split stats by side)
    const aTeamId = matchData.team_a_id ?? null;
    const bTeamId = matchData.team_b_id ?? null;

    function addTop(map: Map<number, number>, pid: number | null | undefined, inc: number) {
      if (!pid) return;
      map.set(pid, (map.get(pid) ?? 0) + inc);
    }

    for (const ev of eventRows) {
      const pid = ev.play_id;
      if (!pid) continue;
      const { atk, def } = teamsForPlay(pid);
      const et = (ev.event_type ?? "").toUpperCase();
      const v = typeof ev.value === "number" ? ev.value : 0;

      // identify A/B
      const isAtkA = atk != null && aTeamId != null && atk === aTeamId;
      const isAtkB = atk != null && bTeamId != null && atk === bTeamId;
      const isDefA = def != null && aTeamId != null && def === aTeamId;
      const isDefB = def != null && bTeamId != null && def === bTeamId;

      if (et === "CANAS_SCORED") {
        if (isAtkA) totals.canesA += v;
        if (isAtkB) totals.canesB += v;
        // player_id is attacker who scored
        addTop(topCanes, ev.player_id, v);
      } else if (et === "TEAM_BONUS_CANAS") {
        if (isAtkA) totals.metresGainA += v;
        if (isAtkB) totals.metresGainB += v;
      } else if (et === "DEFENDER_BONUS_CANAS") {
        if (isDefA) totals.metresLostA += v;
        if (isDefB) totals.metresLostB += v;
      } else if (et === "MATACANAS") {
        if (isDefA) totals.matA += 1;
        if (isDefB) totals.matB += 1;
        // player_id is defender who matacanat (fallback to eliminated_by_player_id)
        const p = playById.get(pid);
        addTop(topMat, ev.player_id ?? p?.eliminated_by_player_id ?? null, 1);
      } else if (et === "AIR_CATCH") {
        if (isDefA) totals.airA += 1;
        if (isDefB) totals.airB += 1;
        const p = playById.get(pid);
        addTop(topAir, ev.player_id ?? p?.eliminated_by_player_id ?? null, 1);
      }
    }

    statsOut.push({ key: "sr1", kind: "stat_row", label: t("matchSummary.canes"), a: totals.canesA, b: totals.canesB });
    statsOut.push({ key: "sr2", kind: "stat_row", label: t("matchSummary.killed"), a: totals.matA, b: totals.matB });
    statsOut.push({ key: "sr3", kind: "stat_row", label: t("matchSummary.aircatch"), a: totals.airA, b: totals.airB });
    statsOut.push({ key: "sr4", kind: "stat_row", label: t("matchSummary.metersWon"), a: totals.metresGainA, b: totals.metresGainB });
    statsOut.push({ key: "sr5", kind: "stat_row", label: t("matchSummary.metersLost"), a: totals.metresLostA, b: totals.metresLostB });

    function mapToTopRows(map: Map<number, number>, max = 3) {
      return Array.from(map.entries())
        .sort((x, y) => y[1] - x[1])
        .slice(0, max)
        .map(([pid, val]) => ({ label: playerName(pid), value: val }));
    }

    const topCanesRows = mapToTopRows(topCanes, 3);
    const topMatRows = mapToTopRows(topMat, 3);
    const topAirRows = mapToTopRows(topAir, 3);

    if (topCanesRows.length) statsOut.push({ key: "stc", kind: "stat_top",title: t("matchSummary.topCanadors"), rows: topCanesRows });
    if (topMatRows.length) statsOut.push({ key: "stm", kind: "stat_top", title: t("matchSummary.topMatacanes"), rows: topMatRows });
    if (topAirRows.length) statsOut.push({ key: "sta", kind: "stat_top", title: t("matchSummary.topEscapsadas"), rows: topAirRows });

    // Apply
    if (npEvent) {
      setItems([]);
    } else {
      setItems(out);
    }

    setLineupItems(lineupOut);
    setStatItems(statsOut);

    setLoading(false);
  }

  const listData: ListItem[] = useMemo(() => {
    if (tab === "lineups") return lineupItems;
    if (tab === "stats") return statItems;
    return notPresentedInfo ? [] : items;
  }, [tab, lineupItems, statItems, items, notPresentedInfo]);


  const exportActaPdf = useCallback(async () => {
    if (!match) return;

    try {
      setExportingPdf(true);

      const canShare = await Sharing.isAvailableAsync();
      if (!canShare) {
        Alert.alert(t("matchSummary.notAvailable"), t("matchSummary.shareNotAvailable"));
        return;
      }

      const phaseName = match.phase?.name ?? "—";
      const datePrevText = formatDateDDMMYYYY_HHMM(match.match_date);
      const dateRealText = match.started_at
        ? `${formatDateDDMMYYYY_HHMM(match.started_at)}${match.finished_at ? ` → ${formatDateDDMMYYYY_HHMM(match.finished_at)}` : ""}`
        : "—";
      const fieldCode = trimCharField(match.slot?.field_code) || "—";
      const referee = refereeName ?? "—";
      const teamA = match.team_a?.short_name || trimCharField(match.team_a?.name) || t("publicMatches.teamA");
      const teamB = match.team_b?.short_name || trimCharField(match.team_b?.name) || t("publicMatches.teamB");

      const status = match.is_finished
  ? t("matchSummary.statusFinished")
  : match.started_at
  ? t("matchSummary.statusLive")
  : t("matchSummary.statusPending");

      const finalA = match.score_team_a ?? 0;
      const finalB = match.score_team_b ?? 0;
      const showLive = !!match && !match.is_finished && liveScore != null;
      const localScoreA = showLive ? liveScore!.a : finalA;
      const localScoreB = showLive ? liveScore!.b : finalB;

      const title = headerTeams;

      const html = buildActaHtml({
        title,
        phaseName,
        datePrevText,
        dateRealText,
        fieldCode,
        referee,
        scoreA: localScoreA,
        scoreB: localScoreB,
        teamA,
        teamB,
        status,
        eventRows: notPresentedInfo
          ? [
              {
                mrNumber: 1,
                turn: 1,
                when: datePrevText,
                team: "—",
                player: "—",  
                type: t("matchSummary.notPresented"),
                value: `${notPresentedInfo.absent} (+${notPresentedInfo.points} ${notPresentedInfo.awarded})`,
                attackTeam: "—",
                defenseTeam: "—",
              },
            ]
          : pdfEventRows,
      });

      const { uri } = await Print.printToFileAsync({ html });

      await Sharing.shareAsync(uri, {
        mimeType: "application/pdf",
        UTI: "com.adobe.pdf",
        dialogTitle: t("matchSummary.sharePdf"),
      });
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("matchSummary.pdfError"));
    } finally {
      setExportingPdf(false);
    }
  }, [match, refereeName, notPresentedInfo, headerTeams, liveScore, pdfEventRows,t]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>{t("matchSummary.loading")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  const finalA = match?.score_team_a ?? 0;
  const finalB = match?.score_team_b ?? 0;
  const showLive = !!match && !match.is_finished && liveScore != null;
  const scoreA = showLive ? liveScore!.a : finalA;
  const scoreB = showLive ? liveScore!.b : finalB;

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={styles.screen}>
      <FlatList
        data={listData}
        keyExtractor={(it) => it.key}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={styles.topBar}>
              <BackButton onPress={() => router.back()} style={{ marginTop:5 }} />
        <RefreshButton
          onPress={() => load()}
          style={{ alignSelf: "flex-end",marginTop:5 }}
        />
            </View>

            <View style={styles.card}>
              <Text style={styles.teamsTitle} numberOfLines={2}>
                {headerTeams}
              </Text>

              <Text style={styles.dateText}>{formatDateDDMMYYYY_HHMM(match?.match_date)}</Text>

              {refereeName && <Text style={styles.refereeText}>{t("matchSummary.referee")}: {refereeName}</Text>}

              {!!match?.phase?.name && (
                <Text style={styles.phaseText} numberOfLines={1}>
                  {match.phase.name}
                </Text>
              )}

              <View style={styles.scoreRow}>
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreValue}>{scoreA}</Text>
                  <Text style={styles.scoreLabel} numberOfLines={1}>
                    {match?.team_a?.short_name || trimCharField(match?.team_a?.name) || t("publicMatches.teamA")}
                  </Text>
                </View>

                <Text style={styles.scoreDash}>—</Text>

                <View style={styles.scoreBox}>
                  <Text style={styles.scoreValue}>{scoreB}</Text>
                  <Text style={styles.scoreLabel} numberOfLines={1}>
                    {match?.team_b?.short_name || trimCharField(match?.team_b?.name) || t("publicMatches.teamB")}
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                {match?.finished_at ? (
                  <View style={[styles.metaPill, styles.metaPillFinished]}>
                    <Text style={styles.metaPillLabel}>{t("matchSummary.statusFinished")}</Text>
                    <Text style={styles.metaPillValue}>{formatDateDDMMYYYY_HHMM(match.finished_at)}</Text>
                  </View>
                ) : (
                  <View style={[styles.metaPill, styles.metaPillPending]}>
                    <Text style={styles.metaPillLabel}>{t("matchSummary.statusLabel")}</Text>
                    <Text style={styles.metaPillValue}>{t("matchSummary.statusLive")}</Text>
                  </View>
                )}

                {notPresentedInfo ? (
                  <View style={{ width: "100%", alignItems: "center" }}>
                    <View style={styles.badgeWarn}>
                      <Text style={styles.badgeWarnText}>⚠️ {t("matchSummary.notPresented")}</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              {/*<Pressable
                onPress={exportActaPdf}
                disabled={exportingPdf}
                style={({ pressed }) => [
                  styles.pdfButton,
                  pressed && !exportingPdf ? { opacity: 0.9 } : null,
                  exportingPdf ? { opacity: 0.6 } : null,
                ]}
              >
                <Text style={styles.pdfButtonText}>
                  {exportingPdf ? t("matchSummary.generatingPdf") : t("matchSummary.exportPdf")}
                </Text>
              </Pressable>*/}

              {notPresentedInfo && match?.finished_at ? (
                <View style={styles.notPresentedCard}>
                  <Text style={styles.notPresentedText}>
                    {notPresentedInfo.absent} {t("matchSummary.notPresentedShort")}: +{notPresentedInfo.points} {notPresentedInfo.awarded}
                  </Text>
                </View>
              ) : null}
            </View>

            {!notPresentedInfo && (
              <View style={styles.tabsRow}>
                <Pressable
                  onPress={() => setTab("summary")}
                  style={({ pressed }) => [
                    styles.tabPill,
                    tab === "summary" ? styles.tabPillActive : styles.tabPillIdle,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.tabText, tab === "summary" ? styles.tabTextActive : styles.tabTextIdle]}>{t("matchSummary.summary")}</Text>
                </Pressable>

                <Pressable
                  onPress={() => setTab("lineups")}
                  style={({ pressed }) => [
                    styles.tabPill,
                    tab === "lineups" ? styles.tabPillActive : styles.tabPillIdle,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.tabText, tab === "lineups" ? styles.tabTextActive : styles.tabTextIdle]}>{t("matchSummary.lineups")}</Text>
                </Pressable>

                <Pressable
                  onPress={() => setTab("stats")}
                  style={({ pressed }) => [
                    styles.tabPill,
                    tab === "stats" ? styles.tabPillActive : styles.tabPillIdle,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.tabText, tab === "stats" ? styles.tabTextActive : styles.tabTextIdle]}>{t("matchSummary.stats")}</Text>
                </Pressable>
              </View>
            )}

            {!notPresentedInfo && tab === "summary" && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t("matchSummary.detailPlays")}</Text>
                <Text style={styles.sectionSub}>{t("matchSummary.timeline")}</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={() => (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {notPresentedInfo
  ? t("matchSummary.emptyNotPlayed")
  : tab === "summary"
  ? t("matchSummary.emptySummary")
  : tab === "lineups"
  ? t("matchSummary.emptyLineups")
  : t("matchSummary.emptyStats")}
            </Text>
          </View>
        )}
        ListFooterComponent={() =>
          !notPresentedInfo && hasBelitDor && belitDorWinnerName ? (
            <View style={styles.belitDorFooter}>
              <Text style={styles.belitDorFooterText}>🏆 {t("matchSummary.belitDor", { name: belitDorWinnerName })}</Text>
            </View>
          ) : (
            <View style={{ height: 8 }} />
          )
        }
        renderItem={({ item }) => {
          // Timeline
          if (item.kind === "turn_header") {
            return (
              <View style={styles.turnHeader}>
                <Text style={styles.turnHeaderText}>{item.text}</Text>
              </View>
            );
          }

          if (item.kind === "turn_end") {
            return (
              <View style={styles.turnEnd}>
                <Text style={styles.turnEndText}>{item.text}</Text>
              </View>
            );
          }

          if (item.kind === "play") {
            return (
              <View style={styles.playRow}>
                <View
                  style={[
                    styles.badge,
                    item.badge?.variant === "green" && styles.badgeGreen,
                    item.badge?.variant === "red" && styles.badgeRed,
                    item.badge?.variant === "blue" && styles.badgeBlue,
                    item.badge?.variant === "purple" && styles.badgePurple,
                    item.badge?.variant === "gray" && styles.badgeGray,
                  ]}
                >
                  <Text style={styles.badgeText}>{item.badge?.label ?? t("matchSummary.plays")}</Text>
                </View>

                <View style={styles.playTextWrap}>
                  <Text style={styles.playText}>{item.text}</Text>
                </View>
              </View>
            );
          }

          // Lineups
          if (item.kind === "lineup_header") {
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{item.text}</Text>
                <Text style={styles.sectionSub}>{t("matchSummary.matchLineups")}</Text>
              </View>
            );
          }

          
if (item.kind === "lineup_round") {
  return (
    <View style={styles.card}>
      <Text style={styles.lineupTeamTitle}>
        {item.roundNumber != null && item.turn != null
          ? `${t("matchSummary.round")} ${item.roundNumber} · ${t("matchSummary.turn")} ${item.turn}`
          : item.roundNumber != null
          ? `${t("matchSummary.round")} ${item.roundNumber}`
          : item.turn != null
          ? `${t("matchSummary.turn")} ${item.turn}`
          : t("matchSummary.lineup")}
      </Text>

      <View style={{ marginTop: 10 }}>
        <Text style={styles.lineupRoleTitle}>{`${t("matchSummary.attack")} · ${item.attackTeamLabel}`}</Text>
        {item.playersAttack.length === 0 ? (
          <Text style={styles.lineupEmpty}>—</Text>
        ) : (
          <View style={{ gap: 6, marginTop: 6 }}>
            {item.playersAttack.map((p) => (
              <View key={`atk-${item.key}-${p.id}`} style={styles.lineupRow}>
                <Text style={styles.lineupPlayer}>
                  {p.order != null ? `${p.order}. ` : ""}
                  {p.name}
                  {p.isCaptain ? " (C)" : ""}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={{ marginTop: 14 }}>
        <Text style={styles.lineupRoleTitle}>{`${t("matchSummary.defense")} · ${item.defenseTeamLabel}`}</Text>
        {item.playersDefense.length === 0 ? (
          <Text style={styles.lineupEmpty}>—</Text>
        ) : (
          <View style={{ gap: 6, marginTop: 6 }}>
            {item.playersDefense.map((p) => (
              <View key={`def-${item.key}-${p.id}`} style={styles.lineupRow}>
                <Text style={styles.lineupPlayer}>
                  {p.order != null ? `${p.order}. ` : ""}
                  {p.name}
                  {p.isCaptain ? " (C)" : ""}
                </Text>
              </View>
            ))}
          </View>
        )}
      </View>
    </View>
  );
}

if (item.kind === "lineup_team") {
            return (
              <View style={styles.card}>
                <Text style={styles.lineupTeamTitle}>{item.teamLabel}</Text>

                <View style={{ marginTop: 10 }}>
                  <Text style={styles.lineupRoleTitle}>{t("matchSummary.attack")}</Text>
                  {item.playersAttack.length === 0 ? (
                    <Text style={styles.lineupEmpty}>—</Text>
                  ) : (
                    item.playersAttack.map((p) => (
                      <View key={`a-${p.id}`} style={styles.lineupRow}>
                        <Text style={styles.lineupName} numberOfLines={1}>
                          {p.order ? `${p.order}. ` : ""}
                          {p.name}
                        </Text>
                        {p.isCaptain ? (
                          <View style={[styles.badge, styles.badgeGray]}>
                            <Text style={styles.badgeText}>C</Text>
                          </View>
                        ) : null}
                      </View>
                    ))
                  )}
                </View>

                <View style={{ marginTop: 12 }}>
                  <Text style={styles.lineupRoleTitle}>{t("matchSummary.defense")}</Text>
                  {item.playersDefense.length === 0 ? (
                    <Text style={styles.lineupEmpty}>—</Text>
                  ) : (
                    item.playersDefense.map((p) => (
                      <View key={`d-${p.id}`} style={styles.lineupRow}>
                        <Text style={styles.lineupName} numberOfLines={1}>
                          {p.name}
                        </Text>
                        {p.isCaptain ? (
                          <View style={[styles.badge, styles.badgeGray]}>
                            <Text style={styles.badgeText}>C</Text>
                          </View>
                        ) : null}
                      </View>
                    ))
                  )}
                </View>
              </View>
            );
          }

          // Stats
          if (item.kind === "stat_header") {
            return (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{item.text}</Text>
                <Text style={styles.sectionSub}>{t("matchSummary.statsSubtitle")}</Text>
              </View>
            );
          }

          if (item.kind === "stat_row") {
            return (
              <View style={styles.statRowCard}>
                <Text style={styles.statLabel}>{item.label}</Text>
                <View style={styles.statValues}>
                  <View style={styles.statValueBox}>
                    <Text style={styles.statValue}>{item.a}</Text>
                    <Text style={styles.statMiniLabel} numberOfLines={1}>
                      {match?.team_a?.short_name || trimCharField(match?.team_a?.name) || "A"}
                    </Text>
                  </View>
                  <Text style={styles.statDash}>—</Text>
                  <View style={styles.statValueBox}>
                    <Text style={styles.statValue}>{item.b}</Text>
                    <Text style={styles.statMiniLabel} numberOfLines={1}>
                      {match?.team_b?.short_name || trimCharField(match?.team_b?.name) || "B"}
                    </Text>
                  </View>
                </View>
              </View>
            );
          }

          if (item.kind === "stat_top") {
            return (
              <View style={styles.card}>
                <Text style={styles.topTitle}>{item.title}</Text>
                {item.rows.map((r, idx) => (
                  <View key={`${item.key}-${idx}`} style={styles.topRow}>
                    <Text style={styles.topName} numberOfLines={1}>
                      {idx + 1}. {r.label}
                    </Text>
                    <View style={[styles.badge, styles.badgeGray]}>
                      <Text style={styles.badgeText}>{r.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            );
          }

          return null;
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
    loadingText: {
      marginTop: 10,
      color: colors.muted,
      fontWeight: "700",
    },
    listContent: {
      paddingBottom: 24,
    },

    topBar: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 2,
    },
    refereeText: {
      marginTop: 4,
      fontSize: 13,
      color: colors.muted,
      fontStyle: "italic",
    },
    phaseText: {
      marginTop: 4,
      fontSize: 13,
      color: colors.muted,
      fontWeight: "900",
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.card,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.05,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 6 },
        },
        android: { elevation: 2 },
      }),
    },
    backArrow: { fontSize: 18, fontWeight: "900" },
    backText: { fontSize: 15, fontWeight: "800" },

    card: {
      backgroundColor: colors.card,
      borderRadius: 16,
      paddingTop: 14,
      paddingLeft: 14,
      paddingRight: 14,
      paddingBottom: 8,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 10,
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
    teamsTitle: {
      fontSize: 18,
      fontWeight: "900",
      color: colors.text,
    },
    dateText: {
      marginTop: 6,
      color: colors.muted,
      fontWeight: "700",
    },
    scoreRow: {
      marginTop: 12,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
    },
    scoreBox: {
      alignItems: "center",
      minWidth: 110,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardAlt,
    },
    scoreValue: { fontSize: 30, fontWeight: "900", color: colors.text },
    scoreLabel: { marginTop: 4, color: colors.muted, fontWeight: "800" },
    scoreDash: { fontSize: 22, fontWeight: "900", color: colors.text },

    metaRow: {
      marginTop: 4,
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      flexWrap: "wrap",
    },
    metaPill: {
      flexGrow: 1,
      borderRadius: 14,
      borderWidth: 1,
      paddingVertical: 10,
      paddingHorizontal: 10,
      backgroundColor: colors.cardAlt,
      borderColor: colors.border,
    },
    metaPillFinished: { backgroundColor: isDark ? "rgba(34,197,94,0.15)" : "#F2FFF7", borderColor: isDark ? "rgba(34,197,94,0.35)" : "#D7F5E3" },
    metaPillPending: { backgroundColor: isDark ? "rgba(245,158,11,0.15)" : "#FFF9F2", borderColor: isDark ? "rgba(245,158,11,0.35)" : "#F4E3C9" },
    metaPillLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
    metaPillValue: { marginTop: 2, fontSize: 14, fontWeight: "900", color: colors.text },

    badgeWarn: {
      paddingVertical: 9,
      paddingHorizontal: 12,
      borderRadius: 999,
      backgroundColor: isDark ? "rgba(245,158,11,0.15)" : "#FEF3C7",
      borderWidth: 1,
      borderColor: "#F59E0B",
    },
    badgeWarnText: { fontWeight: "900", color: isDark ? "#fbbf24" : "#92400E" },

    notPresentedCard: {
      marginTop: 12,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: isDark ? "rgba(245,158,11,0.12)" : "#FFF7ED",
      borderWidth: 1,
      borderColor: "#FDBA74",
    },
    notPresentedText: { fontWeight: "900", color: "#7C2D12" },

    tabsRow: {
      flexDirection: "row",
      gap: 10,
      marginTop: 2,
      marginBottom: 4,
    },
    tabPill: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 14,
      borderWidth: 1,
      alignItems: "center",
      backgroundColor: colors.card,
    },
    tabPillActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary,
    },
    tabPillIdle: {
      borderColor: colors.border,
      backgroundColor: colors.card,
    },
    tabText: { fontWeight: "900", fontSize: 13 },
    tabTextActive: { color: colors.primaryText },
    tabTextIdle: { color: colors.text },

    sectionHeader: {
      marginTop: 8,
      marginBottom: 8,
      paddingHorizontal: 2,
    },
    sectionTitle: { fontSize: 16, fontWeight: "900", color: colors.text },
    sectionSub: { marginTop: 2, color: colors.muted, fontWeight: "700" },

    emptyWrap: { marginTop: 26, alignItems: "center" },
    emptyText: { color: colors.muted, textAlign: "center", fontWeight: "700" },

    turnHeader: { marginTop: 10, marginBottom: 4, paddingHorizontal: 2 },
    turnHeaderText: { fontWeight: "900", color: colors.text },

    turnEnd: {
      marginTop: 8,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardAlt,
    },
    turnEndText: { fontWeight: "900", color: colors.text },

    playRow: {
      flexDirection: "row",
      alignItems: "flex-start",
      marginTop: 10,
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.04,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 1 },
      }),
    },
    playTextWrap: { flex: 1, minWidth: 0 },
    playText: { color: colors.text, fontWeight: "700", flexShrink: 1, flexWrap: "wrap", lineHeight: 20 },

    badge: {
      alignSelf: "flex-start",
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 999,
      marginRight: 10,
      borderWidth: 1,
    },
    badgeText: {
      fontSize: 12,
      fontWeight: "900",
    },
    badgeGreen: {
      backgroundColor: "#E9F9EF",
      borderColor: "#A7F3C0",
    },
    badgeRed: {
      backgroundColor: isDark ? "rgba(243, 169, 169, 0.93)" : "#FEECEC",
      borderColor: "#FCA5A5",
    },
    badgeBlue: {
      backgroundColor: "#EAF2FF",
      borderColor: "#93C5FD",
    },
    badgePurple: {
      backgroundColor: isDark ? "rgb(181, 154, 245)" : "#F3ECFF",
      borderColor: "#C4B5FD",
    },
    badgeGray: {
      backgroundColor: isDark ? colors.cardAlt : "#F3F4F6",
      borderColor: colors.border,
    },

    belitDorFooter: {
      marginTop: 10,
      marginBottom: 8,
      marginHorizontal: 16,
      paddingVertical: 12,
      paddingHorizontal: 14,
      borderRadius: 14,
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
    belitDorFooterText: {
      fontWeight: "900",
      color: colors.text,
    },

    lineupTeamTitle: { fontSize: 16, fontWeight: "900", color: colors.text },
    lineupRoleTitle: { marginTop: 0, fontWeight: "900", color: colors.text },
    lineupRow: {
      marginTop: 8,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    lineupPlayer: { flex: 1, color: colors.text, fontWeight: "800" },
    lineupName: { flex: 1, color: colors.text, fontWeight: "800" },
    lineupEmpty: { marginTop: 8, color: colors.muted, fontWeight: "700" },

    statRowCard: {
      marginTop: 10,
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      ...Platform.select({
        ios: {
          shadowColor: "#000",
          shadowOpacity: 0.04,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
        },
        android: { elevation: 1 },
      }),
    },
    statLabel: { fontWeight: "900", color: colors.text, marginBottom: 10 },
    statValues: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
    statValueBox: {
      alignItems: "center",
      minWidth: 110,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.cardAlt,
    },
    statValue: { fontSize: 26, fontWeight: "900", color: colors.text },
    statMiniLabel: { marginTop: 4, color: colors.muted, fontWeight: "800" },
    statDash: { fontSize: 18, fontWeight: "900", color: colors.text },

    pdfButton: {
      marginTop: 4,
      alignSelf: "center",
      backgroundColor: colors.primary,
      paddingVertical: 12,
      paddingHorizontal: 18,
      minWidth: 240,
      borderRadius: 14,
      alignItems: "center",
    },
    pdfButtonText: { color: colors.primaryText, fontWeight: "900" },

    topTitle: { fontSize: 15, fontWeight: "900", color: colors.text },
    topRow: {
      marginTop: 10,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 10,
    },
    topName: { flex: 1, fontWeight: "800", color: colors.text },
  });
}
