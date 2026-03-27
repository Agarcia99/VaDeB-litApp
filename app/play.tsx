import { useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  ActivityIndicator,
  Pressable,
  Alert,
  Modal,
  FlatList,
  ScrollView,
  Vibration,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Audio } from "expo-av";
import * as Haptics from "expo-haptics";
import { supabase } from "../src/supabase";

type RoundRow = {
  round_id: number;
  match_round_number: number;
  round_number: number;
  turn: number;
  attacking_team_id: number;
  defending_team_id: number;
  attacking_team_name?: string | null;
  defending_team_name?: string | null;
};

type LineupRow = {
  id: number;
  role: "attack" | "defense";
  order_in_role: number | null;
  team_id: number;
  player_id: number;
  player?: { id: number; name: string } | null;
};

function confirmAction(title: string, message: string) {
  return new Promise<boolean>((resolve) => {
    Alert.alert(title, message, [
      { text: "Cancel·lar", style: "cancel", onPress: () => resolve(false) },
      { text: "Sí, guardar", style: "destructive", onPress: () => resolve(true) },
    ]);
  });
}

function confirmFinishTurn() {
  return new Promise<boolean>((resolve) => {
    Alert.alert(
      "Confirmació final",
      "Segur que vols finalitzar el torn? Revisa bé l'última tirada abans de continuar.",
      [
        { text: "No, revisar", style: "cancel", onPress: () => resolve(false) },
        { text: "Sí, finalitzar", style: "destructive", onPress: () => resolve(true) },
      ]
    );
  });
}

/**
 * ✅ Compta plays globals del match (BBDD real)
 */
async function getRequiredPlaysForRound(roundId: number, attackingTeamId: number): Promise<number> {
  const { count, error } = await supabase
    .from("round_lineup")
    .select("id", { count: "exact", head: true })
    .eq("round_id", roundId)
    .eq("team_id", attackingTeamId)
    .eq("role", "attack");

  if (error) throw error;

  return Math.max(0, count ?? 0);
}

async function isMatchCompleted(roundList: RoundRow[]): Promise<boolean> {
  // Un match està complet quan tots els rounds tenen tantes tirades com atacants seleccionats (4-6)
  for (const r of roundList) {
    const required = await getRequiredPlaysForRound(r.round_id, r.attacking_team_id);
    if (required === 0) return false;

    const { count, error } = await supabase
      .from("play")
      .select("id", { count: "exact", head: true })
      .eq("round_id", r.round_id);

    if (error) throw error;

    const done = count ?? 0;
    if (done < required) return false;
  }

  return true;
}
/**
 * ✅ Finalitza match guardant resultat final i surt a /matches
 */
async function finalizeMatch(params: {
  matchId: number;
  scoreTeamA: number;
  scoreTeamB: number;
}) {
  const { matchId, scoreTeamA, scoreTeamB } = params;

  const { error } = await supabase
    .from("match")
    .update({
      is_finished: true,
      score_team_a: scoreTeamA,
      score_team_b: scoreTeamB,
      finished_at: new Date().toISOString(),
    })
    .eq("id", matchId);

  if (error) throw error;
}

