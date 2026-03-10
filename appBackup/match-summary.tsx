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
import { BackButton, RefreshButton } from "../components/HeaderButtons";

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
  return `${day}/${month}/${year} - ${hour}:${min}`;
}

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
    const a = match?.team_a?.name ?? "Team A";
    const b = match?.team_b?.name ?? "Team B";
    const sa = trimCharField(match?.team_a?.short_name);
    const sb = trimCharField(match?.team_b?.short_name);
    const aLabel = sa ? `${a}` : a;
    const bLabel = sb ? `${b} ` : b;
    return `${aLabel} vs ${bLabel}`;
  }, [match]);

  const belitDorWinnerName = useMemo(() => {
    if (!hasBelitDor) return null;
    if (!match?.finished_at) return null;
    const aName = match?.team_a?.name ?? "Equip A";
    const bName = match?.team_b?.name ?? "Equip B";
    const sa = match?.score_team_a ?? 0;
    const sb = match?.score_team_b ?? 0;
    if (sa === sb) return null;
    return sa > sb ? aName : bName;
  }, [hasBelitDor, match]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [matchId])
  );

  async function load() {
    if (!matchId || Number.isNaN(matchId)) {
      Alert.alert("Error", "Match ID invàlid.");
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
      Alert.alert("Error", matchErr?.message ?? "No s'ha pogut carregar el partit.");
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
      Alert.alert("Error", mrErr.message);
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
      Alert.alert("Error", rErr.message);
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
      Alert.alert("Error", pErr.message);
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
      Alert.alert("Error", eErr.message);
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
      const aName = matchData.team_a?.name ?? "Team A";
      const bName = matchData.team_b?.name ?? "Team B";
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
        Alert.alert("Error", playersErr.message);
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
        Alert.alert("Error", teamsErr.message);
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
      const t = (et ?? "").toUpperCase();
      if (t === "CANAS_SCORED") return "Canes";
      if (t === "TEAM_BONUS_CANAS") return "Bonus equip";
      if (t === "DEFENDER_BONUS_CANAS") return "Bonus defensa";
      if (t === "AIR_CATCH") return "Escapsada";
      if (t === "MATACANAS") return "Matacanes";
      if (!t) return "—";
      return t;
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

      let player = playerName(ev.player_id ?? attackerPid);

      if (et === "AIR_CATCH" || et === "MATACANAS") {
        team = defenseTeam;
        // En aquests casos el player_id normalment ja és el defensor.
        // Si no hi és, fem fallback al eliminated_by_player_id.
        player = playerName(ev.player_id ?? eliminatedByPid);
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

    for (const t of sortedTurns) {
      const atkLabel = teamLabel(teamMap, t.attackingTeamId);
      const defLabel = teamLabel(teamMap, t.defendingTeamId);

      out.push({
        key: `h-${t.mrNumber}-${t.turn}`,
        kind: "turn_header",
        text: `Ronda ${t.mrNumber} · Torn ${t.turn} — Ataca: ${atkLabel}`,
      });

      const playsSorted = [...t.plays].sort((a, b) => a.id - b.id);

      function playText(pl: PlayRow) {
        const attacker = playerName(pl.attacker_player_id);
        const byDefault = pl.eliminated_by_player_id ? playerName(pl.eliminated_by_player_id) : null;

        const evs = eventsByPlayId.get(pl.id) ?? [];
        const parts: string[] = [];

        for (const ev of evs) {
          const et = ev.event_type ?? "";
          if (et === "CANAS_SCORED") {
            const v = typeof ev.value === "number" ? ev.value : 0;
            parts.push(`${attacker} ha fet ${v} canes`);
            continue;
          }
          if (et === "AIR_CATCH") {
            const byName = byDefault ?? (ev.player_id ? playerName(ev.player_id) : null);
            parts.push(byName ? `${attacker} escapsat per ${byName}` : `${attacker} escapsat`);
            continue;
          }
          if (et === "MATACANAS") {
            const byName = byDefault ?? (ev.player_id ? playerName(ev.player_id) : null);
            parts.push(byName ? `${attacker} matacanat per ${byName}` : `${attacker} matacanat`);
            continue;
          }
          if (et === "TEAM_BONUS_CANAS") {
            const v = typeof ev.value === "number" ? ev.value : 0;
            parts.push(`Metre guanyat: +${v} (${atkLabel})`);
            continue;
          }
          if (et === "DEFENDER_BONUS_CANAS") {
            const v = typeof ev.value === "number" ? ev.value : 0;
            parts.push(`Metre perdut: +${v} (${defLabel})`);
            continue;
          }

          if (et) {
            const who = ev.player_id ? playerName(ev.player_id) : attacker;
            const v = typeof ev.value === "number" ? ` (${ev.value})` : "";
            parts.push(`${who}: ${et}${v}`);
          }
        }

        if (parts.length === 0) return `Jugada #${pl.id}`;
        return parts.join(" · ");
      }

      function badgeForPlay(pl: PlayRow) {
        const evs = eventsByPlayId.get(pl.id) ?? [];
        const types = new Set<string>(evs.map((e) => (e.event_type ?? "").toUpperCase()).filter(Boolean));

        if (types.has("MATACANAS")) return { label: "Matacanes", variant: "red" as const };
        if (types.has("AIR_CATCH")) return { label: "Escapsat", variant: "blue" as const };

        if (
          types.has("METERS_REQUESTED") ||
          types.has("METERS_ACCEPTED") ||
          types.has("METERS_MEASURED") ||
          types.has("TEAM_BONUS_CANAS") ||
          types.has("DEFENDER_BONUS_CANAS")
        ) {
          return { label: "Metres", variant: "purple" as const };
        }

        if (types.has("CANAS_SCORED")) return { label: "Canes", variant: "green" as const };
        return { label: "Jugada", variant: "gray" as const };
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

      if (t.attackingTeamId && aId && t.attackingTeamId === aId) cumA += t.attackerPoints;
      else if (t.attackingTeamId && bId && t.attackingTeamId === bId) cumB += t.attackerPoints;

      if (t.defendingTeamId && aId && t.defendingTeamId === aId) cumA += t.defenderPoints;
      else if (t.defendingTeamId && bId && t.defendingTeamId === bId) cumB += t.defenderPoints;

      let winner = "";
      const aLabel = teamLabel(teamMap, matchData.team_a_id);
      const bLabel = teamLabel(teamMap, matchData.team_b_id);
      if (cumA > cumB) winner = `Guanya ${aLabel}`;
      else if (cumB > cumA) winner = `Guanya ${bLabel}`;
      else winner = `Empat `;

      out.push({
        key: `e-${t.mrNumber}-${t.turn}`,
        kind: "turn_end",
        text: `Canvi de torn — ${winner} · Marcador: ${cumA} - ${cumB}`,
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
lineupOut.push({ key: "lh", kind: "lineup_header", text: "Alineacions per rondes" });

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
    attackTeamLabel: atkTeamId ? teamLabel(teamMap, atkTeamId) : "Atac",
    defenseTeamLabel: defTeamId ? teamLabel(teamMap, defTeamId) : "Defensa",
    playersAttack: atkPlayers,
    playersDefense: defPlayers,
  });
}

// Build stats tab items
    const statsOut: StatListItem[] = [];
    statsOut.push({ key: "sh", kind: "stat_header", text: "Estadístiques" });

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

    const aShort = matchData.team_a?.short_name || trimCharField(matchData.team_a?.name) || "Equip A";
    const bShort = matchData.team_b?.short_name || trimCharField(matchData.team_b?.name) || "Equip B";

    statsOut.push({ key: "sr1", kind: "stat_row", label: "Canes", a: totals.canesA, b: totals.canesB });
    statsOut.push({ key: "sr2", kind: "stat_row", label: "Matacanes", a: totals.matA, b: totals.matB });
    statsOut.push({ key: "sr3", kind: "stat_row", label: "Escapsats", a: totals.airA, b: totals.airB });
    statsOut.push({ key: "sr4", kind: "stat_row", label: "Metres guanyats", a: totals.metresGainA, b: totals.metresGainB });
    statsOut.push({ key: "sr5", kind: "stat_row", label: "Metres perduts", a: totals.metresLostA, b: totals.metresLostB });

    function mapToTopRows(map: Map<number, number>, max = 3) {
      return Array.from(map.entries())
        .sort((x, y) => y[1] - x[1])
        .slice(0, max)
        .map(([pid, val]) => ({ label: playerName(pid), value: val }));
    }

    const topCanesRows = mapToTopRows(topCanes, 3);
    const topMatRows = mapToTopRows(topMat, 3);
    const topAirRows = mapToTopRows(topAir, 3);

    if (topCanesRows.length) statsOut.push({ key: "stc", kind: "stat_top", title: "Top canadors", rows: topCanesRows });
    if (topMatRows.length) statsOut.push({ key: "stm", kind: "stat_top", title: "Top matacanes", rows: topMatRows });
    if (topAirRows.length) statsOut.push({ key: "sta", kind: "stat_top", title: "Top escapsats", rows: topAirRows });

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
        Alert.alert("No disponible", "La funció de compartir no està disponible en aquest dispositiu.");
        return;
      }

      const phaseName = match.phase?.name ?? "—";
      const datePrevText = formatDateDDMMYYYY_HHMM(match.match_date);
      const dateRealText = match.started_at
        ? `${formatDateDDMMYYYY_HHMM(match.started_at)}${match.finished_at ? ` → ${formatDateDDMMYYYY_HHMM(match.finished_at)}` : ""}`
        : "—";
      const fieldCode = trimCharField(match.slot?.field_code) || "—";
      const referee = refereeName ?? "—";
      const teamA = match.team_a?.short_name || trimCharField(match.team_a?.name) || "Equip A";
      const teamB = match.team_b?.short_name || trimCharField(match.team_b?.name) || "Equip B";

      const status = match.is_finished ? "Finalitzat" : match.started_at ? "En curs" : "No iniciat";

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
                type: "Incompareixença",
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
        dialogTitle: "Compartir acta (PDF)",
      });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut generar el PDF.");
    } finally {
      setExportingPdf(false);
    }
  }, [match, refereeName, notPresentedInfo, headerTeams, liveScore, pdfEventRows]);

  if (loading) {
    return (
      <SafeAreaView style={styles.screen}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" />
          <Text style={styles.loadingText}>Carregant resum...</Text>
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
          onPress={() => load(true)}
          style={{ alignSelf: "flex-end",marginTop:5 }}
        />
            </View>

            <View style={styles.card}>
              <Text style={styles.teamsTitle} numberOfLines={2}>
                {headerTeams}
              </Text>

              <Text style={styles.dateText}>{formatDateDDMMYYYY_HHMM(match?.match_date)}</Text>

              {refereeName && <Text style={styles.refereeText}>Arbitrat per: {refereeName}</Text>}

              {!!match?.phase?.name && (
                <Text style={styles.phaseText} numberOfLines={1}>
                  {match.phase.name}
                </Text>
              )}

              <View style={styles.scoreRow}>
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreValue}>{scoreA}</Text>
                  <Text style={styles.scoreLabel} numberOfLines={1}>
                    {match?.team_a?.short_name || trimCharField(match?.team_a?.name) || "Equip A"}
                  </Text>
                </View>

                <Text style={styles.scoreDash}>—</Text>

                <View style={styles.scoreBox}>
                  <Text style={styles.scoreValue}>{scoreB}</Text>
                  <Text style={styles.scoreLabel} numberOfLines={1}>
                    {match?.team_b?.short_name || trimCharField(match?.team_b?.name) || "Equip B"}
                  </Text>
                </View>
              </View>

              <View style={styles.metaRow}>
                {match?.finished_at ? (
                  <View style={[styles.metaPill, styles.metaPillFinished]}>
                    <Text style={styles.metaPillLabel}>Finalitzat</Text>
                    <Text style={styles.metaPillValue}>{formatDateDDMMYYYY_HHMM(match.finished_at)}</Text>
                  </View>
                ) : (
                  <View style={[styles.metaPill, styles.metaPillPending]}>
                    <Text style={styles.metaPillLabel}>Estat</Text>
                    <Text style={styles.metaPillValue}>En curs</Text>
                  </View>
                )}

                {notPresentedInfo ? (
                  <View style={{ width: "100%", alignItems: "center" }}>
                    <View style={styles.badgeWarn}>
                      <Text style={styles.badgeWarnText}>⚠️ Incompareixença</Text>
                    </View>
                  </View>
                ) : null}
              </View>

              <Pressable
                onPress={exportActaPdf}
                disabled={exportingPdf}
                style={({ pressed }) => [
                  styles.pdfButton,
                  pressed && !exportingPdf ? { opacity: 0.9 } : null,
                  exportingPdf ? { opacity: 0.6 } : null,
                ]}
              >
                <Text style={styles.pdfButtonText}>
                  {exportingPdf ? "Generant PDF..." : "Exportar acta (PDF)"}
                </Text>
              </Pressable>

              {notPresentedInfo && match?.finished_at ? (
                <View style={styles.notPresentedCard}>
                  <Text style={styles.notPresentedText}>
                    {notPresentedInfo.absent} no presentat: +{notPresentedInfo.points} {notPresentedInfo.awarded}
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
                  <Text style={[styles.tabText, tab === "summary" ? styles.tabTextActive : styles.tabTextIdle]}>Resum</Text>
                </Pressable>

                <Pressable
                  onPress={() => setTab("lineups")}
                  style={({ pressed }) => [
                    styles.tabPill,
                    tab === "lineups" ? styles.tabPillActive : styles.tabPillIdle,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.tabText, tab === "lineups" ? styles.tabTextActive : styles.tabTextIdle]}>Alineacions</Text>
                </Pressable>

                <Pressable
                  onPress={() => setTab("stats")}
                  style={({ pressed }) => [
                    styles.tabPill,
                    tab === "stats" ? styles.tabPillActive : styles.tabPillIdle,
                    pressed && { opacity: 0.85 },
                  ]}
                >
                  <Text style={[styles.tabText, tab === "stats" ? styles.tabTextActive : styles.tabTextIdle]}>Stats</Text>
                </Pressable>
              </View>
            )}

            {!notPresentedInfo && tab === "summary" && (
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>Detall de jugades</Text>
                <Text style={styles.sectionSub}>Cronologia del partit</Text>
              </View>
            )}
          </View>
        }
        ListEmptyComponent={() => (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>
              {notPresentedInfo
                ? "Partit no jugat per incompareixença."
                : tab === "summary"
                ? "No hi ha jugades registrades per aquest partit."
                : tab === "lineups"
                ? "No hi ha alineacions registrades per aquest partit."
                : "No hi ha estadístiques disponibles."}
            </Text>
          </View>
        )}
        ListFooterComponent={() =>
          !notPresentedInfo && hasBelitDor && belitDorWinnerName ? (
            <View style={styles.belitDorFooter}>
              <Text style={styles.belitDorFooterText}>🏆 Bélit d’or l’ha guanyat {belitDorWinnerName}</Text>
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
                  <Text style={styles.badgeText}>{item.badge?.label ?? "Jugada"}</Text>
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
                <Text style={styles.sectionSub}>Plantilles del partit</Text>
              </View>
            );
          }

          
