import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Alert,
  ScrollView,
  Modal,
  TextInput,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../src/supabase";

type PlayerItem = {
  player_id: number;
  player_name: string;
  player_number: number;
  is_captain: boolean;
  external_code?: string | null;
};

type AddRole = "attack" | "defense";

type RoundRow = {
  round_id: number;
  match_round_number: number;
  turn: number;
  attacking_team_id: number;
  defending_team_id: number;
};

export default function LineupScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ matchId?: string; roundId?: string }>();
  const matchId = Number(params.matchId);
  const roundIdParam = params.roundId ? Number(params.roundId) : null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [roundRow, setRoundRow] = useState<RoundRow | null>(null);

  const [attackPlayers, setAttackPlayers] = useState<PlayerItem[]>([]);
  const [defensePlayers, setDefensePlayers] = useState<PlayerItem[]>([]);

  const [attackSelected, setAttackSelected] = useState<PlayerItem[]>([]);
  const [defenseSelectedIds, setDefenseSelectedIds] = useState<Set<number>>(new Set());

  const [championshipId, setChampionshipId] = useState<number | null>(null);

  // ✅ Capità per defecte (de team_player) i capità temporal per aquest partit (override)
  const [originalCaptainByTeam, setOriginalCaptainByTeam] = useState<Record<number, number | null>>({});
  const [captainOverrideByTeam, setCaptainOverrideByTeam] = useState<Record<number, number | null>>({});
  // ✅ Marcador en directe (global del match) per mostrar abans d'alinear (excepte Round 1 Torn 1)
  const [teamAName, setTeamAName] = useState<string>("");
  const [teamBName, setTeamBName] = useState<string>("");
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [scoreLoading, setScoreLoading] = useState(false);

  const [maxTeamPlayers, setMaxTeamPlayers] = useState<number>(16);

  // Add/Replace player UI
  const [addModalVisible, setAddModalVisible] = useState(false);
  const [addRole, setAddRole] = useState<AddRole>("attack");
  const [newPlayerName, setNewPlayerName] = useState("");
  const [teamForAdd, setTeamForAdd] = useState<number | null>(null);

  const [replaceModalVisible, setReplaceModalVisible] = useState(false);
  const [rosterForReplace, setRosterForReplace] = useState<PlayerItem[]>([]);
  const [replaceTargetPlayerId, setReplaceTargetPlayerId] = useState<number | null>(null);

  const [duplicateNameCount, setDuplicateNameCount] = useState<number>(0);

  const attackingTeamId = roundRow?.attacking_team_id as number | undefined;
  const defendingTeamId = roundRow?.defending_team_id as number | undefined;

  const roundTitle = useMemo(() => {
    if (!roundRow) return "";
    return `Round ${roundRow.match_round_number} · Torn ${roundRow.turn}`;
  }, [roundRow]);

  function displayName(p: PlayerItem) {
    return `${p.player_number} · ${p.player_name}${p.is_captain ? " (C)" : ""}`;
  }

  function enforceCaptainLast(list: PlayerItem[]) {
    const captainIdx = list.findIndex((p) => p.is_captain);
    if (captainIdx === -1) return list;
    if (captainIdx === list.length - 1) return list;

    const captain = list[captainIdx];
    const rest = list.filter((_, i) => i !== captainIdx);
    return [...rest, captain];
  }

  
  async function refreshScoreboardForMatch(matchIdNum: number, aId: number, bId: number) {
  setScoreLoading(true);
  try {
  const { data: rounds, error: rErr } = await supabase
  .from("v_rounds_by_match")
  .select("round_id, attacking_team_id, defending_team_id")
  .eq("match_id", matchIdNum);

  if (rErr) throw rErr;
  const list = rounds ?? [];
  if (!list.length) {
  setScoreA(0);
  setScoreB(0);
  return;
  }

  const roundMap = new Map<number, { atk: number; def: number }>();
  for (const r of list as any[]) {
  roundMap.set(r.round_id, { atk: r.attacking_team_id, def: r.defending_team_id });
  }

  const roundIds = (list as any[]).map((r) => r.round_id);

  const { data: plays, error: pErr } = await supabase
  .from("play")
  .select("id, round_id")
  .in("round_id", roundIds);

  if (pErr) throw pErr;

  const playRows = plays ?? [];
  if (!playRows.length) {
  setScoreA(0);
  setScoreB(0);
  return;
  }

  const playIdToRound = new Map<number, number>();
  const playIds: number[] = [];
  for (const p of playRows as any[]) {
  playIdToRound.set(p.id, p.round_id);
  playIds.push(p.id);
  }

  const { data: events, error: eErr } = await supabase
  .from("play_event")
  .select("play_id, event_type, value")
  .in("play_id", playIds);

  if (eErr) throw eErr;

  const totals = new Map<number, number>(); // team_id -> score
  for (const ev of (events ?? []) as any[]) {
  const rid = playIdToRound.get(ev.play_id);
  if (!rid) continue;
  const map = roundMap.get(rid);
  if (!map) continue;

  const v = typeof ev.value === "number" ? ev.value : 0;

  if (ev.event_type === "CANAS_SCORED") {
  totals.set(map.atk, (totals.get(map.atk) ?? 0) + v);
  } else if (ev.event_type === "TEAM_BONUS_CANAS") {
  totals.set(map.atk, (totals.get(map.atk) ?? 0) + v);
  } else if (ev.event_type === "DEFENDER_BONUS_CANAS") {
  totals.set(map.def, (totals.get(map.def) ?? 0) + v);
  }
  }

  setScoreA(totals.get(aId) ?? 0);
  setScoreB(totals.get(bId) ?? 0);
  } catch (e: any) {
  console.warn("refreshScoreboardForMatch error:", e?.message ?? e);
  } finally {
  setScoreLoading(false);
  }
  }