export default function PlayScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ matchId?: string; roundId?: string }>();
  const matchId = Number(params.matchId);
  const roundIdParam = params.roundId ? Number(params.roundId) : null;

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [rounds, setRounds] = useState<RoundRow[]>([]);
  const [currentRound, setCurrentRound] = useState<RoundRow | null>(null);

  const [attackers, setAttackers] = useState<LineupRow[]>([]);
  const [defenders, setDefenders] = useState<LineupRow[]>([]);
  const [playsDone, setPlaysDone] = useState(0);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [awaitingTurnConfirmation, setAwaitingTurnConfirmation] = useState(false);
  const [canUndoNow, setCanUndoNow] = useState(false);

  const [defenderModalOpen, setDefenderModalOpen] = useState(false);
  const [pendingDefenseEvent, setPendingDefenseEvent] = useState<
    "MATACANAS" | "AIR_CATCH" | null
  >(null);

  const [canasModalOpen, setCanasModalOpen] = useState(false);
  const [canasValue, setCanasValue] = useState(0);

  const [maxPointsRound, setMaxPointsRound] = useState<number>(600);

  // ✅ Config: nombre de rondes per partit (per defecte 2)
  // championship_config key = "match_rounds" (value: integer)
  const [matchRoundsCount, setMatchRoundsCount] = useState<number>(2);

  // ✅ Config: quan ha de vibrar el cronòmetre (segons). Per defecte 30.
  // championship_config key = "vibration_time" (value: number, en segons)
  const [vibrationTimeSec, setVibrationTimeSec] = useState<number>(30);

  const [conversionModalOpen, setConversionModalOpen] = useState(false);

  const conversionRows = useMemo(() => {
    const rows: { meters: number; canes: number }[] = [];
    for (let m = 2; m <= 80; m += 2) {
      rows.push({ meters: m, canes: Math.round(m * 2.5) });
    }
    return rows;
  }, []);

  function addCanes(delta: number) {
    setCanasValue((v) => {
      const next = v + delta;
      if (next > maxPointsRound) {
        Alert.alert("Error", `No es poden posar més de ${maxPointsRound} canes en 1 tirada.`);
        return v;
      }
      return next;
    });
  }

  // ✅ Marcador
  const [scoreLoading, setScoreLoading] = useState(false);
  const [scoreA, setScoreA] = useState(0);
  const [scoreB, setScoreB] = useState(0);

  // ✅ Equip A/B del match (fixos, no depenen de qui comença)
  const [matchTeamsFixed, setMatchTeamsFixed] = useState<{
    aId: number;
    bId: number;
    aName: string;
    bName: string;
  } | null>(null);

  // ✅ Modal final (mostrar resultat abans de sortir)
  const [finalModalOpen, setFinalModalOpen] = useState(false);
  const [finalScores, setFinalScores] = useState<{ a: number; b: number } | null>(null);
  const [finishedLocal, setFinishedLocal] = useState(false);

  // ✅ Bélit d'or (només en eliminatòries: phase_id != 1 && != 8)
  const [belitDorModalOpen, setBelitDorModalOpen] = useState(false);
  const [belitDorPendingTotals, setBelitDorPendingTotals] = useState<{ a: number; b: number } | null>(null);

  // ⏱️ Cronòmetre visual (no es guarda enlloc)
  const [timerRunning, setTimerRunning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const lastTickRef = useRef<number | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const vibratedAt30Ref = useRef(false);


// 🔊 Beep in-memory (data URI) + alarma 3x (vibra + sona). No es guarda enlloc.
const BEEP_DATA_URI =
  "data:audio/wav;base64,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";
const beepSoundRef = useRef<Audio.Sound | null>(null);

useEffect(() => {
  // Permet que el so soni també amb el silenci activat a iOS
  Audio.setAudioModeAsync({
    playsInSilentModeIOS: true,
    shouldDuckAndroid: false,
    playThroughEarpieceAndroid: false,
    staysActiveInBackground: false,
  }).catch(() => {});
  return () => {
    beepSoundRef.current?.unloadAsync?.().catch(() => {});
    beepSoundRef.current = null;
  };
}, []);

async function playBeep() {
  try {
    if (!beepSoundRef.current) {
      const created = await Audio.Sound.createAsync(
        { uri: BEEP_DATA_URI },
        { shouldPlay: false, volume: 1.0 }
      );
      beepSoundRef.current = created.sound;
    }
    try {
      await beepSoundRef.current.setIsMutedAsync(false as any);
    } catch {}
    try {
      await beepSoundRef.current.setVolumeAsync(1.0);
    } catch {}
    await beepSoundRef.current.replayAsync();
  } catch {
    // ignore (so opcional)
  }
}

function triggerAlarm3x() {
  // Objectiu: que a Android vibri de forma fiable (OEMs diferents) i a iOS es mantingui com fins ara.
  // - Android: combinació de Vibration (durada + patró) + expo-haptics (impact + notification) com a fallback.
  // - iOS: 3 vibracions separades (els patrons s'ignoren a iOS).
  const runBeep = () => void playBeep();

  if (Platform.OS === "android") {
    // 1) Vibració "simple" (molts dispositius respecten millor una durada que un patró)
    try {
      Vibration.vibrate(700);
    } catch {}

    // 2) Patró 3 cops (si el dispositiu el suporta)
    try {
      Vibration.vibrate([0, 350, 180, 350, 180, 350]);
    } catch {}

    // 3) Fallback amb Haptics (expo-haptics) — sovint funciona quan Vibration queda silenciós
    void (async () => {
      try {
        await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        }, 450);
        setTimeout(() => {
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
        }, 900);

        // Extra: notification (alguns OEMs la fan més "forta")
        setTimeout(() => {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        }, 120);
      } catch {}
    })();
  } else {
    // iOS: patró ignorat -> 3 vibracions separades
    Vibration.vibrate();
    setTimeout(() => Vibration.vibrate(), 430);
    setTimeout(() => Vibration.vibrate(), 860);
  }

  // 3 beeps (audible) — al màxim volum que permet el sistema
  runBeep();
  setTimeout(runBeep, 430);
  setTimeout(runBeep, 860);
}

  const vibrationTimeMs = useMemo(() => {
    const s = Number(vibrationTimeSec);
    return Number.isFinite(s) && s > 0 ? Math.round(s * 1000) : 0;
  }, [vibrationTimeSec]);

  const attacker = attackers[currentIndex];

  useEffect(() => {
    if (!timerRunning) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      lastTickRef.current = null;
      return;
    }

    // quan engeguem: reiniciem la referència de tick
    lastTickRef.current = Date.now();
    // si ja passàvem del llindar, no tornem a vibrar fins reset
    vibratedAt30Ref.current = vibrationTimeMs > 0 ? elapsedMs >= vibrationTimeMs : true;

    intervalRef.current = setInterval(() => {
      const now = Date.now();
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      const delta = now - last;

      setElapsedMs((prev) => {
        const next = prev + delta;
        if (vibrationTimeMs > 0 && !vibratedAt30Ref.current && next >= vibrationTimeMs) {
          vibratedAt30Ref.current = true;
          triggerAlarm3x();
        }
        return next;
      });
    }, 100);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      intervalRef.current = null;
      lastTickRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerRunning, vibrationTimeMs]);

  function toggleTimer() {
    setTimerRunning((v) => !v);
  }

  function resetTimer() {
    setTimerRunning(false);
    setElapsedMs(0);
    vibratedAt30Ref.current = false;
  }

useEffect(() => {
  resetTimer();
}, [currentIndex]);

  const timerSeconds = Math.floor(elapsedMs / 1000);
  const timerTenths = Math.floor((elapsedMs % 1000) / 100);
  const timerDisplay = `${String(Math.floor(timerSeconds / 60)).padStart(2, "0")}:${String(
    timerSeconds % 60
  ).padStart(2, "0")}.${timerTenths}`;

  const headerTitleAttack = useMemo(() => {
    if (!currentRound) return "";
    const aName =
      currentRound.attacking_team_name ?? `Equip ${currentRound.attacking_team_id}`;
    return `Ataca: ${aName}`;
  }, [currentRound]);
