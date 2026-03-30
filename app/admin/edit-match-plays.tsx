import { useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton } from "../../components/HeaderButtons";
import { Keyboard } from "react-native";

type MatchSummary = {
  id: number;
  championship_id: number | null;
  score_team_a: number;
  score_team_b: number;
  is_finished: boolean;
  phase_id?: number | null;
  team_a_id: number | null;
  team_b_id: number | null;
  team_a?: { name: string } | null;
  team_b?: { name: string } | null;
};

type EventItem = {
  id?: number;
  event_type: string;
  value: number;
  player_id: number | null;
  player_name?: string | null;
};

type PlayRow = {
  play_id: number;
  round_id: number;
  match_round_id: number;
  match_round_number: number;
  round_turn: number;
  attacking_team_id: number | null;
  defending_team_id: number | null;
  attacker_player_id: number | null;
  attacker_name: string | null;
  eliminated: boolean | null;
  eliminated_by_player_id: number | null;
  eliminated_by_name: string | null;
  events: EventItem[];
};

type EventDraft = {
  id: string;
  event_type: string;
  value: string;
  player_id: string;
};

type TeamPlayerOption = {
  teamId: number;
  teamName: string;
  playerId: number;
  playerName: string;
  playerNumber: number | null;
  externalCode: string | null;
};

const EVENT_TYPES = [
  "AIR_CATCH",
  "MATACANAS",
  "METERS_REQUESTED",
  "METERS_ACCEPTED",
  "METERS_MEASURED",
  "CANAS_SCORED",
  "TEAM_BONUS_CANAS",
  "DEFENDER_BONUS_CANAS",
  "BELIT_DOR",
  "NOT_PRESENTED",
] as const;

function createDraftEvent(seed?: Partial<EventDraft>): EventDraft {
  return {
    id: `${Date.now()}-${Math.random()}`,
    event_type: seed?.event_type ?? "CANAS_SCORED",
    value: seed?.value ?? "0",
    player_id: seed?.player_id ?? "",
  };
}

function prettyEventType(eventType: string) {
  return eventType
    .toLowerCase()
    .split("_")
    .map((x) => x.charAt(0).toUpperCase() + x.slice(1))
    .join(" ");
}

function getEventTone(eventType: string) {
  switch (eventType) {
    case "CANAS_SCORED":
    case "TEAM_BONUS_CANAS":
    case "BELIT_DOR":
    case "NOT_PRESENTED":
      return { bg: "#ECFDF5", border: "#A7F3D0", text: "#065F46" };
    case "MATACANAS":
    case "AIR_CATCH":
    case "DEFENDER_BONUS_CANAS":
      return { bg: "#EFF6FF", border: "#BFDBFE", text: "#1D4ED8" };
    default:
      return { bg: "#F3F4F6", border: "#E5E7EB", text: "#374151" };
  }
}

function summarizeEvents(events: EventItem[]) {
  if (!events.length) return "Sense events";
  return events
    .map((ev) => `${prettyEventType(ev.event_type)} · ${ev.value}${ev.player_name ? ` · ${ev.player_name}` : ""}`)
    .join("  •  ");
}

function displayPlayer(option: TeamPlayerOption) {
  const base = option.playerNumber ? `${option.playerNumber}. ${option.playerName}` : option.playerName;
  return option.externalCode ? `${base} (${option.externalCode})` : base;
}

function computeContributionForTeams(
  events: Array<{ event_type: string; value: number }>,
  play: Pick<PlayRow, "attacking_team_id" | "defending_team_id">,
  match: Pick<MatchSummary, "team_a_id" | "team_b_id">
) {
  let teamA = 0;
  let teamB = 0;

  for (const ev of events) {
    let targetTeamId: number | null = null;

    if (["CANAS_SCORED", "TEAM_BONUS_CANAS", "BELIT_DOR", "NOT_PRESENTED"].includes(ev.event_type)) {
      targetTeamId = play.attacking_team_id ?? null;
    } else if (["DEFENDER_BONUS_CANAS", "MATACANAS", "AIR_CATCH"].includes(ev.event_type)) {
      targetTeamId = play.defending_team_id ?? null;
    }

    if (targetTeamId == null) continue;

    if (targetTeamId === match.team_a_id) teamA += ev.value;
    if (targetTeamId === match.team_b_id) teamB += ev.value;
  }

  return { teamA, teamB };
}