useEffect(() => {
    if (!matchId || Number.isNaN(matchId)) return;
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, roundIdParam]);

  
  async function pickNextRoundAction(
    matchIdNum: number
  ): Promise<{ action: "lineup" | "play"; round: RoundRow } | null> {
    const { data: rounds, error } = await supabase
      .from("v_rounds_by_match")
      .select("round_id, match_round_number, turn, attacking_team_id, defending_team_id")
      .eq("match_id", matchIdNum)
      .order("match_round_number", { ascending: true })
      .order("turn", { ascending: true });

    if (error || !rounds?.length) return null;

    for (const r of rounds) {
      const roundId = r.round_id as number;

      // 1) Quants atacants hi ha previstos a la lineup d'aquest round?
      const { count: attackCount, error: aErr } = await supabase
        .from("round_lineup")
        .select("id", { count: "exact", head: true })
        .eq("round_id", roundId)
        .eq("role", "attack");

      // Si hi ha error, no ens arrisquem: saltem a següent (o bloquegem més tard).
      if (aErr) continue;

      const expected = attackCount ?? 0;

      // Si encara NO hi ha lineup d'atacants, aquest round és editable (cal fer lineup).
      if (expected === 0) {
        return {
          action: "lineup",
          round: {
            round_id: roundId,
            match_round_number: r.match_round_number,
            turn: r.turn,
            attacking_team_id: r.attacking_team_id,
            defending_team_id: r.defending_team_id,
          },
        };
      }

      // 2) Quants plays hi ha creats (un per atacant) dins d'aquest round?
      const { data: plays, error: pErr } = await supabase
        .from("play")
        .select("id, attacker_player_id")
        .eq("round_id", roundId);

      if (pErr) continue;

      const playIds = (plays ?? []).map((p: any) => p.id).filter((x: any) => typeof x === "number") as number[];
      const attackersWithPlay = new Set<number>(
        (plays ?? [])
          .map((p: any) => p.attacker_player_id)
          .filter((x: any) => typeof x === "number") as number[]
      );

      // Si no hi ha cap play encara, però hi ha lineup, el round està llest per començar:
      // NO deixem editar lineup (ja hi ha lineup) però hem d'anar a PLAY, no avançar torn.
      if (playIds.length === 0) {
        return {
          action: "play",
          round: {
            round_id: roundId,
            match_round_number: r.match_round_number,
            turn: r.turn,
            attacking_team_id: r.attacking_team_id,
            defending_team_id: r.defending_team_id,
          },
        };
      }

      // 3) Verifiquem que cada play té com a mínim 1 play_event (si l'app es tanca a mig guardat)
      let playsWithEvent = new Set<number>();
      if (playIds.length > 0) {
        const { data: ev, error: evErr } = await supabase
          .from("play_event")
          .select("play_id")
          .in("play_id", playIds);

        if (!evErr) {
          playsWithEvent = new Set<number>(
            (ev ?? []).map((e: any) => e.play_id).filter((x: any) => typeof x === "number") as number[]
          );
        }
      }

      const anyMissingEvent = playIds.some((pid) => !playsWithEvent.has(pid));

      // Round "in progress" si:
      // - falta algun atacant per tirar, o
      // - hi ha alguna play sense events (guardat a mitges)
      if (attackersWithPlay.size < expected || anyMissingEvent) {
        return {
          action: "play",
          round: {
            round_id: roundId,
            match_round_number: r.match_round_number,
            turn: r.turn,
            attacking_team_id: r.attacking_team_id,
            defending_team_id: r.defending_team_id,
          },
        };
      }

      // Si arribem aquí, el round està complet: continuem buscant el següent.
    }

    return null;
  }

  async function init() {
    setLoading(true);

    const { data: sessionRes } = await supabase.auth.getSession();
    if (!sessionRes.session?.user) {
      router.replace("/login");
      return;
    }

    // Si el match està finalitzat, no deixem editar
    const { data: matchRow, error: matchErr } = await supabase
      .from("match")
      .select("id, championship_id, is_finished, team_a_id, team_b_id, team_a:team_a_id(name), team_b:team_b_id(name)")
      .eq("id", matchId)
      .single();

    if (matchErr || !matchRow) {
      Alert.alert("Error", "No s'ha pogut carregar el match.");
      setLoading(false);
      return;
    }

    if (matchRow.is_finished) {
      Alert.alert("Partit finalitzat", "Aquest partit ja està tancat i no es pot modificar.");
      router.back();
      return;
    }

    setChampionshipId(matchRow.championship_id);

    setTeamAId(matchRow.team_a_id ?? null);
    setTeamBId(matchRow.team_b_id ?? null);
    setTeamAName(matchRow.team_a?.name ?? "Equip A");
    setTeamBName(matchRow.team_b?.name ?? "Equip B");

    const { data: cfg } = await supabase
      .from("championship_config")
      .select("value")
      .eq("championship_id", matchRow.championship_id)
      .eq("key", "max_team_players")
      .limit(1)
      .maybeSingle();

    if (cfg?.value) {
      const parsed = parseInt(cfg.value, 10);
      if (!Number.isNaN(parsed) && parsed > 0) setMaxTeamPlayers(parsed);
    }

    let rr: RoundRow | null = null;

    if (roundIdParam) {
      const { data: r1 } = await supabase
        .from("v_rounds_by_match")
        .select("round_id, match_round_number, turn, attacking_team_id, defending_team_id")
        .eq("match_id", matchId)
        .eq("round_id", roundIdParam)
        .limit(1);

      if (r1?.length) {
        rr = {
          round_id: r1[0].round_id,
          match_round_number: r1[0].match_round_number,
          turn: r1[0].turn,
          attacking_team_id: r1[0].attacking_team_id,
          defending_team_id: r1[0].defending_team_id,
        };
      }
    }

    let nextAction: { action: "lineup" | "play"; round: RoundRow } | null = null;
    if (!rr) nextAction = await pickNextRoundAction(matchId);

    if (!rr && nextAction?.action === "play") {
      // Hi ha un torn en curs (o guardat a mitges). La lineup ja no és editable: cal continuar a Play.
      setLoading(false);
      router.replace({
        pathname: "/play",
        params: { matchId: String(matchId), roundId: String(nextAction.round.round_id) },
      });
      return;
    }

    if (!rr && nextAction?.action === "lineup") {
      rr = nextAction.round;
    }

    if (!rr) {
      Alert.alert(
        "Lineup bloquejada",
        "Aquest partit ja té tirades registrades. No es pot tornar a editar la lineup."
      );
      setLoading(false);
      router.replace({ pathname: "/play", params: { matchId: String(matchId) } });
      return;
    }

    setRoundRow(rr);


    // ✅ Mostrem marcador només si NO és Round 1 Torn 1
    if (!(rr.match_round_number === 1 && rr.turn === 1) && matchRow.team_a_id && matchRow.team_b_id) {
      await refreshScoreboardForMatch(matchId, matchRow.team_a_id, matchRow.team_b_id);
    }


    const loaded = await loadPlayersForTeams(
      rr.attacking_team_id,
      rr.defending_team_id,
      matchRow.championship_id
    );
    if (loaded.ok) {
      await loadCaptainOverridesForMatch(rr.attacking_team_id, rr.defending_team_id, loaded.attackList, loaded.defenseList);
      await loadExistingLineup(rr.round_id, loaded.attackList, loaded.defenseList);
    }

    setLoading(false);
  }

  async function loadPlayersForTeams(attTeamId: number, defTeamId: number, champId: number): Promise<{
    ok: boolean;
    attackList: PlayerItem[];
    defenseList: PlayerItem[];
  }> {
    const { data: att, error: attErr } = await supabase
      .from("team_player")
      .select("player_id, player_number, is_captain, player:player_id(name, external_code)")
      .eq("team_id", attTeamId)
      // A team can have different rosters per championship.
      // Only show players from the current match's championship.
      .eq("championship_id", champId);

    if (attErr) {
      Alert.alert("Error", `No s'han pogut carregar atacants: ${attErr.message}`);
      return { ok: false, attackList: [], defenseList: [] };
    }

    const attList: PlayerItem[] =
      (att ?? []).map((x: any) => ({
        player_id: x.player_id,
        player_number: x.player_number,
        is_captain: !!x.is_captain,
        player_name: x.player?.name ?? `#${x.player_id}`,
        external_code: x.player?.external_code ?? null,
      })) ?? [];

    const { data: def, error: defErr } = await supabase
      .from("team_player")
      .select("player_id, player_number, is_captain, player:player_id(name, external_code)")
      .eq("team_id", defTeamId)
      .eq("championship_id", champId);

    if (defErr) {
      Alert.alert("Error", `No s'han pogut carregar defensors: ${defErr.message}`);
      return { ok: false, attackList: [], defenseList: [] };
    }

    const defList: PlayerItem[] =
      (def ?? []).map((x: any) => ({
        player_id: x.player_id,
        player_number: x.player_number,
        is_captain: !!x.is_captain,
        player_name: x.player?.name ?? `#${x.player_id}`,
        external_code: x.player?.external_code ?? null,
      })) ?? [];

    attList.sort((a, b) => a.player_number - b.player_number);
    defList.sort((a, b) => a.player_number - b.player_number);

    setAttackPlayers(attList);
    setDefensePlayers(defList);

    
    return { ok: true, attackList: attList, defenseList: defList };
  }

  async function loadCaptainOverridesForMatch(attTeamId: number, defTeamId: number, attackList: PlayerItem[], defenseList: PlayerItem[]) {
    // Capità per defecte (de team_player)
    const attDefault = attackList.find((p) => p.is_captain)?.player_id ?? null;
    const defDefault = defenseList.find((p) => p.is_captain)?.player_id ?? null;
    setOriginalCaptainByTeam({ [attTeamId]: attDefault, [defTeamId]: defDefault });

    // Si no tenim matchId, no fem overrides
    if (!Number.isFinite(matchId)) return;

    const { data, error } = await supabase
      .from("match_captain_override")
      .select("team_id, player_id")
      .eq("match_id", matchId)
      .in("team_id", [attTeamId, defTeamId]);

    if (error) return;

    const overrides: Record<number, number | null> = {};
    for (const row of data ?? []) {
      overrides[(row as any).team_id] = (row as any).player_id;
    }
    setCaptainOverrideByTeam(overrides);

    // Apliquem override (si existeix) només per aquest match
    const attOverride = overrides[attTeamId] ?? null;
    const defOverride = overrides[defTeamId] ?? null;

    if (attOverride) {
      const nextAttack = attackList.map((p) => ({ ...p, is_captain: p.player_id === attOverride }));
      setAttackPlayers(nextAttack);
      setAttackSelected((prev) => prev.map((p) => ({ ...p, is_captain: p.player_id === attOverride })));
    }
    if (defOverride) {
      const nextDefense = defenseList.map((p) => ({ ...p, is_captain: p.player_id === defOverride }));
      setDefensePlayers(nextDefense);
    }
  }

  function applyCaptainToState(teamId: number, role: AddRole, playerId: number | null) {
    if (role === "attack") {
      setAttackPlayers((prev) => prev.map((p) => ({ ...p, is_captain: playerId ? p.player_id === playerId : p.player_id === (originalCaptainByTeam[teamId] ?? -1) })));
      setAttackSelected((prev) => prev.map((p) => ({ ...p, is_captain: playerId ? p.player_id === playerId : p.player_id === (originalCaptainByTeam[teamId] ?? -1) })));
    } else {
      setDefensePlayers((prev) => prev.map((p) => ({ ...p, is_captain: playerId ? p.player_id === playerId : p.player_id === (originalCaptainByTeam[teamId] ?? -1) })));
    }
  }