const headerTitleDefense = useMemo(() => {
    if (!currentRound) return "";
    const dName =
      currentRound.defending_team_name ?? `Equip ${currentRound.defending_team_id}`;
    return `Defensa: ${dName}`;
  }, [currentRound]);

  const matchTeams = useMemo(() => {
    if (matchTeamsFixed) return matchTeamsFixed;
    // fallback (no hauria de passar): dedueix-ho dels rounds
    if (!rounds.length) return null;
    const first = rounds[0];
    const aId = first.attacking_team_id;
    const bId = first.defending_team_id;
    const aName = first.attacking_team_name ?? `Equip ${aId}`;
    const bName = first.defending_team_name ?? `Equip ${bId}`;
    return { aId, bId, aName, bName };
  }, [matchTeamsFixed, rounds]);

  useEffect(() => {
    if (!matchId || Number.isNaN(matchId)) {
      Alert.alert("Error", "matchId invàlid");
      router.back();
      return;
    }
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId, roundIdParam]);

  useEffect(() => {
    if (!attackers.length) return;
    setCurrentIndex(Math.min(playsDone, attackers.length - 1));
  }, [playsDone, attackers.length]);

  async function init() {
    setLoading(true);

    // holds the fixed A/B team ids for this match across init() blocks
    let fixedIds: { aId: number; bId: number } | undefined;

    // local copy so we can apply the config within the same init() run
    let matchRoundsLocal = matchRoundsCount || 2;

    // ✅ 0) Si el match ja està finalitzat, bloqueja i surt
    {
      const { data: m, error: mErr } = await supabase
        .from("match")
        .select("is_finished, team_a_id, team_b_id, championship_id")
        .eq("id", matchId)
        .single();

      if (mErr) {
        Alert.alert("Error", mErr.message);
        setLoading(false);
        return;
      }

      if (m?.is_finished) {
        Alert.alert("Partit finalitzat", "Aquest partit ja està tancat.");
        router.replace("/matches");
        return;
      }


      // ✅ capture fixed A/B team ids early so scoreboard never flips when Team B starts
      fixedIds = m?.team_a_id && m?.team_b_id ? { aId: m.team_a_id as number, bId: m.team_b_id as number } : undefined;

      // ✅ Config: màxim de canes per tirada (championship_config key="max_points_round")
      try {
        const champId = (m as any)?.championship_id as number | undefined;
        if (champId) {
          const { data: cfg, error: cfgErr } = await supabase
            .from("championship_config")
            .select("value")
            .eq("championship_id", champId)
            .eq("key", "max_points_round")
            .is("phase_id", null)
            .limit(1);

          if (!cfgErr) {
            const raw = (cfg?.[0] as any)?.value;
            const parsed = typeof raw === "string" ? Number(raw) : Number(raw);
            if (Number.isFinite(parsed) && parsed > 0) setMaxPointsRound(parsed);
          }
        }
      } catch {
        // keep default 600
      }

      // ✅ Config: nombre de rondes per partit (championship_config key="match_rounds")
      // IMPORTANT: un match pot tenir dades antigues creades amb 2 rondes; més avall filtrarem.
      try {
        const champId = (m as any)?.championship_id as number | undefined;
        if (champId) {
          const { data: cfg, error: cfgErr } = await supabase
            .from("championship_config")
            .select("value")
            .eq("championship_id", champId)
            .eq("key", "match_rounds")
            .is("phase_id", null)
            .limit(1);

          if (!cfgErr) {
            const raw = (cfg?.[0] as any)?.value;
            const parsed = typeof raw === "string" ? Number(raw) : Number(raw);
            if (Number.isFinite(parsed) && parsed >= 1) {
              matchRoundsLocal = Math.floor(parsed);
              setMatchRoundsCount(matchRoundsLocal);
            }
          }
        }
      } catch {
        // keep default 2
      }

      // ✅ Config: vibració del cronòmetre (championship_config key="vibration_time", segons)
      try {
        const champId = (m as any)?.championship_id as number | undefined;
        if (champId) {
          const { data: cfg, error: cfgErr } = await supabase
            .from("championship_config")
            .select("value")
            .eq("championship_id", champId)
            .eq("key", "vibration_time")
            .is("phase_id", null)
            .limit(1);

          if (!cfgErr) {
            const raw = (cfg?.[0] as any)?.value;
            const parsed = typeof raw === "string" ? Number(raw) : Number(raw);
            // Permetem 0 per desactivar vibració
            if (Number.isFinite(parsed) && parsed >= 0) setVibrationTimeSec(parsed);
          }
        }
      } catch {
        // keep default 30
      }


    // ✅ carrega equips fixos del match (A/B) per calcular marcador correcte encara que comenci Team B
    {
      const aId = fixedIds?.aId;
      const bId = fixedIds?.bId;

      if (aId && bId) {
        const { data: teams, error: tErr } = await supabase
          .from("team")
          .select("id, name")
          .in("id", [aId, bId]);

        if (tErr) {
          Alert.alert("Error", tErr.message);
          setLoading(false);
          return;
        }

        const aName = (teams ?? []).find((t: any) => t.id === aId)?.name ?? `Equip ${aId}`;
        const bName = (teams ?? []).find((t: any) => t.id === bId)?.name ?? `Equip ${bId}`;
        setMatchTeamsFixed({ aId, bId, aName, bName });
      }
    }
    }

    // 1) Carrega els rounds
    const { data: rds, error: rErr } = await supabase
      .from("v_rounds_by_match")
      .select(`
        round_id,
        match_round_number,
        round_number,
        turn,
        attacking_team_id,
        attacking_team_name,
        defending_team_id,
        defending_team_name
      `)
      .eq("match_id", matchId)
      .order("match_round_number", { ascending: true })
      .order("turn", { ascending: true });

    if (rErr || !rds?.length) {
      Alert.alert("Error", rErr?.message ?? "No s'han pogut carregar els rounds");
      setLoading(false);
      return;
    }

    const listAll: RoundRow[] = rds.map((x: any) => ({
      round_id: x.round_id,
      match_round_number: x.match_round_number,
      round_number: x.round_number,
      turn: x.turn,
      attacking_team_id: x.attacking_team_id,
      defending_team_id: x.defending_team_id,
      attacking_team_name: x.attacking_team_name ?? null,
      defending_team_name: x.defending_team_name ?? null,
    }));

    // ⚠️ Filtra per les rondes configurades (match_rounds). Evita que el flux salti a rondes antigues.
    const list: RoundRow[] = listAll.filter((r) => r.match_round_number <= matchRoundsLocal);

    if (!list.length) {
      Alert.alert("Error", "No hi ha rounds vàlids per aquest partit.");
      setLoading(false);
      return;
    }

    setRounds(list);

    // 2) Tria round actual
    let chosen: RoundRow | null = null;

    if (roundIdParam) {
      chosen = list.find((r) => r.round_id === roundIdParam) ?? null;
    }

    if (!chosen) {
      for (const r of list) {
        const { count } = await supabase
          .from("play")
          .select("id", { count: "exact", head: true })
          .eq("round_id", r.round_id);

        const required = await getRequiredPlaysForRound(r.round_id, r.attacking_team_id);

        if ((count ?? 0) < required) {
          chosen = r;
          break;
        }
      }
      if (!chosen) chosen = list[list.length - 1];
    }

    setCurrentRound(chosen);

    // 3) Carrega lineup del round
    await loadLineup(chosen.round_id);

    // 4) playsDone per reprendre
    await loadPlaysDone(chosen.round_id);

    // ✅ 5) marcador inicial
    await refreshScoreboard(list, fixedIds);

    setLoading(false);
  }

  async function loadLineup(roundId: number) {
    const { data: lu, error } = await supabase
      .from("round_lineup")
      .select(
        `id, role, order_in_role, team_id, player_id, player:player_id ( id, name )`
      )
      .eq("round_id", roundId);

    if (error) {
      Alert.alert("Error", `No s'ha pogut carregar la lineup: ${error.message}`);
      setAttackers([]);
      setDefenders([]);
      return;
    }

    const rows = (lu ?? []) as any as LineupRow[];
    const atk = rows
      .filter((r) => r.role === "attack")
      .sort((a, b) => (a.order_in_role ?? 999) - (b.order_in_role ?? 999));

    const def = rows.filter((r) => r.role === "defense");

    setAttackers(atk);
    setDefenders(def);
  }

  async function loadPlaysDone(roundId: number) {
    const { count, error } = await supabase
      .from("play")
      .select("id", { count: "exact", head: true })
      .eq("round_id", roundId);

    if (error) {
      setPlaysDone(0);
      setAwaitingTurnConfirmation(false);
      setCanUndoNow(false);
      return;
    }

    const done = count ?? 0;
    setPlaysDone(done);
    setAwaitingTurnConfirmation(false);
    setCanUndoNow(done > 0);
  }

  /**
   * ✅ Marcador en directe (global de match)
   * Ara RETORNA els totals calculats per poder guardar-los al final
   */
  async function refreshScoreboard(
  roundList?: RoundRow[],
  fixedTeams?: { aId: number; bId: number }
) {
    const list = roundList ?? rounds;
    if (!list?.length) return { a: scoreA, b: scoreB };

    setScoreLoading(true);
    try {
      const roundMap = new Map<number, { atk: number; def: number }>();
      for (const r of list) {
        roundMap.set(r.round_id, { atk: r.attacking_team_id, def: r.defending_team_id });
      }

      const roundIds = list.map((r) => r.round_id);

      const { data: plays, error: pErr } = await supabase
        .from("play")
        .select("id, round_id")
        .in("round_id", roundIds);

      if (pErr) throw pErr;

      const playRows = plays ?? [];
      if (!playRows.length) {
        setScoreA(0);
        setScoreB(0);
        return { a: 0, b: 0 };
      }

      const playIdToRound = new Map<number, number>();
      const playIds: number[] = [];
      for (const p of playRows as any[]) {
        playIdToRound.set(p.id, p.round_id);
        playIds.push(p.id);
      }

      const { data: events, error: eErr } = await supabase
        .from("play_event")
        .select("play_id, event_type, value, player_id")
        .in("play_id", playIds);

      if (eErr) throw eErr;

      const totals = new Map<number, number>(); // team_id -> score

      for (const ev of (events ?? []) as any[]) {
        const roundId = playIdToRound.get(ev.play_id);
        if (!roundId) continue;
        const map = roundMap.get(roundId);
        if (!map) continue;

        const v = typeof ev.value === "number" ? ev.value : 0;

        if (ev.event_type === "CANAS_SCORED") {
          // sempre suma a l'equip atacant del round
          totals.set(map.atk, (totals.get(map.atk) ?? 0) + v);
        } else if (ev.event_type === "TEAM_BONUS_CANAS") {
          totals.set(map.atk, (totals.get(map.atk) ?? 0) + v);
        } else if (ev.event_type === "DEFENDER_BONUS_CANAS") {
          totals.set(map.def, (totals.get(map.def) ?? 0) + v);
        }
      }

      // assignem a Equip A/B del match (fixos)
      const teams =
      fixedTeams ??
      matchTeamsFixed ?? // <-- usa l’estat quan ja hi és
      matchTeams ??      // <-- memo
      {
        aId: list[0].attacking_team_id,
        bId: list[0].defending_team_id,
      };

    const a = totals.get(teams.aId) ?? 0;
    const b = totals.get(teams.bId) ?? 0;

    setScoreA(a);
    setScoreB(b);

    return { a, b };
    } catch (e: any) {
      console.warn("refreshScoreboard error:", e?.message ?? e);
      return { a: scoreA, b: scoreB };
    } finally {
      setScoreLoading(false);
    }
  }

  async function createPlay(attackerPlayerId: number) {
    if (!currentRound) return null;

    const { data, error } = await supabase
      .from("play")
      .insert({
        round_id: currentRound.round_id,
        attacker_player_id: attackerPlayerId,
        eliminated: false,
      })
      .select()
      .single();

    if (error) {
      Alert.alert("Error", `No s'ha pogut crear play: ${error.message}`);
      return null;
    }

    return data;
  }

  async function createPlayEvent(
    playId: number,
    event_type: string,
    value: number | null,
    player_id: number | null
  ) {
    const { error } = await supabase.from("play_event").insert({
      play_id: playId,
      event_type,
      value,
      player_id,
    });

    if (error) {
      Alert.alert("Error", `No s'ha pogut crear play_event: ${error.message}`);
      throw error;
    }
  }

  async function getLastPlayOfCurrentRound() {
    if (!currentRound) return null;

    const { data, error } = await supabase
      .from("play")
      .select("id, attacker_player_id")
      .eq("round_id", currentRound.round_id)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      Alert.alert("Error", `No s'ha pogut carregar l'última tirada: ${error.message}`);
      return null;
    }

    return data;
  }

  async function undoPreviousPlay() {
    if (!currentRound || saving) return;

    if (!canUndoNow) {
      Alert.alert(
        "Acció no disponible",
        "No pots desfer dues tirades seguides. Torna a entrar una jugada abans de retrocedir de nou."
      );
      return;
    }

    if (playsDone <= 0) {
      Alert.alert("Info", "Encara no hi ha cap tirada per desfer.");
      return;
    }

    const ok = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Desfer última tirada",
        "S'eliminarà completament la jugada immediatament anterior per tornar-la a entrar. Vols continuar?",
        [
          { text: "Cancel·lar", style: "cancel", onPress: () => resolve(false) },
          { text: "Sí, desfer", style: "destructive", onPress: () => resolve(true) },
        ]
      );
    });

    if (!ok) return;

    try {
      setSaving(true);

      const lastPlay = await getLastPlayOfCurrentRound();
      if (!lastPlay?.id) {
        Alert.alert("Info", "No s'ha trobat cap tirada per desfer.");
        return;
      }

      const { error: evErr } = await supabase
        .from("play_event")
        .delete()
        .eq("play_id", lastPlay.id);

      if (evErr) throw evErr;

      const { error: playErr } = await supabase
        .from("play")
        .delete()
        .eq("id", lastPlay.id);

      if (playErr) throw playErr;

      const { count, error: countErr } = await supabase
        .from("play")
        .select("id", { count: "exact", head: true })
        .eq("round_id", currentRound.round_id);

      if (countErr) throw countErr;

      const done = count ?? 0;
      setPlaysDone(done);
      setCurrentIndex(Math.max(0, Math.min(done, (attackers.length || 6) - 1)));
      setCanUndoNow(false);
      setAwaitingTurnConfirmation(false);

      await refreshScoreboard();

      Alert.alert("Fet ✅", "S'ha desfet l'última tirada. Torna-la a entrar correctament.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut desfer l'última tirada.");
    } finally {
      setSaving(false);
    }
  }

  async function continueAfterTurnCompleted(totalsOverride?: { a: number; b: number }) {
    if (!currentRound) return;
    const ok = await confirmFinishTurn();
    if (!ok) return;
    const totals = totalsOverride ?? (await refreshScoreboard());

    const mr = matchRoundsCount || 2;
    const isLastTurnByConfig =
      currentRound.match_round_number >= mr && currentRound.turn === 2;

    if (isLastTurnByConfig) {
      const { data: mInfo, error: mInfoErr } = await supabase
        .from("match")
        .select("phase_id")
        .eq("id", matchId)
        .single();

      if (mInfoErr) {
        Alert.alert("Error", mInfoErr.message);
        return;
      }

      const phaseId = (mInfo as any)?.phase_id as number;
      if (phaseId !== 1 && phaseId !== 8 && totals.a === totals.b) {
        setBelitDorPendingTotals({ a: totals.a, b: totals.b });
        setBelitDorModalOpen(true);
        return;
      }

      Alert.alert("Partit finalitzat ✅", "S'han registrat totes les tirades del partit.");
      await finalizeMatch({ matchId, scoreTeamA: totals.a, scoreTeamB: totals.b });
      setFinishedLocal(true);
      setFinalScores({ a: totals.a, b: totals.b });
      setFinalModalOpen(true);
      return;
    }

    const idx = rounds.findIndex((r) => r.round_id === currentRound.round_id);
    const next = idx >= 0 ? rounds[idx + 1] : null;

    if (next) {
      Alert.alert("Torn complet ✅", "Ara toca preparar el següent torn.");
      router.replace({
        pathname: "/lineup",
        params: { matchId: String(matchId), roundId: String(next.round_id) },
      });
    } else {
      Alert.alert("Partit complet ✅", "S'han registrat totes les tirades del partit.");
      router.replace("/matches");
    }
  }

  
  // ✅ Aplica el Bélit d'Or (només eliminatòries): suma +1 al marcador, crea play especial + play_event i finalitza
  async function applyBelitDor(winner: "A" | "B") {
    try {
      if (!belitDorPendingTotals) return;
      if (!matchTeamsFixed?.aId || !matchTeamsFixed?.bId) {
        Alert.alert("Error", "No s'han pogut carregar els equips del partit.");
        return;
      }

      setSaving(true);

      const roundIdForGolden =
        currentRound?.round_id ?? (rounds.length ? rounds[rounds.length - 1].round_id : null);

      if (!roundIdForGolden) {
        Alert.alert("Error", "No s'ha pogut determinar el round per registrar el bélit d'or.");
        setSaving(false);
        return;
      }

      const scoreA0 = belitDorPendingTotals.a;
      const scoreB0 = belitDorPendingTotals.b;

      const scoreA1 = winner === "A" ? scoreA0 + 1 : scoreA0;
      const scoreB1 = winner === "B" ? scoreB0 + 1 : scoreB0;

      // 1) Crea un play especial (sense attacker) per poder vincular l'event a un match via round -> match_round
      const { data: goldenPlay, error: gpErr } = await supabase
        .from("play")
        .insert({
          round_id: roundIdForGolden,
          attacker_player_id: null,
          eliminated: null,
          eliminated_by_player_id: null,
        })
        .select("id")
        .single();

      if (gpErr) {
        Alert.alert("Error", gpErr.message);
        setSaving(false);
        return;
      }

      // 2) Crea event BELIT_DOR (value=1)
      const { error: peErr } = await supabase.from("play_event").insert({
        play_id: (goldenPlay as any)?.id,
        event_type: "BELIT_DOR",
        value: 1,
        player_id: null,
      });

      if (peErr) {
        Alert.alert("Error", peErr.message);
        setSaving(false);
        return;
      }

      // 3) Finalitza el partit amb marcador actualitzat (+1 al guanyador)
      await finalizeMatch({ matchId, scoreTeamA: scoreA1, scoreTeamB: scoreB1 });

      setScoreA(scoreA1);
      setScoreB(scoreB1);

      setBelitDorModalOpen(false);
      setBelitDorPendingTotals(null);

      Alert.alert("Partit finalitzat ✅", "S'han registrat totes les tirades del partit.");
      setFinishedLocal(true);
      setFinalScores({ a: scoreA1, b: scoreB1 });
      setFinalModalOpen(true);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error aplicant el bélit d'or");
    } finally {
      setSaving(false);
    }
  }