if (item.kind === "lineup_round") {
  return (
    <View style={styles.card}>
      <Text style={styles.lineupTeamTitle}>
        {item.roundNumber != null && item.turn != null
          ? `Ronda ${item.roundNumber} · Torn ${item.turn}`
          : item.roundNumber != null
          ? `Ronda ${item.roundNumber}`
          : item.turn != null
          ? `Torn ${item.turn}`
          : "Alineació"}
      </Text>

      <View style={{ marginTop: 10 }}>
        <Text style={styles.lineupRoleTitle}>{`Atac · ${item.attackTeamLabel}`}</Text>
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
        <Text style={styles.lineupRoleTitle}>{`Defensa · ${item.defenseTeamLabel}`}</Text>
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
                  <Text style={styles.lineupRoleTitle}>Atac</Text>
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
                  <Text style={styles.lineupRoleTitle}>Defensa</Text>
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
                <Text style={styles.sectionSub}>Dades del partit</Text>
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F7FB",
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
    color: "#666",
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
    color: "#666",
    fontStyle: "italic",
  },
  phaseText: {
marginTop: 4,
    fontSize: 13,
    color: "#6B7280",
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
    borderColor: "#E9EAF0",
    backgroundColor: "white",
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
    backgroundColor: "white",
    borderRadius: 16,
    paddingTop: 14,
    paddingLeft:14,
    paddingRight:14,
    paddingBottom:8,
    borderWidth: 1,
    borderColor: "#E9EAF0",
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
    color: "#111",
  },
  dateText: {
    marginTop: 6,
    color: "#666",
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
    borderColor: "#EEE",
    backgroundColor: "#FAFAFF",
  },
  scoreValue: { fontSize: 30, fontWeight: "900", color: "#111" },
  scoreLabel: { marginTop: 4, color: "#666", fontWeight: "800" },
  scoreDash: { fontSize: 22, fontWeight: "900", color: "#111" },

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
    backgroundColor: "#FAFAFF",
    borderColor: "#EEE",
  },
  metaPillFinished: { backgroundColor: "#F2FFF7", borderColor: "#D7F5E3" },
  metaPillPending: { backgroundColor: "#FFF9F2", borderColor: "#F4E3C9" },
  metaPillLabel: { color: "#666", fontSize: 12, fontWeight: "800" },
  metaPillValue: { marginTop: 2, fontSize: 14, fontWeight: "900", color: "#111" },

  badgeWarn: {
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: "#FEF3C7",
    borderWidth: 1,
    borderColor: "#F59E0B",
  },
  badgeWarnText: { fontWeight: "900", color: "#92400E" },

  notPresentedCard: {
    marginTop: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: "#FFF7ED",
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
    backgroundColor: "white",
  },
  tabPillActive: {
    borderColor: "#111827",
    backgroundColor: "#111827",
  },
  tabPillIdle: {
    borderColor: "#E9EAF0",
    backgroundColor: "white",
  },
  tabText: { fontWeight: "900", fontSize: 13 },
  tabTextActive: { color: "white" },
  tabTextIdle: { color: "#111" },

  sectionHeader: {
    marginTop: 8,
    marginBottom: 8,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: "900", color: "#111" },
  sectionSub: { marginTop: 2, color: "#666", fontWeight: "700" },

  emptyWrap: { marginTop: 26, alignItems: "center" },
  emptyText: { color: "#666", textAlign: "center", fontWeight: "700" },

  turnHeader: { marginTop: 10, marginBottom: 4, paddingHorizontal: 2 },
  turnHeaderText: { fontWeight: "900", color: "#111" },

  turnEnd: {
    marginTop: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E9EAF0",
    backgroundColor: "#F8FAFF",
  },
  turnEndText: { fontWeight: "900", color: "#111" },

  playRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginTop: 10,
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E9EAF0",
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
  playText: { color: "#333", fontWeight: "700", flexShrink: 1, flexWrap: "wrap", lineHeight: 20 },

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
    backgroundColor: "#FEECEC",
    borderColor: "#FCA5A5",
  },
  badgeBlue: {
    backgroundColor: "#EAF2FF",
    borderColor: "#93C5FD",
  },
  badgePurple: {
    backgroundColor: "#F3ECFF",
    borderColor: "#C4B5FD",
  },
  badgeGray: {
    backgroundColor: "#F3F4F6",
    borderColor: "#E5E7EB",
  },

  belitDorFooter: {
    marginTop: 10,
    marginBottom: 8,
    marginHorizontal: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "white",
    borderWidth: 1,
    borderColor: "#E9EAF0",
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
    color: "#111827",
  },

  lineupTeamTitle: { fontSize: 16, fontWeight: "900", color: "#111" },
  lineupRoleTitle: { marginTop: 0, fontWeight: "900", color: "#111" },
  lineupRow: {
    marginTop: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  lineupName: { flex: 1, color: "#333", fontWeight: "800" },
  lineupEmpty: { marginTop: 8, color: "#666", fontWeight: "700" },

  statRowCard: {
    marginTop: 10,
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E9EAF0",
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
  statLabel: { fontWeight: "900", color: "#111", marginBottom: 10 },
  statValues: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  statValueBox: {
    alignItems: "center",
    minWidth: 110,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#EEE",
    backgroundColor: "#FAFAFF",
  },
  statValue: { fontSize: 26, fontWeight: "900", color: "#111" },
  statMiniLabel: { marginTop: 4, color: "#666", fontWeight: "800" },
  statDash: { fontSize: 18, fontWeight: "900", color: "#111" },

  pdfButton: {
    marginTop: 4,
    alignSelf: "center",
    backgroundColor: "#111827",
    paddingVertical: 12,
    paddingHorizontal: 18,
    minWidth: 240,
    borderRadius: 14,
    alignItems: "center",
  },
  pdfButtonText: { color: "white", fontWeight: "900" },

  topTitle: { fontSize: 15, fontWeight: "900", color: "#111" },
  topRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  topName: { flex: 1, fontWeight: "800", color: "#333" },
});