const canEditCaptain = useMemo(() => {
  if (!roundRow) return false;
  return roundRow.match_round_number === 1 && roundRow.turn === 1;
}, [roundRow]);

  function showCaptainDialog(teamId: number, role: AddRole, player: PlayerItem) {
    if (!teamId || !Number.isFinite(teamId)) return;
    const doShow = () => {
      const currentOverride = captainOverrideByTeam[teamId] ?? null;
      const isCurrentOverride = currentOverride === player.player_id;

      const buttons: any[] = [
        { text: "Cancel·lar", style: "cancel" },
      ];

      if (isCurrentOverride) {
        buttons.unshift({
          text: "Restaurar capità per defecte",
          style: "destructive",
          onPress: async () => {
            await supabase
              .from("match_captain_override")
              .delete()
              .eq("match_id", matchId)
              .eq("team_id", teamId);

            setCaptainOverrideByTeam((prev) => ({ ...prev, [teamId]: null }));
            applyCaptainToState(teamId, role, null);
          },
        });
      } else {
        buttons.unshift({
          text: "Fer capità del partit",
          onPress: async () => {
            await supabase
              .from("match_captain_override")
              .upsert({ match_id: matchId, team_id: teamId, player_id: player.player_id });

            setCaptainOverrideByTeam((prev) => ({ ...prev, [teamId]: player.player_id }));
            applyCaptainToState(teamId, role, player.player_id);
          },
        });
      }

      Alert.alert("Capità del partit", `Vols posar ${player.player_name} com a capità per aquest partit?`, buttons);
    };

    // Android: defer per evitar que el gesture “s'empassi” l'alert dins ScrollView
    Platform.OS === "android" ? setTimeout(doShow, 0) : doShow();
  }

  async function loadExistingLineup(roundId: number, attackList: PlayerItem[], defenseList: PlayerItem[]) {
    const { data: lineup, error } = await supabase
      .from("round_lineup")
      .select("player_id, role, order_in_role")
      .eq("round_id", roundId);

    if (error) return;

    const map = new Map<number, PlayerItem>();
    for (const p of [...attackList, ...defenseList]) map.set(p.player_id, p);

    const attacksRaw = (lineup ?? [])
      .filter((x: any) => x.role === "attack")
      .sort((a: any, b: any) => (a.order_in_role ?? 999) - (b.order_in_role ?? 999))
      .map((x: any) => map.get(x.player_id))
      .filter(Boolean) as PlayerItem[];

    const attacks = enforceCaptainLast(attacksRaw);

    const defIds = new Set<number>(
      (lineup ?? []).filter((x: any) => x.role === "defense").map((x: any) => x.player_id)
    );

    setAttackSelected(attacks);
    setDefenseSelectedIds(defIds);
  }

  function toggleDefense(playerId: number) {
    setDefenseSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(playerId)) {
        next.delete(playerId);
        return next;
      }
      if (next.size >= 8) {
        Alert.alert("Límit", "Només pots seleccionar 8 defensors.");
        return next;
      }
      next.add(playerId);
      return next;
    });
  }

  function addAttack(p: PlayerItem) {
    setAttackSelected((prev) => {
      if (prev.some((x) => x.player_id === p.player_id)) return prev;
      if (prev.length >= 6) {
        Alert.alert("Límit", "Només pots seleccionar 6 atacants.");
        return prev;
      }

      if (p.is_captain) {
        const next = [...prev, p];
        return enforceCaptainLast(next);
      }

      const capIdx = prev.findIndex((x) => x.is_captain);
      if (capIdx !== -1) {
        const before = prev.slice(0, capIdx);
        const captain = prev[capIdx];
        const after = prev.slice(capIdx + 1);
        return [...before, p, ...after, captain];
      }

      return [...prev, p];
    });
  }

  function removeAttack(playerId: number) {
    setAttackSelected((prev) => prev.filter((x) => x.player_id !== playerId));
  }

  // ==== Afegir jugadors (mateixa lògica que tens) ====
  async function getTeamRoster(teamId: number): Promise<PlayerItem[]> {
    const { data, error } = await supabase
      .from("team_player")
      .select("player_id, player_number, is_captain, player:player_id(name, external_code)")
      .eq("team_id", teamId);

    if (error) throw error;

    const list: PlayerItem[] =
      (data ?? []).map((x: any) => ({
        player_id: x.player_id,
        player_number: x.player_number,
        is_captain: !!x.is_captain,
        player_name: x.player?.name ?? `#${x.player_id}`,
        external_code: x.player?.external_code ?? null,
      })) ?? [];

    list.sort((a, b) => a.player_number - b.player_number);
    return list;
  }

  async function canRemovePlayerEverywhere(playerId: number): Promise<boolean> {
    const { data: rl, error: rlErr } = await supabase
      .from("round_lineup")
      .select("id")
      .eq("player_id", playerId)
      .limit(1);

    if (rlErr) throw rlErr;
    if ((rl?.length ?? 0) > 0) return false;

    const { data: pl, error: plErr } = await supabase
      .from("play")
      .select("id")
      .or(`attacker_player_id.eq.${playerId},eliminated_by_player_id.eq.${playerId}`)
      .limit(1);

    if (plErr) throw plErr;
    if ((pl?.length ?? 0) > 0) return false;

    const { data: pe, error: peErr } = await supabase
      .from("play_event")
      .select("id")
      .eq("player_id", playerId)
      .limit(1);

    if (peErr) throw peErr;
    if ((pe?.length ?? 0) > 0) return false;

    return true;
  }

  function openAddPlayer(role: AddRole) {
    const teamId = role === "attack" ? attackingTeamId : defendingTeamId;
    if (!teamId) {
      Alert.alert("Error", "No s'ha pogut detectar l'equip.");
      return;
    }
    setAddRole(role);
    setTeamForAdd(teamId);
    setNewPlayerName("");
    setReplaceTargetPlayerId(null);
    setDuplicateNameCount(0);
    setAddModalVisible(true);
  }

  async function searchExistingInChampionship(q: string) {
    if (!championshipId) return;
    const term = q.trim();
    if (term.length < 2) {
      setDuplicateNameCount(0);
      return;
    }

    const { data, error } = await supabase
      .from("team_player")
      .select("player:player_id(id, name)")
      .eq("championship_id", championshipId)
      .ilike("player.name", `%${term}%`)
      .limit(50);

    if (error) {
      setDuplicateNameCount(0);
      return;
    }

    const exact = (data ?? []).filter(
      (r: any) => (r.player?.name ?? "").trim().toLowerCase() === term.toLowerCase()
    );

    const ids = new Set<number>();
    for (const r of exact) {
      const id = r.player?.id;
      if (typeof id === "number") ids.add(id);
    }

    setDuplicateNameCount(ids.size);
  }

  async function submitAddOrReplace() {
    if (!teamForAdd || !championshipId) {
      Alert.alert("Error", "Falten dades de campionat/equip.");
      return;
    }

    const name = newPlayerName.trim();
    if (name.length < 2) {
      Alert.alert("Nom invàlid", "Introdueix un nom de jugador.");
      return;
    }

    setSaving(true);
    try {
      const roster = await getTeamRoster(teamForAdd);

      let playerNumber =
        roster.length === 0 ? 1 : Math.max(...roster.map((p) => p.player_number)) + 1;

      if (roster.length >= maxTeamPlayers) {
        if (!replaceTargetPlayerId) {
          setRosterForReplace(roster);
          // iOS: if the "Add player" modal is still visible, a second modal may not appear.
          // Close it first, then open the replacement modal on the next tick.
          setAddModalVisible(false);
          setSaving(false);
          setTimeout(() => setReplaceModalVisible(true), 50);
          return;
        }

        const ok = await canRemovePlayerEverywhere(replaceTargetPlayerId);
        if (!ok) {
          Alert.alert("No es pot substituir", "Aquest jugador ja té dades relacionades. No es pot canviar.");
          setSaving(false);
          return;
        }

        const replaced = roster.find((p) => p.player_id === replaceTargetPlayerId);
        if (!replaced) {
          Alert.alert("Error", "No s'ha pogut trobar el jugador a substituir.");
          setSaving(false);
          return;
        }

        playerNumber = replaced.player_number;

        const { error: delErr } = await supabase
          .from("team_player")
          .delete()
          .eq("championship_id", championshipId)
          .eq("team_id", teamForAdd)
          .eq("player_id", replaceTargetPlayerId);

        if (delErr) throw delErr;

        setAttackSelected((prev) => prev.filter((x) => x.player_id !== replaceTargetPlayerId));
        setDefenseSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(replaceTargetPlayerId);
          return next;
        });
      }

      const { data: sameNameRows, error: snErr } = await supabase
        .from("team_player")
        .select("player:player_id(id, name)")
        .eq("championship_id", championshipId)
        .ilike("player.name", name);

      if (snErr) throw snErr;

      const sameNameInChampionship = (sameNameRows ?? []).some(
        (r: any) => (r.player?.name ?? "").trim().toLowerCase() === name.toLowerCase()
      );

      const externalCode = sameNameInChampionship
        ? `CH${championshipId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`
        : null;

      const { data: newPlayer, error: pErr } = await supabase
        .from("player")
        .insert({ name, external_code: externalCode })
        .select("id")
        .single();

      if (pErr || !newPlayer) throw pErr ?? new Error("No s'ha pogut crear el player");

      const { error: tpErr } = await supabase.from("team_player").insert({
        championship_id: championshipId,
        team_id: teamForAdd,
        player_id: newPlayer.id,
        player_number: playerNumber,
        is_captain: false,
      });

      if (tpErr) throw tpErr;

      if (attackingTeamId && defendingTeamId) {
        const loaded2 = await loadPlayersForTeams(attackingTeamId, defendingTeamId, championshipId);
        if (loaded2.ok) {
          await loadCaptainOverridesForMatch(attackingTeamId, defendingTeamId, loaded2.attackList, loaded2.defenseList);
        }
      }

      setAddModalVisible(false);
      setReplaceModalVisible(false);
      setReplaceTargetPlayerId(null);
      Alert.alert("Fet ✅", sameNameInChampionship ? "Jugador creat (amb external_code)." : "Jugador creat.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error afegint/substituint jugador.");
    } finally {
      setSaving(false);
    }
  }

  async function saveLineup(): Promise<boolean> {
    if (!roundRow) return false;
    if (!attackingTeamId || !defendingTeamId) {
      Alert.alert("Error", "Falten equips d'atac/defensa al round.");
      return false;
    }

    const enforced = enforceCaptainLast(attackSelected);

    if (enforced.length < 4) {
      Alert.alert("Falten atacants", "Has de seleccionar mínim 4 atacants.");
      return false;
    }

    if (defenseSelectedIds.size < 4) {
      Alert.alert("Falten defensors", "Has de seleccionar mínim 4 defensors.");
      return false;
    }

    if (defenseSelectedIds.size > 8) {
      Alert.alert("Massa defensors", "Pots seleccionar com a màxim 8 defensors.");
      return false;
    }


    setSaving(true);
    try {
      const { error: delErr } = await supabase
        .from("round_lineup")
        .delete()
        .eq("round_id", roundRow.round_id);
      if (delErr) throw delErr;

      const attackRows = enforced.map((p, idx) => ({
        round_id: roundRow.round_id,
        team_id: attackingTeamId,
        player_id: p.player_id,
        role: "attack",
        order_in_role: idx + 1,
      }));

      const defenseRows = Array.from(defenseSelectedIds).map((pid) => ({
        round_id: roundRow.round_id,
        team_id: defendingTeamId,
        player_id: pid,
        role: "defense",
        order_in_role: null,
      }));

      const { error: insErr } = await supabase
        .from("round_lineup")
        .insert([...attackRows, ...defenseRows]);
      if (insErr) throw insErr;

      setAttackSelected(enforced);
      Alert.alert("Guardat ✅", "Alineació guardada correctament.");
      return true;
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error guardant l'alineació.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleArbitrar() {
    const ok = await saveLineup();
    if (!ok || !roundRow) return;

    router.push({
      pathname: "/play",
      params: { matchId: String(matchId), roundId: String(roundRow.round_id) },
    });
  }

  if (loading || !roundRow) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const captainCardStyle = { borderColor: "#2e86de", backgroundColor: "#eaf3ff" };

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <Pressable
          onPress={() => {
            if (Number.isNaN(matchId) || !matchId) {
              router.back();
              return;
            }
            router.replace({ pathname: "/match", params: { id: String(matchId) } });
          }}
          style={{
            alignSelf: "flex-start",
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "#ccc",
            marginBottom: 12,
          }}
        >
          <Text style={{ fontWeight: "600" }}>← Tornar</Text>
        </Pressable>

        
        {/* ✅ Marcador (només si NO és Round 1 Torn 1) */}
        {roundRow && !(roundRow.match_round_number === 1 && roundRow.turn === 1) ? (
          <View
            style={{
              marginBottom: 12,
              padding: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#e5e5e5",
              backgroundColor: "white",
            }}
          >
            <Text style={{ textAlign: "center", fontWeight: "900", fontSize: 16 }}>
              Marcador
            </Text>

            {scoreLoading ? (
              <ActivityIndicator style={{ marginTop: 10 }} />
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text numberOfLines={1} style={{ fontWeight: "800" }}>
                      {teamAName}
                    </Text>
                  </View>

                  <Text style={{ fontSize: 20, fontWeight: "900" }}>
                    {scoreA} - {scoreB}
                  </Text>

                  <View style={{ flex: 1, paddingLeft: 8, alignItems: "flex-end" }}>
                    <Text numberOfLines={1} style={{ fontWeight: "800" }}>
                      {teamBName}
                    </Text>
                  </View>
                </View>

                <Text
                  style={{
                    marginTop: 8,
                    textAlign: "center",
                    fontWeight: "500",
                    fontSize: 12,
                  }}
                >
                  Diferència: {Math.abs(scoreA - scoreB)}
                </Text>
              </>
            )}
          </View>
        ) : null}

        <Text style={{ fontSize: 20, fontWeight: "bold", textAlign: "center" }}>
          Alineació
        </Text>

        <Text style={{ textAlign: "center", color: "#666", marginTop: 6 }}>
          {roundTitle} · Max jugadors/equip: {maxTeamPlayers}
        </Text>

        <View style={{ height: 18 }} />

        {/* ATACANTS */}
        <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", backgroundColor: "#fafafa" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 16 }}>Atacants (4-6) · amb ordre</Text>

            <Pressable
              disabled={saving}
              onPress={() => openAddPlayer("attack")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#ccc",
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text style={{ fontWeight: "700" }}>+ Jugador</Text>
            </Pressable>
          </View>

          <Text style={{ marginTop: 6, color: "#666" }}>Si selecciones el capità (C), sempre quedarà últim.</Text>

          <View style={{ height: 12 }} />

          <Text style={{ fontWeight: "700" }}>Seleccionats:</Text>
          {attackSelected.length === 0 ? (
            <Text style={{ color: "#777", marginTop: 6 }}>Encara no n'has seleccionat cap.</Text>
          ) : (
            enforceCaptainLast(attackSelected).map((p, idx) => (
              <Pressable
                key={`${attackingTeamId ?? "atk"}-${p.player_id}`}
                onPress={() => removeAttack(p.player_id)}
                style={{
                  marginTop: 8,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: p.is_captain ? captainCardStyle.borderColor : "#d6eadf",
                  backgroundColor: p.is_captain ? captainCardStyle.backgroundColor : "#e6f7ed",
                }}
              >
                <Text style={{ fontWeight: "700" }}>
                  {idx + 1}. {displayName(p)} <Text style={{ fontWeight: "400" }}>(toca per treure)</Text>
                </Text>
              </Pressable>
            ))
          )}

          <View style={{ height: 14 }} />

          <Text style={{ fontWeight: "700" }}>Disponibles:</Text>

{attackPlayers.map((p) => {
  const selected = attackSelected.some((x) => x.player_id === p.player_id);
  return (
    <Pressable
      key={`${attackingTeamId ?? "atk"}-${p.player_id}`}
      onPress={() => addAttack(p)}
      onLongPress={
        canEditCaptain
          ? () => showCaptainDialog(roundRow?.attacking_team_id ?? 0, "attack", p)
          : undefined
      }
      delayLongPress={350}
      style={{
        marginTop: 8,
        padding: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: selected ? "#bbb" : p.is_captain ? captainCardStyle.borderColor : "#ddd",
        backgroundColor: selected ? "#f0f0f0" : p.is_captain ? captainCardStyle.backgroundColor : "white",
        opacity: selected ? 0.6 : 1,
      }}
    >
      <Text style={{ fontWeight: "600" }}>
        {displayName(p)} {selected ? "(seleccionat)" : ""}
      </Text>
    </Pressable>
  );
})}

{/* Info només quan NO es pot canviar capità */}
{!canEditCaptain ? (
  <Text style={{ marginTop: 10, color: "#6B7280", fontWeight: "700" }}>
    ℹ️ El capità només es pot canviar a Ronda 1 · Torn 1.
  </Text>
) : null}

        </View>

        <View style={{ height: 16 }} />

        {/* DEFENSORS */}
        <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: "#ddd", backgroundColor: "#fafafa" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 16 }}>Defensors (4-8)</Text>

            <Pressable
              disabled={saving}
              onPress={() => openAddPlayer("defense")}
              style={{
                paddingVertical: 8,
                paddingHorizontal: 10,
                borderRadius: 10,
                borderWidth: 1,
                borderColor: "#ccc",
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Text style={{ fontWeight: "700" }}>+ Jugador</Text>
            </Pressable>
          </View>

          <Text style={{ marginTop: 6, color: "#666" }}>Selecciona exactament 8 (tap per marcar/desmarcar).</Text>

          <Text style={{ marginTop: 10, fontWeight: "700" }}>Seleccionats: {defenseSelectedIds.size}/8</Text>

          {defensePlayers.map((p) => {
            const selected = defenseSelectedIds.has(p.player_id);
            return (
              <Pressable
                key={`${defendingTeamId ?? "def"}-${p.player_id}`}
                onPress={() => toggleDefense(p.player_id)}
                onLongPress={
  canEditCaptain
    ? () => showCaptainDialog(roundRow?.defending_team_id ?? 0, "defense", p)
    : undefined
}
delayLongPress={350}
                style={{
                  marginTop: 8,
                  padding: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: selected ? "#f1c40f" : p.is_captain ? captainCardStyle.borderColor : "#ddd",
                  backgroundColor: selected ? "#fff8db" : p.is_captain ? captainCardStyle.backgroundColor : "white",
                }}
              >
                <Text style={{ fontWeight: "600" }}>
                  {displayName(p)} {selected ? "✅" : ""}
                </Text>
              </Pressable>
            );
          })}
{!canEditCaptain ? (
  <Text style={{ marginTop: 10, color: "#6B7280", fontWeight: "700" }}>
    ℹ️ El capità només es pot canviar a Ronda 1 · Torn 1.
  </Text>
) : null}
        </View>

        <View style={{ height: 18 }} />

        <Pressable
          disabled={saving}
          onPress={handleArbitrar}
          style={{
            paddingVertical: 14,
            borderRadius: 12,
            alignItems: "center",
            backgroundColor: "#111",
            opacity: saving ? 0.7 : 1,
          }}
        >
          <Text style={{ color: "white", fontWeight: "800" }}>{saving ? "Guardant..." : "Arbitrar"}</Text>
        </Pressable>
      </ScrollView>

      {/* MODAL: Afegir */}
      <Modal visible={addModalVisible} transparent animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 18 }}>
          <View style={{ backgroundColor: "white", borderRadius: 14, padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "800" }}>
              Afegir jugador ({addRole === "attack" ? "Atacants" : "Defensors"})
            </Text>

            <Text style={{ marginTop: 8, color: "#666" }}>
              Escriu el nom. Si ja existeix al campionat, el crearem igualment amb un external_code únic per diferenciar-lo.
            </Text>

            <Text style={{ marginTop: 12, fontWeight: "700" }}>Nom del jugador</Text>
            <TextInput
              value={newPlayerName}
              onChangeText={(t) => {
                setNewPlayerName(t);
                searchExistingInChampionship(t);
              }}
              placeholder="Ex: Joan Garcia"
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 10,
                padding: 12,
                marginTop: 8,
              }}
            />

            {duplicateNameCount > 0 ? (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontWeight: "700" }}>⚠️ Ja existeix al campionat</Text>
                <Text style={{ color: "#666", marginTop: 4 }}>
                  S'han trobat {duplicateNameCount} jugador(s) amb aquest mateix nom al campionat. Es crearà un nou jugador amb un external_code únic.
                </Text>
              </View>
            ) : null}

            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 14 }}>
              <Pressable
                onPress={() => {
                  setAddModalVisible(false);
                  setReplaceModalVisible(false);
                  setReplaceTargetPlayerId(null);
                  setDuplicateNameCount(0);
                }}
                style={{ paddingVertical: 10, paddingHorizontal: 12 }}
              >
                <Text style={{ fontWeight: "700" }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                disabled={saving}
                onPress={submitAddOrReplace}
                style={{
                  marginLeft: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#111",
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "800" }}>{saving ? "..." : "Crear nou"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* MODAL: Triar jugador a substituir */}
      <Modal visible={replaceModalVisible} transparent animationType="fade" onRequestClose={() => setReplaceModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 18 }}>
          <View style={{ backgroundColor: "white", borderRadius: 14, padding: 16, maxHeight: "80%" }}>
            <Text style={{ fontSize: 16, fontWeight: "800" }}>Equip ple ({maxTeamPlayers})</Text>
            <Text style={{ marginTop: 8, color: "#666" }}>
              Tria quin jugador vols substituir (només si no té dades relacionades).
            </Text>

            <ScrollView style={{ marginTop: 10 }}>
              {rosterForReplace.map((p) => {
                const selected = replaceTargetPlayerId === p.player_id;
                return (
                  <Pressable
                    key={`${teamForAdd ?? "team"}-${p.player_id}`}
                    onPress={() => setReplaceTargetPlayerId(p.player_id)}
                    style={{
                      padding: 10,
                      borderRadius: 10,
                      borderWidth: 1,
                      borderColor: selected ? "#111" : "#ddd",
                      backgroundColor: selected ? "#f0f0f0" : "white",
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "700" }}>
                      {p.player_number} · {p.player_name} {p.is_captain ? "(C) " : ""}{selected ? "✅" : ""}
                    </Text>
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={{ flexDirection: "row", justifyContent: "flex-end", marginTop: 10 }}>
              <Pressable
                onPress={() => {
                  setReplaceModalVisible(false);
                  setReplaceTargetPlayerId(null);
                }}
                style={{ paddingVertical: 10, paddingHorizontal: 12 }}
              >
                <Text style={{ fontWeight: "700" }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                disabled={saving || !replaceTargetPlayerId}
                onPress={async () => {
                  setReplaceModalVisible(false);
                  await submitAddOrReplace();
                }}
                style={{
                  marginLeft: 10,
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: "#111",
                  opacity: saving || !replaceTargetPlayerId ? 0.5 : 1,
                }}
              >
                <Text style={{ fontWeight: "800" }}>Substituir</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}