async function afterSavedAdvance() {
  if (!currentRound) return;

  const { count, error: countErr } = await supabase
    .from("play")
    .select("id", { count: "exact", head: true })
    .eq("round_id", currentRound.round_id);

  if (countErr) {
    Alert.alert("Error", countErr.message);
    return;
  }

  const done = count ?? 0;
  setPlaysDone(done);
  setCanUndoNow(done > 0);

  // refresca marcador després de cada acció guardada i recull totals
  await refreshScoreboard();

  const requiredPlays = attackers.length || 6;

  if (done >= requiredPlays) {
    // Quan s'acaba el torn, NO preguntem automàticament.
    // Simplement bloquegem les accions de jugada i mostrem "Finalitzar torn".
    setAwaitingTurnConfirmation(true);
    setCurrentIndex(Math.max(0, requiredPlays - 1));
    return;
  }

  setAwaitingTurnConfirmation(false);
  setCurrentIndex(Math.min(done, attackers.length - 1));
}

  async function safeSave(fn: () => Promise<void>) {
    if (saving) return;
    try {
      setSaving(true);
      await fn();
      setCanUndoNow(true);
    } finally {
      setSaving(false);
    }
  }

  // --- CANES ---
  async function saveCanasPlayerOnly() {
    if (!attacker?.player_id) return;

    const ok = await confirmAction(
      "Confirmar",
      `Sumar ${canasValue} canes a ${attacker.player?.name ?? "jugador"} ?`
    );
    if (!ok) return;

    await safeSave(async () => {
      const play = await createPlay(attacker.player_id);
      if (!play) return;

      await createPlayEvent(play.id, "CANAS_SCORED", canasValue, attacker.player_id);

      setCanasModalOpen(false);
      setCanasValue(0);
      await afterSavedAdvance();
    });
  }

  async function saveCanasAttackMeter() {
    if (!attacker?.player_id) return;
if (canasValue <= 0) {
  Alert.alert("Error", "Si es demana metre guanyat per atacant, les canes han de ser > 0.");
  return;
}
    const ok = await confirmAction(
      "Confirmar",
      `Metre guanyat per atacant: jugador suma ${canasValue} canes i l'equip suma ${canasValue} canes més`
    );
    if (!ok) return;

    await safeSave(async () => {
      const play = await createPlay(attacker.player_id);
      if (!play) return;

      await createPlayEvent(play.id, "CANAS_SCORED", canasValue, attacker.player_id);
      await createPlayEvent(play.id, "TEAM_BONUS_CANAS", canasValue, null);

      setCanasModalOpen(false);
      setCanasValue(0);
      await afterSavedAdvance();
    });
  }

  async function saveCanasDefenseMeter() {
    if (!attacker?.player_id) return;
if (canasValue <= 0) {
  Alert.alert("Error", "Si es demana metre guanyat per defensor, les canes han de ser > 0.");
  return;
}
    const ok = await confirmAction(
      "Confirmar",
      `Metre guanyat per defensor: defensa suma ${canasValue} canes i atacant 0?`
    );
    if (!ok) return;

    await safeSave(async () => {
      const play = await createPlay(attacker.player_id);
      if (!play) return;

      await createPlayEvent(play.id, "CANAS_SCORED", 0, attacker.player_id);
      await createPlayEvent(play.id, "DEFENDER_BONUS_CANAS", canasValue, null);

      setCanasModalOpen(false);
      setCanasValue(0);
      await afterSavedAdvance();
    });
  }

  async function onPickDefender(defenderPlayerId: number) {
    if (!attacker?.player_id) return;

    const defenderName =
      defenders.find((d) => d.player_id === defenderPlayerId)?.player?.name ?? "defensor";

    const label = pendingDefenseEvent === "MATACANAS" ? "Matacanes" : "Recollida";

    const ok = await confirmAction("Confirmar", `${label} per ${defenderName}?`);
    if (!ok) return;

    await safeSave(async () => {
      const play = await createPlay(attacker.player_id);
      if (!play) return;

      if (pendingDefenseEvent === "MATACANAS") {
        const { error } = await supabase
          .from("play")
          .update({ eliminated: true, eliminated_by_player_id: defenderPlayerId })
          .eq("id", play.id);

        if (error) {
          Alert.alert("Error", `No s'ha pogut marcar eliminated: ${error.message}`);
        }

        await createPlayEvent(play.id, "MATACANAS", 1, defenderPlayerId);
      } else if (pendingDefenseEvent === "AIR_CATCH") {
        await createPlayEvent(play.id, "AIR_CATCH", 1, defenderPlayerId);
      }

      setPendingDefenseEvent(null);
      setDefenderModalOpen(false);
      await afterSavedAdvance();
    });
  }

  async function onExit() {
    // ✅ Un cop hi ha 1 play registrat al round, no es pot tornar enrere a Lineup
    if (playsDone > 0) {
      Alert.alert(
        "Lineup bloquejada",
        "Ja s'ha registrat la primera tirada. No es pot tornar a la lineup."
      );
      return;
    }

    const ok = await confirmAction(
      "Sortir",
      "Vols sortir de l'arbitratge? Encara no hi ha cap tirada registrada; podràs ajustar la lineup."
    );
    if (!ok) return;
    router.replace({
  pathname: "/lineup",
  params: { matchId: String(matchId), roundId: String(currentRound.round_id) },
});
  }


  if (loading || !currentRound) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const teams = matchTeams ?? {
    aName: "Equip A",
    bName: "Equip B",
  };

  const playActionsDisabled = saving || finishedLocal || awaitingTurnConfirmation;
  const finishTurnDisabled = saving || finishedLocal;

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 24 }}>
      {/* Header: sortir (esquerra) + cronòmetre (dreta) */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <Pressable
          onPress={onExit}
          disabled={saving || playsDone > 0}
          style={{
            alignSelf: "flex-start",
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "#ccc",
            opacity: saving || playsDone > 0 ? 0.35 : 1,
          }}
        >
          <Text style={{ fontWeight: "600" }}>⤴︎ Sortir</Text>
        </Pressable>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          {/* Temps (només números) */}
          <View
            style={{
              paddingVertical: 6,
              paddingHorizontal: 10,
              borderRadius: 999,
              borderWidth: 1,
              borderColor: timerRunning ? "#2563EB" : "#ddd",
              backgroundColor: timerRunning ? "#EFF6FF" : "#F9FAFB",
            }}
          >
            <Text style={{ fontWeight: "900", fontVariant: ["tabular-nums"] as any }}>
              {timerDisplay}
            </Text>
          </View>

          {/* Botó PRO (sense text). Tap: start/stop. Long press: reset */}
          <Pressable
            onPress={toggleTimer}
            onLongPress={resetTimer}
            delayLongPress={450}
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              justifyContent: "center",
              alignItems: "center",
              borderWidth: 1,
              borderColor: timerRunning ? "#1D4ED8" : "#16A34A",
              backgroundColor: timerRunning ? "#DBEAFE" : "#DCFCE7",
            }}
          >
            <Text style={{ fontSize: 18 }}>{timerRunning ? "⏸️" : "⏱️"}</Text>
          </Pressable>
        </View>
      </View>

      <Text style={{ fontSize: 20, fontWeight: "bold", textAlign: "center" }}>
        {headerTitleAttack}
      </Text>
      <Text style={{ fontSize: 20, fontWeight: "bold", textAlign: "center" }}>
        {headerTitleDefense}
      </Text>
      <Text style={{ textAlign: "center", color: "#666", marginTop: 6 }}>
        Round {currentRound.match_round_number} · Torn {currentRound.turn}
      </Text>

      <View style={{ height: 16 }} />

      <View
        style={{
          padding: 14,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#ddd",
          backgroundColor: "#fafafa",
          alignItems: "center",
        }}
      >
        <Text style={{ fontSize: 14, color: "#666" }}>Tira ara:</Text>
        <Text style={{ fontSize: 24, fontWeight: "900", marginTop: 6 }}>
          {attacker?.player?.name ?? "—"}
        </Text>
        <Text style={{ marginTop: 6, color: "#666" }}>
          {Math.min(playsDone + 1, attackers.length || 6)} / {attackers.length || 6}
        </Text>
      </View>

      <View style={{ height: 12 }} />

      {awaitingTurnConfirmation ? (
  <Pressable
    onPress={() => {
      continueAfterTurnCompleted();
    }}
    disabled={finishTurnDisabled}
    style={{
      marginTop: 4,
      padding: 14,
      borderRadius: 12,
      backgroundColor: "#111827",
      alignItems: "center",
      opacity: finishTurnDisabled ? 0.45 : 1,
    }}
  >
    <Text style={{ fontWeight: "900", fontSize: 15, color: "white" }}>
      ✅ Finalitzar torn
    </Text>
  </Pressable>
) : null}

      <View style={{ height: 4 }} />

      <Pressable
        onPress={() => setCanasModalOpen(true)}
        disabled={playActionsDisabled}
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: "#e6f7ed",
          borderWidth: 1,
          borderColor: "#cfeedd",
          alignItems: "center",
          marginBottom: 10,
          opacity: playActionsDisabled ? 0.45 : 1,
        }}
      >
        <Text style={{ fontWeight: "900", fontSize: 16 }}>Sumar canes</Text>
      </Pressable>

      <Pressable
        onPress={async () => {
          const ok = await confirmAction("Confirmar", "Registrar Matacanes?");
          if (!ok) return;
          setPendingDefenseEvent("MATACANAS");
          setDefenderModalOpen(true);
        }}
        disabled={playActionsDisabled}
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: "#ffe8e8",
          borderWidth: 1,
          borderColor: "#f3caca",
          alignItems: "center",
          marginBottom: 10,
          opacity: playActionsDisabled ? 0.45 : 1,
        }}
      >
        <Text style={{ fontWeight: "900", fontSize: 16 }}>Matacanes</Text>
        <Text style={{ color: "#7a2f2f", marginTop: 2 }}>Selecciona defensor</Text>
      </Pressable>

      <Pressable
        onPress={async () => {
          const ok = await confirmAction("Confirmar", "Registrar Recollida?");
          if (!ok) return;
          setPendingDefenseEvent("AIR_CATCH");
          setDefenderModalOpen(true);
        }}
        disabled={playActionsDisabled}
        style={{
          padding: 14,
          borderRadius: 12,
          backgroundColor: "#e8f0ff",
          borderWidth: 1,
          borderColor: "#cbdaf7",
          alignItems: "center",
          opacity: playActionsDisabled ? 0.45 : 1,
        }}
      >
        <Text style={{ fontWeight: "900", fontSize: 16 }}>Recollida</Text>
        <Text style={{ color: "#2f457a", marginTop: 2 }}>Selecciona defensor</Text>
      </Pressable>
