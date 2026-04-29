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
import { useAppTheme } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";
import { BackButton } from "@/components/HeaderButtons";

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

  const { colors } = useAppTheme();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [roundRow, setRoundRow] = useState<RoundRow | null>(null);

  const [attackPlayers, setAttackPlayers] = useState<PlayerItem[]>([]);
  const [defensePlayers, setDefensePlayers] = useState<PlayerItem[]>([]);

  const [attackSelected, setAttackSelected] = useState<PlayerItem[]>([]);
  const [defenseSelectedIds, setDefenseSelectedIds] = useState<Set<number>>(new Set());

  const [championshipId, setChampionshipId] = useState<number | null>(null);
  const [matchPhaseId, setMatchPhaseId] = useState<number | null>(null);

  const [originalCaptainByTeam, setOriginalCaptainByTeam] = useState<Record<number, number | null>>({});
  const [captainOverrideByTeam, setCaptainOverrideByTeam] = useState<Record<number, number | null>>({});

  const [teamAName, setTeamAName] = useState<string>("");
  const [teamBName, setTeamBName] = useState<string>("");
  const [teamAId, setTeamAId] = useState<number | null>(null);
  const [teamBId, setTeamBId] = useState<number | null>(null);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);
  const [scoreLoading, setScoreLoading] = useState(false);

  const [maxTeamPlayers, setMaxTeamPlayers] = useState<number>(16);

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
    return `${t("matchSummary.round")} ${roundRow.match_round_number} · ${t("matchSummary.turn")} ${roundRow.turn}`;
  }, [roundRow, t]);

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

      const totals = new Map<number, number>();
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

      const { count: attackCount, error: aErr } = await supabase
        .from("round_lineup")
        .select("id", { count: "exact", head: true })
        .eq("round_id", roundId)
        .eq("role", "attack");

      if (aErr) continue;

      const expected = attackCount ?? 0;

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

    const { data: matchRow, error: matchErr } = await supabase
      .from("match")
      .select("id, championship_id, phase_id,is_finished, team_a_id, team_b_id, team_a:team_a_id(name), team_b:team_b_id(name)")
      .eq("id", matchId)
      .single();

    if (matchErr || !matchRow) {
      Alert.alert(t("common.error"), t("lineup.matchLoadError"));
      setLoading(false);
      return;
    }

    if (matchRow.is_finished) {
      Alert.alert(t("lineup.matchFinishedTitle"), t("lineup.matchFinishedMessage"));
      router.back();
      return;
    }

    setChampionshipId(matchRow.championship_id);
    setMatchPhaseId(matchRow.phase_id ?? null);

    setTeamAId(matchRow.team_a_id ?? null);
    setTeamBId(matchRow.team_b_id ?? null);
    setTeamAName(matchRow.team_a?.name ?? t("publicMatches.teamA"));
    setTeamBName(matchRow.team_b?.name ?? t("publicMatches.teamB"));

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
      Alert.alert(t("lineup.lockedTitle"), t("lineup.lockedMessage"));
      setLoading(false);
      router.replace({ pathname: "/play", params: { matchId: String(matchId) } });
      return;
    }

    setRoundRow(rr);

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
      .eq("championship_id", champId);

    if (attErr) {
      Alert.alert(t("common.error"), t("lineup.attackersLoadError", { message: attErr.message }));
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
      Alert.alert(t("common.error"), t("lineup.defendersLoadError", { message: defErr.message }));
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
    const attDefault = attackList.find((p) => p.is_captain)?.player_id ?? null;
    const defDefault = defenseList.find((p) => p.is_captain)?.player_id ?? null;
    setOriginalCaptainByTeam({ [attTeamId]: attDefault, [defTeamId]: defDefault });

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
        { text: t("publicMatches.cancel"), style: "cancel" },
      ];

      if (isCurrentOverride) {
        buttons.unshift({
          text: t("lineup.restoreDefaultCaptain"),
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
          text: t("lineup.makeMatchCaptain"),
          onPress: async () => {
            await supabase
              .from("match_captain_override")
              .upsert({ match_id: matchId, team_id: teamId, player_id: player.player_id });

            setCaptainOverrideByTeam((prev) => ({ ...prev, [teamId]: player.player_id }));
            applyCaptainToState(teamId, role, player.player_id);
          },
        });
      }

      Alert.alert(t("lineup.matchCaptainTitle"), t("lineup.matchCaptainQuestion", { player: player.player_name }), buttons);
    };

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
        Alert.alert(t("lineup.limitTitle"), t("lineup.maxDefenders"));
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
        Alert.alert(t("lineup.limitTitle"), t("lineup.maxAttackers"));
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

  async function getTeamRoster(teamId: number, champId: number): Promise<PlayerItem[]> {
    const { data, error } = await supabase
      .from("team_player")
      .select("player_id, player_number, is_captain, player:player_id(name, external_code)")
      .eq("team_id", teamId)
      .eq("championship_id", champId);

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
    if ([2, 3, 4, 5].includes(matchPhaseId ?? -1)) {
      Alert.alert(t("matchSummary.notAvailable"), t("lineup.cannotAddPlayersKnockout"));
      return;
    }
    const teamId = role === "attack" ? attackingTeamId : defendingTeamId;
    if (!teamId) {
      Alert.alert(t("common.error"), t("lineup.teamDetectError"));
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

    const term = q.trim().toLowerCase();

    if (term.length < 2) {
      setDuplicateNameCount(0);
      return;
    }

    const { data, error } = await supabase
      .from("team_player")
      .select(`
      player_id,
      player:player_id (
        id,
        name,
        external_code
      )
    `)
      .eq("championship_id", championshipId)
      .limit(500);

    if (error) {
      setDuplicateNameCount(0);
      return;
    }

    const exactSameNameRows = (data ?? []).filter(
      (r: any) => (r.player?.name ?? "").trim().toLowerCase() === term
    );

    const ids = new Set<number>();
    for (const r of exactSameNameRows) {
      const id = r.player?.id;
      if (typeof id === "number") ids.add(id);
    }

    setDuplicateNameCount(ids.size);
  }

  async function submitAddOrReplace() {
    if (!teamForAdd || !championshipId) {
      Alert.alert(t("common.error"), t("lineup.missingChampionshipTeam"));
      return;
    }

    const name = newPlayerName.trim();
    if (name.length < 2) {
      Alert.alert(t("lineup.invalidNameTitle"), t("lineup.invalidNameMessage"));
      return;
    }

    setSaving(true);

    try {
      const roster = await getTeamRoster(teamForAdd, championshipId);

      let playerNumber =
        roster.length === 0 ? 1 : Math.max(...roster.map((p) => p.player_number)) + 1;

      let isReplacement = false;
      let replacedPlayerNumber: number | null = null;

      if (roster.length >= maxTeamPlayers) {
        if (!replaceTargetPlayerId) {
          setRosterForReplace(roster);
          setAddModalVisible(false);
          setSaving(false);
          setTimeout(() => setReplaceModalVisible(true), 50);
          return;
        }

        const ok = await canRemovePlayerEverywhere(replaceTargetPlayerId);
        if (!ok) {
          Alert.alert(t("lineup.cannotReplaceTitle"), t("lineup.cannotReplaceMessage"));
          setSaving(false);
          return;
        }

        const replaced = roster.find((p) => p.player_id === replaceTargetPlayerId);
        if (!replaced) {
          Alert.alert(t("common.error"), t("lineup.replacePlayerNotFound"));
          setSaving(false);
          return;
        }

        isReplacement = true;
        replacedPlayerNumber = replaced.player_number;
        playerNumber = replaced.player_number;

        setAttackSelected((prev) => prev.filter((x) => x.player_id !== replaceTargetPlayerId));
        setDefenseSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(replaceTargetPlayerId);
          return next;
        });
      }

      const { data: sameNameRows, error: snErr } = await supabase
        .from("team_player")
        .select(`
        player_id,
        player:player_id (
          id,
          name,
          external_code
        )
      `)
        .eq("championship_id", championshipId)
        .limit(500);

      if (snErr) throw snErr;

      const normalizedName = name.trim().toLowerCase();

      const exactSameNameRows = (sameNameRows ?? []).filter(
        (r: any) => (r.player?.name ?? "").trim().toLowerCase() === normalizedName
      );

      const sameNameInChampionship = exactSameNameRows.length > 0;

      let externalCodeForNewPlayer: string | null = null;

      if (sameNameInChampionship) {
        const numericCodes = exactSameNameRows
          .map((r: any) => {
            const raw = String(r.player?.external_code ?? "").trim();
            const n = parseInt(raw, 10);
            return Number.isFinite(n) ? n : 0;
          })
          .filter((n: number) => n > 0);

        const nextCode = numericCodes.length > 0 ? Math.max(...numericCodes) + 1 : 2;
        externalCodeForNewPlayer = String(nextCode);
      }

      const { data: newPlayer, error: pErr } = await supabase
        .from("player")
        .insert({
          name,
          external_code: externalCodeForNewPlayer,
        })
        .select("id")
        .single();

      if (pErr || !newPlayer) {
        throw pErr ?? new Error(t("lineup.playerCreateError"));
      }

      if (isReplacement && replaceTargetPlayerId) {
        const { error: tpErr } = await supabase
          .from("team_player")
          .update({
            player_id: newPlayer.id,
            player_number: replacedPlayerNumber ?? playerNumber,
            is_captain: false,
          })
          .eq("championship_id", championshipId)
          .eq("team_id", teamForAdd)
          .eq("player_id", replaceTargetPlayerId);

        if (tpErr) throw tpErr;
      } else {
        const { error: tpErr } = await supabase
          .from("team_player")
          .insert({
            championship_id: championshipId,
            team_id: teamForAdd,
            player_id: newPlayer.id,
            player_number: playerNumber,
            is_captain: false,
          });

        if (tpErr) throw tpErr;
      }

      if (attackingTeamId && defendingTeamId) {
        const loaded2 = await loadPlayersForTeams(
          attackingTeamId,
          defendingTeamId,
          championshipId
        );

        if (loaded2.ok) {
          await loadCaptainOverridesForMatch(
            attackingTeamId,
            defendingTeamId,
            loaded2.attackList,
            loaded2.defenseList
          );
        }
      }

      setAddModalVisible(false);
      setReplaceModalVisible(false);
      setReplaceTargetPlayerId(null);
      setNewPlayerName("");

      Alert.alert(
        t("lineup.doneTitle"),
        isReplacement
          ? sameNameInChampionship
            ? t("lineup.playerReplacedWithCode", { code: externalCodeForNewPlayer ?? "" })
            : t("lineup.playerReplaced")
          : sameNameInChampionship
            ? t("lineup.playerCreatedWithCode", { code: externalCodeForNewPlayer ?? "" })
            : t("lineup.playerCreated")
      );
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("lineup.addReplaceError"));
    } finally {
      setSaving(false);
    }
  }

  async function saveLineup(): Promise<boolean> {
    if (!roundRow) return false;
    if (!attackingTeamId || !defendingTeamId) {
      Alert.alert(t("common.error"), t("lineup.missingRoundTeams"));
      return false;
    }

    const enforced = enforceCaptainLast(attackSelected);

    if (enforced.length < 4) {
      Alert.alert(t("lineup.missingAttackersTitle"), t("lineup.missingAttackersMessage"));
      return false;
    }

    if (defenseSelectedIds.size < 4) {
      Alert.alert(t("lineup.missingDefendersTitle"), t("lineup.missingDefendersMessage"));
      return false;
    }

    if (defenseSelectedIds.size > 8) {
      Alert.alert(t("lineup.tooManyDefendersTitle"), t("lineup.tooManyDefendersMessage"));
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
      Alert.alert(t("lineup.savedTitle"), t("lineup.savedMessage"));
      return true;
    } catch (e: any) {
      Alert.alert(t("common.error"), e?.message ?? t("lineup.saveError"));
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

  const captainCardStyle = { borderColor: "#2e86de", backgroundColor: colors.primary + "22" };
  const canAddPlayers = ![2, 3, 4, 5].includes(matchPhaseId ?? -1);

  return (
    <>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
        <BackButton onPress={() => {
          if (Number.isNaN(matchId) || !matchId) {
            router.back();
            return;
          }
          router.replace({ pathname: "/match", params: { id: String(matchId) } });
        }} />

        {roundRow && !(roundRow.match_round_number === 1 && roundRow.turn === 1) ? (
          <View
            style={{
              marginBottom: 12,
              marginTop: 8,
              padding: 12,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Text style={{ textAlign: "center", fontWeight: "900", fontSize: 16, color: colors.text }}>
              {t("matchSummary.score")}
            </Text>

            {scoreLoading ? (
              <ActivityIndicator style={{ marginTop: 10 }} />
            ) : (
              <>
                <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10 }}>
                  <View style={{ flex: 1, paddingRight: 8 }}>
                    <Text numberOfLines={1} style={{ fontWeight: "800", color: colors.text }}>
                      {teamAName}
                    </Text>
                  </View>

                  <Text style={{ fontSize: 20, fontWeight: "900", color: colors.text }}>
                    {scoreA} - {scoreB}
                  </Text>

                  <View style={{ flex: 1, paddingLeft: 8, alignItems: "flex-end" }}>
                    <Text numberOfLines={1} style={{ fontWeight: "800", color: colors.text }}>
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
                    color: colors.text,
                  }}
                >
                  {t("lineup.difference")}: {Math.abs(scoreA - scoreB)}
                </Text>
              </>
            )}
          </View>
        ) : null}

        <Text style={{ fontSize: 20, fontWeight: "bold", textAlign: "center", color: colors.text }}>
          {t("matchSummary.lineup")}
        </Text>

        <Text style={{ textAlign: "center", color: colors.muted, marginTop: 6 }}>
          {roundTitle} · {t("lineup.maxPlayersTeam")}: {maxTeamPlayers}
        </Text>

        <View style={{ height: 18 }} />

        <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>{t("lineup.attackersTitle")}</Text>

            {canAddPlayers ? (
              <Pressable
                disabled={saving}
                onPress={() => openAddPlayer("attack")}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "700", color: colors.text }}>+ {t("lineup.player")}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={{ marginTop: 6, color: colors.muted }}>{t("lineup.captainLastHint")}</Text>
          {attackSelected.length === 0 ? (
            <Text style={{ color: "#777", marginTop: 6 }}>{t("lineup.noAttackersSelected")}</Text>
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
                  backgroundColor: p.is_captain ? colors.primary + "75" : "#e6f7ed",
                }}
              >
                <Text style={{ fontWeight: "700" }}>
                  {idx + 1}. {displayName(p)} <Text style={{ fontWeight: "400" }}>({t("lineup.tapToRemove")})</Text>
                </Text>
              </Pressable>
            ))
          )}

          <View style={{ height: 14 }} />

          <Text style={{ fontWeight: "700", color: colors.text }}>{t("lineup.available")}:</Text>

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
                  borderColor: selected ? colors.border : p.is_captain ? captainCardStyle.borderColor : colors.border,
                  backgroundColor: selected ? colors.cardAlt : p.is_captain ? captainCardStyle.backgroundColor : colors.card,
                  opacity: selected ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.text }}>
                  {displayName(p)} {selected ? `(${t("lineup.selected")})` : ""}
                </Text>
              </Pressable>
            );
          })}

          {!canEditCaptain ? (
            <Text style={{ marginTop: 10, color: colors.muted, fontWeight: "700" }}>
              ℹ️ {t("lineup.captainOnlyFirstRound")}
            </Text>
          ) : null}
        </View>

        <View style={{ height: 16 }} />

        <View style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Text style={{ fontWeight: "800", fontSize: 16, color: colors.text }}>{t("lineup.defendersTitle")}</Text>

            {canAddPlayers ? (
              <Pressable
                disabled={saving}
                onPress={() => openAddPlayer("defense")}
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 10,
                  borderRadius: 10,
                  borderWidth: 1,
                  borderColor: colors.border,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "700", color: colors.text }}>+ {t("lineup.player")}</Text>
              </Pressable>
            ) : null}
          </View>

          <Text style={{ marginTop: 6, color: colors.muted }}>
            {t("lineup.defendersHint")}
          </Text>

          <Text style={{ marginTop: 10, fontWeight: "700", color: colors.text }}>
            {t("lineup.selectedPlural")}: {defenseSelectedIds.size}/8
          </Text>

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
                  borderColor: selected ? "#f1c40f" : p.is_captain ? captainCardStyle.borderColor : colors.border,
                  backgroundColor: selected ? "#615a3d" : p.is_captain ? captainCardStyle.backgroundColor : colors.card,
                }}
              >
                <Text style={{ fontWeight: "600", color: colors.text }}>
                  {displayName(p)} {selected ? "✅" : ""}
                </Text>
              </Pressable>
            );
          })}
          {!canEditCaptain ? (
            <Text style={{ marginTop: 10, color: colors.muted, fontWeight: "700" }}>
              ℹ️ {t("lineup.captainOnlyFirstRound")}
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
            backgroundColor: colors.primary,
            opacity: saving ? 0.7 : 1,
          }}
        >
          <Text style={{ color: colors.primaryText, fontWeight: "800" }}>
            {saving ? t("lineup.saving") : t("home.refereeStart").replace("👨‍⚖️ ", "")}
          </Text>
        </Pressable>
      </ScrollView>

      <Modal visible={addModalVisible} transparent animationType="fade" onRequestClose={() => setAddModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 18 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16 }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text }}>
              {t("lineup.addPlayer")} ({addRole === "attack" ? t("lineup.attackers") : t("lineup.defenders")})
            </Text>

            <Text style={{ marginTop: 8, color: colors.muted }}>
              {t("lineup.addPlayerHint")}
            </Text>

            <Text style={{ marginTop: 12, fontWeight: "700", color: colors.text }}>{t("lineup.playerName")}</Text>
            <TextInput
              value={newPlayerName}
              onChangeText={(text) => {
                setNewPlayerName(text);
                searchExistingInChampionship(text);
              }}
              placeholder={t("lineup.playerNamePlaceholder")}
              placeholderTextColor={colors.muted}
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 12,
                marginTop: 8,
                color: colors.text,
              }}
            />

            {duplicateNameCount > 0 ? (
              <View style={{ marginTop: 12 }}>
                <Text style={{ fontWeight: "700", color: colors.text }}>⚠️ {t("lineup.duplicateNameTitle")}</Text>
                <Text style={{ color: colors.muted, marginTop: 4 }}>
                  {t("lineup.duplicateNameMessage", { count: duplicateNameCount })}
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
                <Text style={{ fontWeight: "700", color: colors.text }}>{t("publicMatches.cancel")}</Text>
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
                  borderColor: colors.primary,
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <Text style={{ fontWeight: "800", color: colors.text }}>{saving ? "..." : t("lineup.createNew")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={replaceModalVisible} transparent animationType="fade" onRequestClose={() => setReplaceModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 18 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 14, padding: 16, maxHeight: "80%" }}>
            <Text style={{ fontSize: 16, fontWeight: "800", color: colors.text }}>
              {t("lineup.teamFull", { max: maxTeamPlayers })}
            </Text>
            <Text style={{ marginTop: 8, color: colors.muted }}>
              {t("lineup.replaceHint")}
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
                      borderColor: selected ? colors.text : colors.border,
                      backgroundColor: selected ? colors.cardAlt : colors.card,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ fontWeight: "700", color: colors.text }}>
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
                <Text style={{ fontWeight: "700", color: colors.text }}>{t("publicMatches.cancel")}</Text>
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
                  borderColor: colors.primary,
                  opacity: saving || !replaceTargetPlayerId ? 0.5 : 1,
                }}
              >
                <Text style={{ fontWeight: "800", color: colors.text }}>{t("lineup.replace")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}