export default function EditMatchPlaysScreenV3() {
  const router = useRouter();

  const [matchIdInput, setMatchIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [matchSummary, setMatchSummary] = useState<MatchSummary | null>(null);
  const [plays, setPlays] = useState<PlayRow[]>([]);
  const [teamPlayers, setTeamPlayers] = useState<TeamPlayerOption[]>([]);
  const [roundLineupPlayersByKey, setRoundLineupPlayersByKey] = useState<Record<string, TeamPlayerOption[]>>({});
  const [pickerPlayers, setPickerPlayers] = useState<TeamPlayerOption[]>([]);

  const [editOpen, setEditOpen] = useState(false);
  const [selectedPlay, setSelectedPlay] = useState<PlayRow | null>(null);
  const [editEliminated, setEditEliminated] = useState(false);
  const [editEliminatedByPlayerId, setEditEliminatedByPlayerId] = useState("");
  const [reason, setReason] = useState("");
  const [eventDrafts, setEventDrafts] = useState<EventDraft[]>([]);

  const [filterRound, setFilterRound] = useState<number | null>(null);
  const [filterTurn, setFilterTurn] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const [playerPickerOpen, setPlayerPickerOpen] = useState(false);
  const [playerPickerMode, setPlayerPickerMode] = useState<"eliminated_by" | "event_player" | null>(null);
  const [pickerDraftId, setPickerDraftId] = useState<string | null>(null);
  const [reopenEditAfterPicker, setReopenEditAfterPicker] = useState(false);

  const parsedMatchId = useMemo(() => Number(matchIdInput.trim()), [matchIdInput]);

  const availableRounds = useMemo(
    () => Array.from(new Set(plays.map((p) => p.match_round_number))).sort((a, b) => a - b),
    [plays]
  );

  const visiblePlays = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return plays.filter((play) => {
      if (filterRound !== null && play.match_round_number !== filterRound) return false;
      if (filterTurn !== null && play.round_turn !== filterTurn) return false;
      if (!q) return true;

      return [
        play.play_id,
        play.attacker_name ?? "",
        play.eliminated_by_name ?? "",
        summarizeEvents(play.events),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [plays, filterRound, filterTurn, searchText]);

  const groupedVisiblePlays = useMemo(() => {
    const groups = new Map<
      string,
      { label: string; round: number; turn: number; items: PlayRow[] }
    >();

    for (const play of visiblePlays) {
      const key = `${play.match_round_number}-${play.round_turn}`;
      if (!groups.has(key)) {
        groups.set(key, {
          label: `Ronda ${play.match_round_number} · Torn ${play.round_turn}`,
          round: play.match_round_number,
          turn: play.round_turn,
          items: [],
        });
      }
      groups.get(key)!.items.push(play);
    }

    return Array.from(groups.entries())
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => (a.round !== b.round ? a.round - b.round : a.turn - b.turn));
  }, [visiblePlays]);

  const eligiblePlayers = useMemo(() => {
    if (!matchSummary) return [];
    return teamPlayers.filter(
      (p) => p.teamId === matchSummary.team_a_id || p.teamId === matchSummary.team_b_id
    );
  }, [teamPlayers, matchSummary]);

  const allKnownPlayers = useMemo(() => {
    const byId = new Map<number, TeamPlayerOption>();
    for (const p of eligiblePlayers) byId.set(p.playerId, p);
    for (const list of Object.values(roundLineupPlayersByKey)) {
      for (const p of list) if (!byId.has(p.playerId)) byId.set(p.playerId, p);
    }
    return Array.from(byId.values());
  }, [eligiblePlayers, roundLineupPlayersByKey]);

  const playerNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const p of allKnownPlayers) map.set(p.playerId, displayPlayer(p));
    return map;
  }, [allKnownPlayers]);

  const currentContributionBefore = useMemo(() => {
    if (!selectedPlay || !matchSummary) return { teamA: 0, teamB: 0 };
    return computeContributionForTeams(selectedPlay.events, selectedPlay, matchSummary);
  }, [selectedPlay, matchSummary]);

  const currentContributionAfter = useMemo(() => {
    if (!selectedPlay || !matchSummary) return { teamA: 0, teamB: 0 };
    const events = eventDrafts.map((d) => ({ event_type: d.event_type, value: Number(d.value || "0") || 0 }));
    return computeContributionForTeams(events, selectedPlay, matchSummary);
  }, [selectedPlay, matchSummary, eventDrafts]);

  async function loadMatch() {
    Keyboard.dismiss(); // 🔥 CIERRA EL TECLADO

  if (!Number.isFinite(parsedMatchId) || parsedMatchId <= 0) {
    Alert.alert("ID invàlid", "Introdueix un match_id vàlid.");
    return;
  }

    try {
      setLoading(true);

      const { data: matchData, error: matchErr } = await supabase
        .from("match")
        .select(`
          id,
          championship_id,
          score_team_a,
          score_team_b,
          is_finished,
          phase_id,
          team_a_id,
          team_b_id,
          team_a:team_a_id(name),
          team_b:team_b_id(name)
        `)
        .eq("id", parsedMatchId)
        .single();

      if (matchErr) throw matchErr;

const raw = matchData as any;

const summary: MatchSummary = {
  id: raw.id,
  championship_id: raw.championship_id ?? null,
  score_team_a: raw.score_team_a ?? 0,
  score_team_b: raw.score_team_b ?? 0,
  is_finished: !!raw.is_finished,
  phase_id: raw.phase_id ?? null,
  team_a_id: raw.team_a_id ?? null,
  team_b_id: raw.team_b_id ?? null,
  team_a: Array.isArray(raw.team_a) ? raw.team_a[0] ?? null : raw.team_a ?? null,
  team_b: Array.isArray(raw.team_b) ? raw.team_b[0] ?? null : raw.team_b ?? null,
};

setMatchSummary(summary);

      const { data: roundsData, error: roundsErr } = await supabase
        .from("match_round")
        .select("id, number")
        .eq("match_id", parsedMatchId)
        .order("number", { ascending: true });

      if (roundsErr) throw roundsErr;

      const matchRoundIds = (roundsData ?? []).map((r: any) => r.id);
      if (!matchRoundIds.length) {
        setPlays([]);
        return;
      }

      const { data: roundData, error: roundErr } = await supabase
        .from("round")
        .select("id, match_round_id, turn, attacking_team_id, defending_team_id")
        .in("match_round_id", matchRoundIds);

      if (roundErr) throw roundErr;

      const roundIds = (roundData ?? []).map((r: any) => r.id);
      if (!roundIds.length) {
        setPlays([]);
        setRoundLineupPlayersByKey({});
        return;
      }

      const { data: roundLineupData, error: roundLineupErr } = roundIds.length
        ? await supabase
            .from("round_lineup")
            .select(`
              round_id,
              team_id,
              player_id,
              player:player_id(name, external_code)
            `)
            .in("round_id", roundIds)
        : { data: [], error: null as any };

      if (roundLineupErr) throw roundLineupErr;

      const { data: playData, error: playErr } = await supabase
        .from("play")
        .select(`
          id,
          round_id,
          attacker_player_id,
          eliminated,
          eliminated_by_player_id,
          attacker:attacker_player_id(name),
          eliminated_by:eliminated_by_player_id(name)
        `)
        .in("round_id", roundIds)
        .order("id", { ascending: true });

      if (playErr) throw playErr;

      const playIds = (playData ?? []).map((p: any) => p.id);

      const { data: eventData, error: eventErr } = playIds.length
        ? await supabase
            .from("play_event")
            .select(`
              id,
              play_id,
              event_type,
              value,
              player_id,
              player:player_id(name, external_code)
            `)
            .in("play_id", playIds)
            .order("id", { ascending: true })
        : { data: [], error: null as any };

      if (eventErr) throw eventErr;

      if (summary.championship_id && summary.team_a_id && summary.team_b_id) {
        const { data: teamPlayersData, error: teamPlayersErr } = await supabase
          .from("team_player")
          .select(`
            team_id,
            player_id,
            player_number,
            player:player_id(name, external_code)
          `)
          .eq("championship_id", summary.championship_id)
          .in("team_id", [summary.team_a_id, summary.team_b_id])
          .order("player_number", { ascending: true });

        if (teamPlayersErr) throw teamPlayersErr;

        const teamNameA = summary.team_a?.name ?? `Equip ${summary.team_a_id}`;
        const teamNameB = summary.team_b?.name ?? `Equip ${summary.team_b_id}`;

        setTeamPlayers(
          (teamPlayersData ?? []).map((row: any) => {
            const playerObj = Array.isArray(row.player) ? row.player[0] ?? null : row.player;
            return {
              teamId: row.team_id,
              teamName: row.team_id === summary.team_a_id ? teamNameA : teamNameB,
              playerId: row.player_id,
              playerName: playerObj?.name ?? `Jugador ${row.player_id}`,
              playerNumber: row.player_number ?? null,
              externalCode: playerObj?.external_code ?? null,
            };
          })
        );
      } else {
        setTeamPlayers([]);
      }

      const nextRoundLineupPlayersByKey: Record<string, TeamPlayerOption[]> = {};
      for (const rawRow of roundLineupData ?? []) {
        const row = rawRow as any;
        const teamA = Array.isArray(summary.team_a) ? summary.team_a[0] ?? null : summary.team_a;
        const teamB = Array.isArray(summary.team_b) ? summary.team_b[0] ?? null : summary.team_b;
        const playerObj = Array.isArray(row.player) ? row.player[0] ?? null : row.player;
        const teamName =
          row.team_id === summary.team_a_id
            ? teamA?.name ?? `Equip ${row.team_id}`
            : row.team_id === summary.team_b_id
            ? teamB?.name ?? `Equip ${row.team_id}`
            : `Equip ${row.team_id}`;
        const key = `${row.round_id}-${row.team_id}`;
        if (!nextRoundLineupPlayersByKey[key]) nextRoundLineupPlayersByKey[key] = [];
        nextRoundLineupPlayersByKey[key].push({
          teamId: row.team_id,
          teamName,
          playerId: row.player_id,
          playerName: playerObj?.name ?? `Jugador ${row.player_id}`,
          playerNumber: null,
          externalCode: playerObj?.external_code ?? null,
        });
      }
      setRoundLineupPlayersByKey(nextRoundLineupPlayersByKey);

      const matchRoundMap = new Map<number, number>();
      for (const mr of roundsData ?? []) matchRoundMap.set(mr.id, mr.number);

      const roundMap = new Map<
        number,
        { match_round_id: number; turn: number; attacking_team_id: number | null; defending_team_id: number | null }
      >();
      for (const r of roundData ?? []) {
        roundMap.set(r.id, {
          match_round_id: r.match_round_id,
          turn: r.turn,
          attacking_team_id: r.attacking_team_id ?? null,
          defending_team_id: r.defending_team_id ?? null,
        });
      }

      const eventsByPlay = new Map<number, any[]>();
      for (const ev of eventData ?? []) {
        const list = eventsByPlay.get(ev.play_id) ?? [];
        list.push(ev);
        eventsByPlay.set(ev.play_id, list);
      }

      const mapped: PlayRow[] = (playData ?? []).map((p: any) => {
        const roundInfo = roundMap.get(p.round_id);
        const mrNumber = roundInfo ? matchRoundMap.get(roundInfo.match_round_id) ?? 0 : 0;

        return {
          play_id: p.id,
          round_id: p.round_id,
          match_round_id: roundInfo?.match_round_id ?? 0,
          match_round_number: mrNumber,
          round_turn: roundInfo?.turn ?? 0,
          attacking_team_id: roundInfo?.attacking_team_id ?? null,
          defending_team_id: roundInfo?.defending_team_id ?? null,
          attacker_player_id: p.attacker_player_id,
          attacker_name: (Array.isArray(p.attacker) ? p.attacker[0]?.name : p.attacker?.name) ?? null,
          eliminated: p.eliminated,
          eliminated_by_player_id: p.eliminated_by_player_id,
          eliminated_by_name: (Array.isArray(p.eliminated_by) ? p.eliminated_by[0]?.name : p.eliminated_by?.name) ?? null,
          events: (eventsByPlay.get(p.id) ?? []).map((ev: any) => ({
            id: ev.id,
            event_type: ev.event_type,
            value: ev.value ?? 0,
            player_id: ev.player_id,
            player_name: (Array.isArray(ev.player) ? ev.player[0]?.name : ev.player?.name) ?? null,
          })),
        };
      });

      setPlays(mapped);
      setCollapsedGroups({});
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut carregar el partit.");
    } finally {
      setLoading(false);
    }
  }

  function openEdit(play: PlayRow) {
    setSelectedPlay(play);
    setEditEliminated(!!play.eliminated);
    setEditEliminatedByPlayerId(play.eliminated_by_player_id ? String(play.eliminated_by_player_id) : "");
    setReason("");
    setEventDrafts(
      play.events.length
        ? play.events.map((ev) =>
            createDraftEvent({
              event_type: ev.event_type,
              value: String(ev.value ?? 0),
              player_id: ev.player_id ? String(ev.player_id) : "",
            })
          )
        : [createDraftEvent()]
    );
    setPlayerPickerOpen(false);
    setPlayerPickerMode(null);
    setPickerDraftId(null);
    setPickerPlayers([]);
    setReopenEditAfterPicker(false);
    setEditOpen(true);
  }

  function updateDraft(id: string, patch: Partial<EventDraft>) {
    setEventDrafts((prev) => prev.map((ev) => (ev.id === id ? { ...ev, ...patch } : ev)));
  }

  function addDraftEvent() {
    setEventDrafts((prev) => [...prev, createDraftEvent()]);
  }

  function removeDraftEvent(id: string) {
    setEventDrafts((prev) => prev.filter((ev) => ev.id !== id));
  }

  function openPlayerPicker(mode: "eliminated_by" | "event_player", draftId?: string) {
  if (!selectedPlay) return;

  let nextPlayers: TeamPlayerOption[] = [];

  if (mode === "eliminated_by") {
    if (!editEliminated) {
      Alert.alert("Info", "Marca primer 'Eliminat' per poder seleccionar qui l'ha eliminat.");
      return;
    }

    const defendingTeamId = selectedPlay.defending_team_id;
    if (!defendingTeamId) {
      Alert.alert("Error", "No s'ha pogut detectar l'equip defensor d'aquesta ronda.");
      return;
    }

    const key = `${selectedPlay.round_id}-${defendingTeamId}`;
    nextPlayers = roundLineupPlayersByKey[key] ?? [];
  } else {
    const attackKey = `${selectedPlay.round_id}-${selectedPlay.attacking_team_id}`;
    const defenseKey = `${selectedPlay.round_id}-${selectedPlay.defending_team_id}`;
    nextPlayers = [
      ...(roundLineupPlayersByKey[attackKey] ?? []),
      ...(roundLineupPlayersByKey[defenseKey] ?? []),
    ];
  }

  if (!nextPlayers.length) {
    Alert.alert("Sense jugadors", "No s'han trobat jugadors disponibles per aquesta ronda.");
    return;
  }

  setPickerPlayers(nextPlayers);
  setPlayerPickerMode(mode);
  setPickerDraftId(draftId ?? null);
  setReopenEditAfterPicker(true);

  // tanquem primer el modal d'edició
  setEditOpen(false);

  // i obrim el picker al següent tick
  setTimeout(() => {
    setPlayerPickerOpen(true);
  }, 150);
}

  function applyPlayerSelection(playerId: number | null) {
  if (playerPickerMode === "eliminated_by") {
    setEditEliminatedByPlayerId(playerId ? String(playerId) : "");
  }

  if (playerPickerMode === "event_player" && pickerDraftId) {
    updateDraft(pickerDraftId, { player_id: playerId ? String(playerId) : "" });
  }

  setPlayerPickerOpen(false);
  setPlayerPickerMode(null);
  setPickerDraftId(null);
  setPickerPlayers([]);

  if (reopenEditAfterPicker) {
    setTimeout(() => {
      setEditOpen(true);
      setReopenEditAfterPicker(false);
    }, 150);
  }
}

  async function savePlayEdition() {
    if (!matchSummary || !selectedPlay) return;

    const parsedEvents: Array<{ event_type: string; value: number; player_id: number | null }> = [];

    for (const draft of eventDrafts) {
      const eventType = draft.event_type.trim();
      const value = Number(draft.value.trim() || "0");
      const playerIdRaw = draft.player_id.trim();

      if (!EVENT_TYPES.includes(eventType as (typeof EVENT_TYPES)[number])) {
        Alert.alert("Event invàlid", `Tipus no permès: ${eventType || "(buit)"}`);
        return;
      }

      if (!Number.isFinite(value)) {
        Alert.alert("Valor invàlid", `Revisa el valor de ${eventType}.`);
        return;
      }

      let playerId: number | null = null;
      if (playerIdRaw) {
        const parsedPlayerId = Number(playerIdRaw);
        if (!Number.isFinite(parsedPlayerId) || parsedPlayerId <= 0) {
          Alert.alert("Player ID invàlid", `Revisa el jugador de ${eventType}.`);
          return;
        }
        playerId = parsedPlayerId;
      }

      parsedEvents.push({
        event_type: eventType,
        value,
        player_id: playerId,
      });
    }

    Alert.alert(
      "Confirmació final",
      `Segur que vols guardar els canvis de la jugada ${selectedPlay.play_id}? Es farà backup i es recalcularà el partit.`,
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Guardar",
          onPress: async () => {
            try {
              setSaving(true);

              const { error } = await supabase.rpc("admin_edit_play_and_recalculate", {
                p_match_id: matchSummary.id,
                p_play_id: selectedPlay.play_id,
                p_eliminated: editEliminated,
                p_eliminated_by_player_id: editEliminatedByPlayerId.trim()
                  ? Number(editEliminatedByPlayerId.trim())
                  : null,
                p_events: parsedEvents,
                p_reason: reason.trim() || null,
              });

              if (error) throw error;

              setEditOpen(false);
              setReopenEditAfterPicker(false);
              setSelectedPlay(null);
              Alert.alert("Fet ✅", "Jugada corregida i partit recalculat.");
              await loadMatch();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut editar la jugada.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  async function deletePlay(play: PlayRow) {
    if (!matchSummary) return;

    Alert.alert(
      "Eliminar jugada",
      `Segur que vols eliminar la jugada ${play.play_id}? Es recalcularà el partit i es guardarà backup.`,
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              setSaving(true);
              const { error } = await supabase.rpc("admin_delete_play_and_recalculate", {
                p_match_id: matchSummary.id,
                p_play_id: play.play_id,
                p_reason: `Eliminar jugada ${play.play_id}`,
              });
              if (error) throw error;
              Alert.alert("Fet ✅", "Jugada eliminada i partit recalculat.");
              await loadMatch();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut eliminar la jugada.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  function toggleGroup(key: string) {
    setCollapsedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#F6F7FB" }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 10, paddingBottom: 24 }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <BackButton onPress={() => router.back()} style={{ marginBottom: 15 }} />
        </View>

        <Text style={{ fontSize: 24, fontWeight: "900", color: "#111827", marginBottom: 4 }}>
          🛠️ Corregir jugades
        </Text>
        <Text style={{ color: "#6B7280", fontWeight: "700", marginBottom: 14 }}>
          Editor V3 amb grups, selector de jugadors i previsualització del canvi.
        </Text>

        <View
          style={{
            backgroundColor: "white",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#E5E7EB",
            padding: 14,
            marginBottom: 14,
          }}
        >
          <Text style={{ fontSize: 17, fontWeight: "900", color: "#111827", marginBottom: 12 }}>
            Cercar partit
          </Text>

          <Text style={{ fontWeight: "800", color: "#111827", marginBottom: 8 }}>ID del partit</Text>
          <TextInput
            value={matchIdInput}
            onChangeText={setMatchIdInput}
            keyboardType="number-pad"
            placeholder="Ex: 123"
            style={{
              borderWidth: 1,
              borderColor: "#D1D5DB",
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: "white",
            }}
          />

          <Pressable
            onPress={loadMatch}
            disabled={loading}
            style={{
              marginTop: 14,
              backgroundColor: "#111827",
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 12,
              opacity: loading ? 0.5 : 1,
            }}
          >
            {loading ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "900" }}>Carregar partit</Text>
            )}
          </Pressable>
        </View>

        {matchSummary ? (
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#E5E7EB",
              padding: 14,
              marginBottom: 14,
            }}
          >
            <Text style={{ fontWeight: "900", fontSize: 17, color: "#111827" }}>
              {matchSummary.team_a?.name ?? `Equip ${matchSummary.team_a_id}`} {matchSummary.score_team_a} -{" "}
              {matchSummary.score_team_b} {matchSummary.team_b?.name ?? `Equip ${matchSummary.team_b_id}`}
            </Text>
            <Text style={{ marginTop: 6, color: "#4B5563", fontWeight: "700" }}>
              Estat: {matchSummary.is_finished ? "Finalitzat" : "Obert"}
            </Text>
            <Text style={{ marginTop: 4, color: "#4B5563", fontWeight: "700" }}>
              Jugades carregades: {plays.length}
            </Text>
          </View>
        ) : null}

        {plays.length > 0 ? (
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#E5E7EB",
              padding: 14,
              marginBottom: 14,
            }}
          >
            <Text style={{ fontSize: 17, fontWeight: "900", color: "#111827", marginBottom: 12 }}>
              Filtres
            </Text>

            <TextInput
              value={searchText}
              onChangeText={setSearchText}
              placeholder="Buscar per atacant, id o event..."
              style={{
                borderWidth: 1,
                borderColor: "#D1D5DB",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: "white",
                marginBottom: 12,
              }}
            />

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
              <Pressable
                onPress={() => setFilterRound(null)}
                style={{
                  borderRadius: 999,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: filterRound === null ? "#111827" : "#D1D5DB",
                  backgroundColor: filterRound === null ? "#111827" : "white",
                }}
              >
                <Text style={{ fontWeight: "800", color: filterRound === null ? "white" : "#111827" }}>
                  Totes les rondes
                </Text>
              </Pressable>

              {availableRounds.map((round) => (
                <Pressable
                  key={round}
                  onPress={() => setFilterRound(round)}
                  style={{
                    borderRadius: 999,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: filterRound === round ? "#111827" : "#D1D5DB",
                    backgroundColor: filterRound === round ? "#111827" : "white",
                  }}
                >
                  <Text style={{ fontWeight: "800", color: filterRound === round ? "white" : "#111827" }}>
                    R{round}
                  </Text>
                </Pressable>
              ))}
            </View>

            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Pressable
                onPress={() => setFilterTurn(null)}
                style={{
                  borderRadius: 999,
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderWidth: 1,
                  borderColor: filterTurn === null ? "#111827" : "#D1D5DB",
                  backgroundColor: filterTurn === null ? "#111827" : "white",
                }}
              >
                <Text style={{ fontWeight: "800", color: filterTurn === null ? "white" : "#111827" }}>
                  Tots els torns
                </Text>
              </Pressable>

              {[1, 2].map((turn) => (
                <Pressable
                  key={turn}
                  onPress={() => setFilterTurn(turn)}
                  style={{
                    borderRadius: 999,
                    paddingVertical: 8,
                    paddingHorizontal: 12,
                    borderWidth: 1,
                    borderColor: filterTurn === turn ? "#111827" : "#D1D5DB",
                    backgroundColor: filterTurn === turn ? "#111827" : "white",
                  }}
                >
                  <Text style={{ fontWeight: "800", color: filterTurn === turn ? "white" : "#111827" }}>
                    Torn {turn}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View>
          {groupedVisiblePlays.map((group) => {
            const collapsed = !!collapsedGroups[group.key];

            return (
              <View
                key={group.key}
                style={{
                  backgroundColor: "white",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  marginBottom: 12,
                  overflow: "hidden",
                }}
              >
                <Pressable
                  onPress={() => toggleGroup(group.key)}
                  style={{
                    paddingHorizontal: 14,
                    paddingVertical: 14,
                    backgroundColor: "#F9FAFB",
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <View>
                    <Text style={{ fontWeight: "900", fontSize: 16, color: "#111827" }}>{group.label}</Text>
                    <Text style={{ marginTop: 4, color: "#6B7280", fontWeight: "700" }}>
                      {group.items.length} jugad{group.items.length === 1 ? "a" : "es"}
                    </Text>
                  </View>
                  <Text style={{ fontWeight: "900", fontSize: 18, color: "#111827" }}>
                    {collapsed ? "＋" : "－"}
                  </Text>
                </Pressable>

                {!collapsed ? (
                  <View style={{ padding: 12 }}>
                    {group.items.map((play) => (
                      <View
                        key={play.play_id}
                        style={{
                          borderWidth: 1,
                          borderColor: "#E5E7EB",
                          borderRadius: 14,
                          padding: 12,
                          marginBottom: 10,
                        }}
                      >
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                          }}
                        >
                          <View style={{ flex: 1, paddingRight: 10 }}>
                            <Text style={{ fontWeight: "900", color: "#111827", fontSize: 15 }}>
                              Play #{play.play_id}
                            </Text>
                            <Text style={{ marginTop: 4, color: "#111827", fontWeight: "700" }}>
                              Atacant: {play.attacker_name ?? "—"}
                            </Text>
                            <Text style={{ marginTop: 4, color: "#4B5563" }}>
                              Eliminat: {play.eliminated ? "Sí" : "No"}
                              {play.eliminated_by_name ? ` · per ${play.eliminated_by_name}` : ""}
                            </Text>
                          </View>

                          <View style={{ flexDirection: "row", gap: 8 }}>
                            <Pressable
                              onPress={() => openEdit(play)}
                              style={{
                                paddingVertical: 8,
                                paddingHorizontal: 12,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: "#D1D5DB",
                                backgroundColor: "white",
                              }}
                            >
                              <Text style={{ fontWeight: "800" }}>Editar</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => deletePlay(play)}
                              style={{
                                paddingVertical: 8,
                                paddingHorizontal: 12,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: "#FCA5A5",
                                backgroundColor: "#FEF2F2",
                              }}
                            >
                              <Text style={{ fontWeight: "800", color: "#B91C1C" }}>Eliminar</Text>
                            </Pressable>
                          </View>
                        </View>

                        <View style={{ marginTop: 10 }}>
                          <ScrollView
                            horizontal
                            nestedScrollEnabled
                            showsHorizontalScrollIndicator={false}
                            keyboardShouldPersistTaps="handled"
                            contentContainerStyle={{ gap: 8, paddingRight: 8 }}
                          >
                            {play.events.length ? (
                              play.events.map((ev, idx) => {
                                const tone = getEventTone(ev.event_type);

                                return (
                                  <View
                                    key={`${play.play_id}-${idx}`}
                                    style={{
                                      borderRadius: 999,
                                      borderWidth: 1,
                                      borderColor: tone.border,
                                      backgroundColor: tone.bg,
                                      paddingVertical: 7,
                                      paddingHorizontal: 10,
                                    }}
                                  >
                                    <Text style={{ color: tone.text, fontWeight: "800" }}>
                                      {prettyEventType(ev.event_type)} · {ev.value}
                                    </Text>
                                  </View>
                                );
                              })
                            ) : (
                              <Text style={{ color: "#9CA3AF" }}>Sense events</Text>
                            )}
                          </ScrollView>
                        </View>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "white", borderRadius: 16, padding: 16, maxHeight: "90%" }}>
            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Text style={{ fontSize: 20, fontWeight: "900", marginBottom: 12, color: "#111827" }}>
                Editar jugada {selectedPlay?.play_id}
              </Text>

              <View
                style={{
                  borderRadius: 14,
                  backgroundColor: "#F9FAFB",
                  borderWidth: 1,
                  borderColor: "#E5E7EB",
                  padding: 12,
                  marginBottom: 14,
                }}
              >
                <Text style={{ fontWeight: "900", color: "#111827" }}>Resum</Text>
                <Text style={{ marginTop: 6, color: "#374151", fontWeight: "700" }}>
                  Atacant: {selectedPlay?.attacker_name ?? "—"}
                </Text>
                <Text style={{ marginTop: 4, color: "#374151" }}>
                  Abans: +{currentContributionBefore.teamA} / +{currentContributionBefore.teamB}
                </Text>
                <Text style={{ marginTop: 4, color: "#374151" }}>
                  Després: +{currentContributionAfter.teamA} / +{currentContributionAfter.teamB}
                </Text>
              </View>

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 12,
                }}
              >
                <Text style={{ fontWeight: "800", color: "#111827" }}>Eliminat</Text>
                <Switch value={editEliminated} onValueChange={setEditEliminated} />
              </View>

              <Text style={{ fontWeight: "800", marginBottom: 6, color: "#111827" }}>Eliminat per</Text>
              <Pressable
                onPress={() => openPlayerPicker("eliminated_by")}
                style={{
                  borderWidth: 1,
                  borderColor: "#D1D5DB",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 12,
                  backgroundColor: "white",
                  marginBottom: 12,
                }}
              >
                <Text
                  style={{
                    fontWeight: "700",
                    color: editEliminatedByPlayerId ? "#111827" : "#6B7280",
                  }}
                >
                  {editEliminatedByPlayerId
                    ? playerNameById.get(Number(editEliminatedByPlayerId)) ??
                      `Player ${editEliminatedByPlayerId}`
                    : "Selecciona jugador"}
                </Text>
              </Pressable>

              {editEliminatedByPlayerId ? (
                <Pressable onPress={() => setEditEliminatedByPlayerId("")}>
                  <Text style={{ color: "#B91C1C", fontWeight: "800", marginBottom: 12 }}>
                    Netejar jugador seleccionat
                  </Text>
                </Pressable>
              ) : null}

              <Text style={{ fontWeight: "800", marginBottom: 8, color: "#111827" }}>Events</Text>

              {eventDrafts.map((draft, index) => {
                const tone = getEventTone(draft.event_type);

                return (
                  <View
                    key={draft.id}
                    style={{
                      borderWidth: 1,
                      borderColor: tone.border,
                      backgroundColor: tone.bg,
                      borderRadius: 14,
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: 10,
                      }}
                    >
                      <Text style={{ fontWeight: "900", color: tone.text }}>Event {index + 1}</Text>
                      <Pressable onPress={() => removeDraftEvent(draft.id)}>
                        <Text style={{ fontWeight: "800", color: "#B91C1C" }}>Eliminar</Text>
                      </Pressable>
                    </View>

                    <Text style={{ fontWeight: "800", marginBottom: 6, color: "#111827" }}>Tipus</Text>
                    <ScrollView
                      horizontal
                      nestedScrollEnabled
                      showsHorizontalScrollIndicator={false}
                      keyboardShouldPersistTaps="handled"
                      contentContainerStyle={{ gap: 8, marginBottom: 10, paddingRight: 8 }}
                    >
                      {EVENT_TYPES.map((type) => {
                        const active = draft.event_type === type;

                        return (
                          <Pressable
                            key={`${draft.id}-${type}`}
                            onPress={() => updateDraft(draft.id, { event_type: type })}
                            style={{
                              borderRadius: 999,
                              paddingVertical: 8,
                              paddingHorizontal: 12,
                              borderWidth: 1,
                              borderColor: active ? "#111827" : "#D1D5DB",
                              backgroundColor: active ? "#111827" : "white",
                            }}
                          >
                            <Text
                              style={{
                                fontWeight: "800",
                                color: active ? "white" : "#111827",
                              }}
                            >
                              {prettyEventType(type)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </ScrollView>

                    <Text style={{ fontWeight: "800", marginBottom: 6, color: "#111827" }}>Valor</Text>
                    <TextInput
                      value={draft.value}
                      onChangeText={(value) => updateDraft(draft.id, { value })}
                      keyboardType="numeric"
                      style={{
                        borderWidth: 1,
                        borderColor: "#D1D5DB",
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 10,
                        backgroundColor: "white",
                        marginBottom: 10,
                      }}
                    />

                    <Text style={{ fontWeight: "800", marginBottom: 6, color: "#111827" }}>
                      Jugador (opcional)
                    </Text>
                    <Pressable
                      onPress={() => openPlayerPicker("event_player", draft.id)}
                      style={{
                        borderWidth: 1,
                        borderColor: "#D1D5DB",
                        borderRadius: 12,
                        paddingHorizontal: 12,
                        paddingVertical: 12,
                        backgroundColor: "white",
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: "700",
                          color: draft.player_id ? "#111827" : "#6B7280",
                        }}
                      >
                        {draft.player_id
                          ? playerNameById.get(Number(draft.player_id)) ?? `Player ${draft.player_id}`
                          : "Selecciona jugador"}
                      </Text>
                    </Pressable>

                    {draft.player_id ? (
                      <Pressable onPress={() => updateDraft(draft.id, { player_id: "" })}>
                        <Text style={{ color: "#B91C1C", fontWeight: "800", marginTop: 8 }}>
                          Netejar jugador
                        </Text>
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}

              <Pressable
                onPress={addDraftEvent}
                style={{
                  borderWidth: 1,
                  borderColor: "#D1D5DB",
                  borderRadius: 12,
                  paddingVertical: 12,
                  alignItems: "center",
                  marginBottom: 14,
                  backgroundColor: "white",
                }}
              >
                <Text style={{ fontWeight: "900", color: "#111827" }}>＋ Afegir event</Text>
              </Pressable>

              <Text style={{ fontWeight: "800", marginBottom: 6, color: "#111827" }}>Motiu del canvi</Text>
              <TextInput
                value={reason}
                onChangeText={setReason}
                placeholder="Ex: corregir canes mal apuntades"
                style={{
                  borderWidth: 1,
                  borderColor: "#D1D5DB",
                  borderRadius: 12,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  backgroundColor: "white",
                }}
              />

              <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
                <Pressable
                  onPress={() => {
                    setEditOpen(false);
                    setPlayerPickerOpen(false);
                    setPlayerPickerMode(null);
                    setPickerDraftId(null);
                    setPickerPlayers([]);
                    setReopenEditAfterPicker(false);
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#D1D5DB",
                    alignItems: "center",
                  }}
                >
                  <Text style={{ fontWeight: "800" }}>Cancel·lar</Text>
                </Pressable>

                <Pressable
                  onPress={savePlayEdition}
                  disabled={saving}
                  style={{
                    flex: 1,
                    paddingVertical: 12,
                    borderRadius: 12,
                    backgroundColor: "#111827",
                    alignItems: "center",
                    opacity: saving ? 0.45 : 1,
                  }}
                >
                  {saving ? (
                    <ActivityIndicator color="white" />
                  ) : (
                    <Text style={{ color: "white", fontWeight: "900" }}>Guardar</Text>
                  )}
                </Pressable>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal
        visible={playerPickerOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          setPlayerPickerOpen(false);
          setPlayerPickerMode(null);
          setPickerDraftId(null);
          setPickerPlayers([]);

          if (reopenEditAfterPicker) {
            setTimeout(() => {
              setEditOpen(true);
              setReopenEditAfterPicker(false);
            }, 150);
          }
        }}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: "white", borderRadius: 16, padding: 16, maxHeight: "85%" }}>
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 12, color: "#111827" }}>
              Seleccionar jugador
            </Text>

            <Pressable
              onPress={() => applyPlayerSelection(null)}
              style={{
                borderWidth: 1,
                borderColor: "#FCA5A5",
                backgroundColor: "#FEF2F2",
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <Text style={{ fontWeight: "900", color: "#B91C1C" }}>Sense jugador</Text>
            </Pressable>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {Array.from(new Set(pickerPlayers.map((p) => p.teamId))).map((teamId) => {
                const teamName =
                  pickerPlayers.find((p) => p.teamId === teamId)?.teamName ?? `Equip ${teamId}`;
                const players = pickerPlayers.filter((p) => p.teamId === teamId);

                return (
                  <View key={teamId} style={{ marginBottom: 14 }}>
                    <Text style={{ fontWeight: "900", color: "#111827", marginBottom: 8 }}>
                      {teamName}
                    </Text>

                    {players.map((player) => (
                      <Pressable
                        key={player.playerId}
                        onPress={() => applyPlayerSelection(player.playerId)}
                        style={{
                          borderWidth: 1,
                          borderColor: "#E5E7EB",
                          borderRadius: 12,
                          paddingVertical: 12,
                          paddingHorizontal: 12,
                          marginBottom: 8,
                          backgroundColor: "white",
                        }}
                      >
                        <Text style={{ fontWeight: "800", color: "#111827" }}>
                          {displayPlayer(player)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                );
              })}
            </ScrollView>

            <Pressable
              onPress={() => {
                setPlayerPickerOpen(false);
                setPlayerPickerMode(null);
                setPickerDraftId(null);
                setPickerPlayers([]);

                if (reopenEditAfterPicker) {
                  setTimeout(() => {
                    setEditOpen(true);
                    setReopenEditAfterPicker(false);
                  }, 150);
                }
              }}
              style={{
                marginTop: 8,
                borderWidth: 1,
                borderColor: "#D1D5DB",
                borderRadius: 12,
                paddingVertical: 12,
                alignItems: "center",
              }}
            >
              <Text style={{ fontWeight: "800" }}>Tancar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
);
}