<View style={{ height: 12 }} />

<Pressable
        onPress={undoPreviousPlay}
        disabled={saving || finishedLocal || playsDone <= 0 || !canUndoNow}
        style={{
          padding: 12,
          borderRadius: 12,
          backgroundColor: "#FFF7ED",
          borderWidth: 1,
          borderColor: "#FDBA74",
          alignItems: "center",
          opacity: saving || finishedLocal || playsDone <= 0 || !canUndoNow ? 0.45 : 1,
        }}
      >
        <Text style={{ fontWeight: "900", fontSize: 15, color: "#9A3412" }}>
          ↩️ Desfer última tirada
        </Text>
      </Pressable>

      {/* Modal Canes */}
      <Modal visible={canasModalOpen} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 14,
              padding: 16,
              borderWidth: 1,
              borderColor: "#ddd",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", textAlign: "center" }}>
              Canes a sumar: {canasValue}
            </Text>

            <View style={{ height: 12 }} />

            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Pressable
                onPress={() => setCanasValue((v) => Math.max(0, v - 20))}
                disabled={playActionsDisabled}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ccc",
                  opacity: playActionsDisabled ? 0.45 : 1,
                }}
              >
                <Text style={{ fontWeight: "900", fontSize: 16 }}>− 20</Text>
              </Pressable>
<Pressable
                onPress={() => setCanasValue((v) => Math.max(0, v - 5))}
                disabled={playActionsDisabled}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ccc",
                  opacity: playActionsDisabled ? 0.45 : 1,
                }}
              >
                <Text style={{ fontWeight: "900", fontSize: 16 }}>− 5</Text>
              </Pressable>

              <Pressable
                onPress={() => addCanes(5)}
                disabled={playActionsDisabled}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ccc",
                  opacity: playActionsDisabled ? 0.45 : 1,
                }}
              >
                <Text style={{ fontWeight: "900", fontSize: 16 }}>+ 5</Text>
              </Pressable>
<Pressable
                onPress={() => addCanes(20)}
                disabled={playActionsDisabled}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ccc",
                  opacity: playActionsDisabled ? 0.45 : 1,
                }}
              >
                <Text style={{ fontWeight: "900", fontSize: 16 }}>+ 20</Text>
              </Pressable>
            </View>

            <View style={{ height: 14 }} />

            <Pressable
              onPress={saveCanasPlayerOnly}
              disabled={playActionsDisabled}
              style={{
                padding: 14,
                borderRadius: 12,
                backgroundColor: "#f2f2f2",
                borderWidth: 1,
                borderColor: "#ddd",
                alignItems: "center",
                marginBottom: 10,
                opacity: playActionsDisabled ? 0.45 : 1,
              }}
            >
              <Text style={{ fontWeight: "900" }}>
                Sumar canes al jugador 
              </Text>
              <Text style={{ color: "#666", marginTop: 2 }}>Només el jugador suma</Text>
            </Pressable>

            <Pressable
              onPress={saveCanasAttackMeter}
              disabled={saving || finishedLocal || canasValue <= 0}
              style={{
                padding: 14,
                borderRadius: 12,
                backgroundColor: "#e6f7ed",
                borderWidth: 1,
                borderColor: "#cfeedd",
                alignItems: "center",
                marginBottom: 10,
                opacity: (saving || canasValue <= 0) ? 0.45 : 1,
              }}
            >
              <Text style={{ fontWeight: "900" }}>Metre guanyat per atacant</Text>
              <Text style={{ color: "#3a6b4f", marginTop: 2 }}>Jugador + Equip sumen</Text>
            </Pressable>

            <Pressable
              onPress={saveCanasDefenseMeter}
              disabled={saving || finishedLocal || canasValue <= 0}
              style={{
                padding: 14,
                borderRadius: 12,
                backgroundColor: "#fff2e6",
                borderWidth: 1,
                borderColor: "#f5d7b8",
                alignItems: "center",
                marginBottom: 10,
                opacity: (saving || canasValue <= 0) ? 0.45 : 1,
              }}
            >
              <Text style={{ fontWeight: "900" }}>Metre guanyat per defensor</Text>
              <Text style={{ color: "#7a4a2f", marginTop: 2 }}>
                Defensa suma · atacant 0
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setCanasModalOpen(false)}
              disabled={playActionsDisabled}
              style={{ alignItems: "center", padding: 10, opacity: saving ? 0.45 : 1 }}
            >
              <Text style={{ color: "#666", fontWeight: "700" }}>Cancel·lar</Text>
            </Pressable>
{canasValue <= 0 && (
  <View style={{
    backgroundColor: "#fff3cd",
    padding: 10,
    borderRadius: 8,
    marginTop: 8
  }}>
    <Text style={{ color: "#856404", fontSize: 13 }}>
      ⚠ Per demanar metre has d'introduir canes majors que 0.
    </Text>
  </View>
)}
          </View>
        </View>
      </Modal>


{/* Modal Conversió metres / canes */}
<Modal visible={conversionModalOpen} transparent animationType="fade">
  <View
    style={{
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.35)",
      justifyContent: "center",
      padding: 18,
    }}
  >
    <View
      style={{
        backgroundColor: "white",
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: "#ddd",
        maxHeight: "80%",
      }}
    >
      <FlatList
        data={conversionRows}
        keyExtractor={(it) => String(it.meters)}
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
        renderItem={({ item }) => (
          <View
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#eee",
              backgroundColor: "#fafafa",
              flexDirection: "row",
              justifyContent: "space-between",
            }}
          >
            <Text style={{ fontWeight: "900" }}>{item.meters} m</Text>
            <Text style={{ fontWeight: "900" }}>{item.canes} canes</Text>
          </View>
        )}
      />

      <View style={{ height: 12 }} />

      <Pressable
        onPress={() => setConversionModalOpen(false)}
        style={{
          paddingVertical: 12,
          borderRadius: 12,
          backgroundColor: "black",
          alignItems: "center",
        }}
      >
        <Text style={{ color: "white", fontWeight: "900" }}>Tancar</Text>
      </Pressable>
    </View>
  </View>
</Modal>

      {/* Modal Defensors */}
      <Modal visible={defenderModalOpen} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 14,
              padding: 16,
              borderWidth: 1,
              borderColor: "#ddd",
              maxHeight: "75%",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", textAlign: "center" }}>
              Qui ho ha fet?
            </Text>
            <Text style={{ textAlign: "center", color: "#666", marginTop: 4 }}>
              {pendingDefenseEvent === "MATACANAS" ? "Matacanes" : "Recollida"}
            </Text>

            <View style={{ height: 10 }} />

            <FlatList
              data={defenders}
              keyExtractor={(item) => String(item.id)}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => onPickDefender(item.player_id)}
                  disabled={playActionsDisabled}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#eee",
                    backgroundColor: "#fafafa",
                    marginBottom: 8,
                    alignItems: "center",
                    opacity: playActionsDisabled ? 0.6 : 1,
                  }}
                >
                  <Text style={{ fontWeight: "900" }}>
                    {item.player?.name ?? `Jugador ${item.player_id}`}
                  </Text>
                </Pressable>
              )}
            />

            <Pressable
              onPress={() => {
                setPendingDefenseEvent(null);
                setDefenderModalOpen(false);
              }}
              disabled={playActionsDisabled}
              style={{ alignItems: "center", padding: 10, opacity: saving ? 0.6 : 1 }}
            >
              <Text style={{ color: "#666", fontWeight: "700" }}>Cancel·lar</Text>
            </Pressable>
          </View>
        </View>
      </Modal>

<View style={{ height: 15 }} />

<Pressable
  onPress={() => setConversionModalOpen(true)}
  style={{
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#ddd",
    backgroundColor: "white",
    marginBottom: 10,
  }}
>
  <Text style={{ fontWeight: "900" }}>Conversió metres/canes</Text>
</Pressable>
      {/* ✅ MARCADOR (scrollable) */}
      <View
        style={{
          marginTop: 12,
          padding: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "#ddd",
          backgroundColor: "white",
        }}
      >

<Text style={{ textAlign: "center", color: "#666", fontWeight: "700" }}>
          Marcador en directe {scoreLoading ? "· actualitzant..." : ""}
        </Text>

        <View style={{ height: 8 }} />
<View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <View style={{ flex: 1, paddingRight: 8 }}>
            <Text numberOfLines={1} style={{ fontWeight: "800" }}>
              {teams.aName}
            </Text>
          </View>

          <Text style={{ fontSize: 20, fontWeight: "900" }}>
            {scoreA} - {scoreB}
          </Text>

          <View style={{ flex: 1, paddingLeft: 8, alignItems: "flex-end" }}>
            <Text numberOfLines={1} style={{ fontWeight: "800" }}>
              {teams.bName}
            </Text>
          </View>
        </View>
<View style={{ height: 8 }} />
<Text
          style={{
            textAlign: "center",
            fontWeight: "500",
            fontSize: 14,
            marginBottom: 8,
          }}
        >
          Diferència: {Math.abs(scoreA - scoreB)}
        </Text>
      </View>

      {/* ✅ Modal resultat final */}
      
      {/* ✅ Bélit d'Or (només si partit empatat en eliminatòries) */}
      <Modal visible={belitDorModalOpen} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 14,
              padding: 16,
              borderWidth: 1,
              borderColor: "#ddd",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "800", marginBottom: 8, textAlign: "center" }}>
              No es pot empatar
            </Text>
            <Text style={{ fontSize: 14, color: "#444", marginBottom: 14, textAlign: "center" }}>
              S'ha de jugar el bélit d'or. Selecciona el guanyador:
            </Text>

            <View style={{ gap: 10 }}>
              <Pressable
                disabled={saving}
                onPress={() => {
                  const name = matchTeamsFixed?.aName ?? "Equip A";
                  Alert.alert(
                    "Confirmació",
                    `Estàs segur que ha guanyat el bélit d'or ${name}?`,
                    [
                      { text: "Cancel·lar", style: "cancel" },
                      { text: "Sí", style: "default", onPress: () => applyBelitDor("A") },
                    ]
                  );
                }}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: "#111827",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "white", fontWeight: "800" }}>{matchTeamsFixed?.aName ?? "Equip A"}</Text>
              </Pressable>

              <Pressable
                disabled={saving}
                onPress={() => {
                  const name = matchTeamsFixed?.bName ?? "Equip B";
                  Alert.alert(
                    "Confirmació",
                    `Estàs segur que ha guanyat el bélit d'or ${name}?`,
                    [
                      { text: "Cancel·lar", style: "cancel" },
                      { text: "Sí", style: "default", onPress: () => applyBelitDor("B") },
                    ]
                  );
                }}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: "#111827",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "white", fontWeight: "800" }}>{matchTeamsFixed?.bName ?? "Equip B"}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

<Modal visible={finalModalOpen} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            padding: 10,
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 14,
              padding: 16,
              borderWidth: 1,
              borderColor: "#ddd",
              alignItems: "center",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900" }}>Resultat final</Text>

            <View style={{ height: 10 }} />

            <Text style={{ fontSize: 20, fontWeight: "600" }}>{matchTeams?.aName ?? "Equip A"} - {finalScores?.a ?? scoreA}</Text>

            <View style={{ height: 10 }} />

            <Text style={{ fontSize: 20, fontWeight: "600" }}>{matchTeams?.bName ?? "Equip B"} - {finalScores?.b ?? scoreB}</Text>

            <View style={{ height: 10 }} />

            <Text style={{ color: "#666", textAlign: "center" }}>
              Partit finalitzat. Pots comunicar el resultat als equips.
            </Text>

            <View style={{ height: 14 }} />

            <Pressable
              onPress={() => {
                setFinalModalOpen(false);
                router.replace("/matches");
              }}
              style={{
                paddingVertical: 12,
                paddingHorizontal: 16,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#ccc",
              }}
            >
              <Text style={{ fontWeight: "900" }}>Finalitzat</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
</ScrollView>
  );
}
