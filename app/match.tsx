import {
  useEffect, useMemo, useRef, useState } from "react";
import {
  View, Text, ActivityIndicator, Pressable, Alert,
    ScrollView,
  Platform,
  Modal,
  Animated,
  Easing
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../src/supabase";
import { FontAwesome5 } from "@expo/vector-icons";

function isUnassignedReferee(refereeId: number | null | undefined) {
  return refereeId === 1 || refereeId === null || typeof refereeId === "undefined";
}

export default function MatchScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const matchId = Number(params.id);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [matchView, setMatchView] = useState<any | null>(null);
  const [matchRow, setMatchRow] = useState<any | null>(null);
  const [myRefereeId, setMyRefereeId] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [simulateModalOpen, setSimulateModalOpen] = useState(false);
  const [simulateChecking, setSimulateChecking] = useState(false);
  const [simulateCanRun, setSimulateCanRun] = useState<boolean | null>(null);
  const [simulatePreviewText, setSimulatePreviewText] = useState("Carrega la previsualització abans de simular.");
  const [simulateTeamACount, setSimulateTeamACount] = useState<number | null>(null);
  const [simulateTeamBCount, setSimulateTeamBCount] = useState<number | null>(null);

  const [started, setStarted] = useState(false);
  const [firstTeamId, setFirstTeamId] = useState<number | null>(null);

  // ✅ Configurable: number of match_rounds per match (default 2)
  // Championship config key: "match_rounds" (integer). Usually stored as text in championship_config.value
  const [matchRoundsCount, setMatchRoundsCount] = useState<number>(2);

  const [coinFlipResult, setCoinFlipResult] = useState<"A" | "B" | null>(null);
  const [coinFlipAt, setCoinFlipAt] = useState<number | null>(null);

  
  const [coinFlipVisible, setCoinFlipVisible] = useState(false);
  const [coinFlipSpinning, setCoinFlipSpinning] = useState(false);
  const [coinFlipPendingPick, setCoinFlipPendingPick] = useState<"A" | "B" | null>(null);

  const [coinFlipStep, setCoinFlipStep] = useState<"pickFace" | "spinning" | "winnerPick">("pickFace");
  const [coinFlipFaceTeam, setCoinFlipFaceTeam] = useState<"A" | "B" | null>(null);
  const [coinFlipFace, setCoinFlipFace] = useState<"Cara" | "Creu" | null>(null);
  const [coinFlipWinnerTeam, setCoinFlipWinnerTeam] = useState<"A" | "B" | null>(null);
  const [coinFlipWinnerChoice, setCoinFlipWinnerChoice] = useState<"Ataca" | "Defensa" | null>(null);
  const [coinFlipHighlight, setCoinFlipHighlight] = useState(false);


  const coinSpin = useRef(new Animated.Value(0)).current;
  const coinScale = useRef(new Animated.Value(1)).current;


  const coinSpinDegrees = useMemo(
    () =>
      coinSpin.interpolate({
        inputRange: [0, 1],
        // 4 full spins
        outputRange: ["0deg", "1440deg"],
      }),
    [coinSpin]
  );

  const coinSize = Platform.OS === "ios" ? 120 : 140;


  const pickName = (v: any, side: "A" | "B") => {
    if (!v) return null;

    const candidates =
      side === "A"
        ? [
            "team_a_name",
            "teamA_name",
            "team_a",
            "team_a_team_name",
            "team_a_club_name",
            "team_a_display_name",
            "home_team_name",
            "home_name",
            "team_home_name",
          ]
        : [
            "team_b_name",
            "teamB_name",
            "team_b",
            "team_b_team_name",
            "team_b_club_name",
            "team_b_display_name",
            "away_team_name",
            "away_name",
            "team_away_name",
          ];

    for (const key of candidates) {
      const val = (v as any)[key];
      if (typeof val === "string" && val.trim()) return val.trim();
      if (val && typeof val === "object" && typeof val.name === "string" && val.name.trim()) return val.name.trim();
    }
    return null;
  };

  const pickId = (v: any, side: "A" | "B") => {
    const candidates =
      side === "A"
        ? ["team_a_id", "teamA_id", "team_a_team_id", "home_team_id", "home_id"]
        : ["team_b_id", "teamB_id", "team_b_team_id", "away_team_id", "away_id"];
    for (const key of candidates) {
      const val = (v as any)?.[key];
      const n = typeof val === "number" ? val : typeof val === "string" ? Number(val) : NaN;
      if (!Number.isNaN(n) && n) return n;
    }
    return null;
  };

  const teamA = useMemo(() => {
    if (!matchView) return null;
    const id = pickId(matchView, "A");
    const name = pickName(matchView, "A") ?? "Equip A";
    return id ? { id, name } : null;
  }, [matchView]);

  const teamB = useMemo(() => {
    if (!matchView) return null;
    const id = pickId(matchView, "B");
    const name = pickName(matchView, "B") ?? "Equip B";
    return id ? { id, name } : null;
  }, [matchView]);

  const winnerTeamName =
    coinFlipWinnerTeam === "A" ? teamA?.name ?? "Equip A" : coinFlipWinnerTeam === "B" ? teamB?.name ?? "Equip B" : null;

  const coinFlipModal = (
    <Modal
      visible={coinFlipVisible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (coinFlipSpinning) return;
        setCoinFlipVisible(false);
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "center",
          alignItems: "center",
          padding: 18,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: "white",
            borderRadius: 18,
            padding: 18,
            borderWidth: 1,
            borderColor: "#eee",
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 }}>
            <FontAwesome5 name="coins" size={18} />
            <Text style={{ fontSize: 20, fontWeight: "900" }}>Moneda a l'aire</Text>
          </View>

          <Text style={{ marginTop: 6, color: "#666", fontWeight: "600", textAlign: "center" }}>
            {coinFlipStep === "pickFace"
              ? "Escull quin equip és Cara i tira la moneda"
              : coinFlipSpinning
                ? "Tirant la moneda…"
                : "Resultat"}
          </Text>

          <View style={{ alignItems: "center", marginTop: 16, marginBottom: 10 }}>
            <Animated.View
              style={{
                width: coinSize,
                height: coinSize,
                borderRadius: coinSize / 2,
                backgroundColor: "#fff",
                justifyContent: "center",
                alignItems: "center",
                // ✅ 2D transforms only: stable in iOS + Android (Expo Go)
                transform: [
                  { scale: coinScale },
                  { rotate: coinSpinDegrees },
                ],
              }}
            >
              {/* Outer ring */}
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  inset: 0,
                  borderRadius: coinSize / 2,
                  borderWidth: 2,
                  borderColor: "#E7E7EE",
                  backgroundColor: "white",
                }}
              />
              {/* Inner disc */}
              <View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  inset: Math.round(coinSize * 0.08),
                  borderRadius: (coinSize * 0.84) / 2,
                  backgroundColor: "#FAFAFF",
                  borderWidth: 1,
                  borderColor: "#ECECF6",
                }}
              />

              {/* Content: during spin keep it clean; after spin show only the visible face */}
              {coinFlipSpinning || !coinFlipFace ? (
                <View style={{ alignItems: "center", gap: 8 }}>
                  <FontAwesome5 name="coins" size={Math.round(coinSize * 0.42)} color="#111" />
                </View>
              ) : (
                <View style={{ alignItems: "center", paddingHorizontal: 10 }}>
                  <Text style={{ fontSize: 12, fontWeight: "900", color: "#666", letterSpacing: 0.8 }}>
                    {coinFlipFace === "Cara" ? "CARA" : "CREU"}
                  </Text>
                  <Text
                    numberOfLines={2}
                    style={{
                      marginTop: 6,
                      fontSize: 16,
                      fontWeight: "1000" as any,
                      color: "#111",
                      textAlign: "center",
                    }}
                  >
                    {coinFlipWinnerTeam === "A" ? (teamA?.name ?? "Equip A") : (teamB?.name ?? "Equip B")}
                  </Text>
                </View>
              )}
            </Animated.View>
          </View>

          {coinFlipStep === "pickFace" ? (
            <View style={{ marginTop: 4 }}>
              <Text style={{ textAlign: "center", fontWeight: "900", fontSize: 16 }}>Quin equip és Cara?</Text>

              <View style={{ flexDirection: "row", gap: 10, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
                {(["A", "B"] as const).map((t) => {
                  const selected = coinFlipFaceTeam === t;
                  const label = t === "A" ? teamA?.name ?? "Equip A" : teamB?.name ?? "Equip B";
                  return (
                    <Pressable
                      key={t}
                      onPress={() => setCoinFlipFaceTeam(t)}
                      style={{
                        paddingVertical: 10,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        borderWidth: 2,
                        borderColor: selected ? "#111" : "#ddd",
                        backgroundColor: selected ? "#f5f5f5" : "white",
                        minWidth: 160,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ fontWeight: "900" }}>Cara: {label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <View style={{ height: 14 }} />

              <Pressable
                disabled={coinFlipSpinning}
                onPress={startCoinFlipSpin}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: "#111",
                  alignItems: "center",
                  opacity: coinFlipSpinning ? 0.6 : 1,
                }}
              >
                <Text style={{ color: "white", fontWeight: "900" }}>Tirar moneda</Text>
              </Pressable>

              <Pressable
                disabled={coinFlipSpinning}
                onPress={() => setCoinFlipVisible(false)}
                style={{ paddingVertical: 10, alignItems: "center", marginTop: 6, opacity: coinFlipSpinning ? 0.6 : 1 }}
              >
                <Text style={{ color: "#666", fontWeight: "800" }}>Tancar</Text>
              </Pressable>
            </View>
          ) : (
            <View style={{ marginTop: 4 }}>
              {winnerTeamName ? (
                <Text style={{ textAlign: "center", fontWeight: "900", fontSize: 18 }}>
                  Guanya: {winnerTeamName}
                </Text>
              ) : null}

              {coinFlipFace ? (
                <Text style={{ textAlign: "center", marginTop: 8, color: "#666", fontWeight: "700" }}>
                  Ha sortit: {coinFlipFace}
                </Text>
              ) : null}

              <View style={{ height: 14 }} />

              <Pressable
                onPress={() => setCoinFlipVisible(false)}
                style={{
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: "#111",
                  alignItems: "center",
                }}
              >
                <Text style={{ color: "white", fontWeight: "900" }}>Ok</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );

  const simulateModal = (
    <Modal
      visible={simulateModalOpen}
      transparent
      animationType="fade"
      onRequestClose={() => {
        if (saving || simulateChecking) return;
        setSimulateModalOpen(false);
      }}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.55)",
          justifyContent: "center",
          alignItems: "center",
          padding: 18,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: "white",
            borderRadius: 18,
            padding: 18,
            borderWidth: 1,
            borderColor: "#eee",
          }}
        >
          <Text style={{ fontSize: 20, fontWeight: "900", textAlign: "center" }}>🧪 Simular partit complet</Text>
          <Text style={{ marginTop: 8, color: "#666", fontWeight: "600", textAlign: "center" }}>
            Només per admins. Aquesta opció només funciona si el partit està completament buit.
          </Text>

          <View style={{ height: 16 }} />

          <View
            style={{
              borderWidth: 1,
              borderColor: simulateCanRun === false ? "#FCA5A5" : "#E5E7EB",
              borderRadius: 14,
              padding: 14,
              backgroundColor: simulateCanRun === false ? "#FEF2F2" : "#F9FAFB",
            }}
          >
            <Text style={{ fontWeight: "900", fontSize: 16, marginBottom: 8 }}>Previsualització</Text>
            <Text style={{ color: "#374151", fontWeight: "700", marginBottom: 4 }}>
              Jugadors {teamA?.name ?? "Equip A"}: {simulateTeamACount ?? "-"}
            </Text>
            <Text style={{ color: "#374151", fontWeight: "700", marginBottom: 8 }}>
              Jugadors {teamB?.name ?? "Equip B"}: {simulateTeamBCount ?? "-"}
            </Text>
            <Text style={{ color: simulateCanRun === false ? "#B91C1C" : "#111827", fontWeight: "900" }}>
              {simulatePreviewText}
            </Text>
          </View>

          <Pressable
            onPress={loadSimulationPreview}
            disabled={saving || simulateChecking}
            style={{
              marginTop: 14,
              paddingVertical: 12,
              borderRadius: 12,
              backgroundColor: "#F5F3FF",
              borderWidth: 1,
              borderColor: "#DDD6FE",
              alignItems: "center",
              opacity: saving || simulateChecking ? 0.6 : 1,
            }}
          >
            {simulateChecking ? (
              <ActivityIndicator color="#6D28D9" />
            ) : (
              <Text style={{ fontWeight: "900", color: "#6D28D9" }}>Carregar previsualització</Text>
            )}
          </Pressable>

          <Pressable
            onPress={runFullSimulation}
            disabled={saving || simulateChecking || !simulateCanRun}
            style={{
              marginTop: 10,
              paddingVertical: 14,
              borderRadius: 12,
              backgroundColor: "#111827",
              alignItems: "center",
              opacity: saving || simulateChecking || !simulateCanRun ? 0.6 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={{ color: "white", fontWeight: "900" }}>Acceptar simulació</Text>
            )}
          </Pressable>

          <Pressable
            onPress={() => setSimulateModalOpen(false)}
            disabled={saving || simulateChecking}
            style={{ paddingVertical: 12, alignItems: "center", marginTop: 10, opacity: saving || simulateChecking ? 0.6 : 1 }}
          >
            <Text style={{ color: "#666", fontWeight: "800" }}>Tancar</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );

  useEffect(() => {
    if (!matchId || Number.isNaN(matchId)) return;
    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  async function init() {
    setLoading(true);

    const { data: sessionRes, error: sessionErr } = await supabase.auth.getSession();
    if (sessionErr) {
      Alert.alert("Error", sessionErr.message);
      setLoading(false);
      return;
    }

    const user = sessionRes.session?.user;
    if (!user) {
      router.replace("/login");
      return;
    }

    const { data: adminRow } = await supabase
      .from("championship_admin_user")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();

    setIsAdmin(!!adminRow);

    const { data: refMap, error: refErr } = await supabase
      .from("referee_user")
      .select("referee_id")
      .eq("user_id", user.id)
      .single();

    if (refErr || !refMap) {
      Alert.alert("Error", "No s'ha trobat el teu referee_id (referee_user).");
      setLoading(false);
      return;
    }
    setMyRefereeId(refMap.referee_id);

    // Carrega match view
    const { data: mv, error: mvErr } = await supabase
      .from("v_pending_matches")
      .select("*")
      .eq("match_id", matchId)
      .single();

    if (mvErr || !mv) {
      Alert.alert("Error", "No s'ha pogut carregar el partit.");
      setLoading(false);
      return;
    }
    setMatchView(mv);

    // Carrega match real
    const { data: mr, error: mrErr } = await supabase
      .from("match")
      .select("id, referee_id, is_finished, championship_id")
      .eq("id", matchId)
      .single();

    if (mrErr || !mr) {
      Alert.alert("Error", "No s'ha pogut carregar el match (taula match).");
      setLoading(false);
      return;
    }
    setMatchRow(mr);

    // ✅ Load config: match_rounds (phase_id NULL). Default 2.
    try {
      const champId = (mr as any)?.championship_id;
      if (champId) {
        const { data: cfg, error: cfgErr } = await supabase
          .from("championship_config")
          .select("value")
          .eq("championship_id", champId)
          .is("phase_id", null)
          .eq("key", "match_rounds")
          .maybeSingle();

        if (!cfgErr && cfg?.value != null) {
          const n = Number(String(cfg.value).trim());
          if (!Number.isNaN(n)) setMatchRoundsCount(Math.max(1, Math.floor(n)));
        }
      }
    } catch {
      // Silent fallback to default
    }

    // ✅ DETECTA si ja hi ha rounds creats
    await detectPreparedState();

    // Si no té àrbitre, NO deixem continuar si no s'assigna
    if (isUnassignedReferee(mr.referee_id)) {
      Alert.alert(
        "Partit sense àrbitre",
        "Aquest partit no té àrbitre. Vols assignar-te'l a tu?",
        [
          {
            text: "No",
            style: "cancel",
            onPress: () => router.back(),
          },
          {
            text: "Sí",
            onPress: async () => {
              await assignSelfAsReferee(refMap.referee_id);
              await detectPreparedState();
            },
          },
        ]
      );
    }

    setLoading(false);
  }

  async function refreshMatch() {
    const { data: mr } = await supabase
      .from("match")
      .select("id, referee_id, is_finished, championship_id")
      .eq("id", matchId)
      .single();
    if (mr) setMatchRow(mr);

    const { data: mv } = await supabase
      .from("v_pending_matches")
      .select("*")
      .eq("match_id", matchId)
      .single();
    if (mv) setMatchView(mv);
  }

  async function assignSelfAsReferee(refereeId: number) {
    const { error } = await supabase.from("match").update({ referee_id: refereeId }).eq("id", matchId);
    if (error) {
      Alert.alert("Error", `No s'ha pogut assignar l'àrbitre: ${error.message}`);
      return;
    }
    await refreshMatch();
    Alert.alert("Fet", "T'has assignat aquest partit.");
  }

  async function assignGenericReferee() {
    const { error } = await supabase.from("match").update({ referee_id: 2 }).eq("id", matchId);
    if (error) {
      Alert.alert("Error", `No s'ha pogut assignar l'àrbitre genèric: ${error.message}`);
      return;
    }
    await refreshMatch();
    Alert.alert("Fet", "Assignat a àrbitre genèric.");
  }


  // ✅ Robust: usa la view v_rounds_by_match
  async function detectPreparedState() {
    const { data: rounds, error } = await supabase
      .from("v_rounds_by_match")
      .select("match_round_number, turn, attacking_team_id")
      .eq("match_id", matchId);

    if (error || !rounds || rounds.length === 0) {
      setStarted(false);
      setFirstTeamId(null);
      return;
    }

    setStarted(true);

    // Deduïm qui comença: match_round 1, turn 1
    const r11 = rounds.find((r: any) => r.match_round_number === 1 && r.turn === 1);
    setFirstTeamId(r11?.attacking_team_id ?? null);
  }

  async function ensureMatchRounds(total: number) {
    const { data: existing, error } = await supabase
      .from("match_round")
      .select("id, number")
      .eq("match_id", matchId);

    if (error) throw error;

    const wanted = Math.max(1, Math.floor(total || 2));
    const have = new Set<number>((existing ?? []).map((x: any) => Number(x.number)).filter((n) => !Number.isNaN(n)));
    for (let i = 1; i <= wanted; i++) {
      if (!have.has(i)) {
        const { error: insErr } = await supabase.from("match_round").insert({ match_id: matchId, number: i });
        if (insErr) throw insErr;
      }
    }

    const { data: mr2, error: e3 } = await supabase
      .from("match_round")
      .select("id, number")
      .eq("match_id", matchId);

    if (e3) throw e3;
    return mr2 ?? [];
  }


  // ✅ Remove any stale match_rounds beyond the configured total (and their dependent rounds).
  // This matters if the match was previously prepared with a higher round count.
  async function trimExtraMatchRounds(total: number) {
    const wanted = Math.max(1, Math.floor(total || 2));

    const { data: extra, error } = await supabase
      .from("match_round")
      .select("id, number")
      .eq("match_id", matchId)
      .gt("number", wanted);

    if (error) throw error;

    if (extra && extra.length > 0) {
      const ids = extra.map((x: any) => x.id);

      // Delete dependent rounds first
      const { error: delRoundsErr } = await supabase.from("round").delete().in("match_round_id", ids);
      if (delRoundsErr) throw delRoundsErr;

      const { error: delMrErr } = await supabase.from("match_round").delete().in("id", ids);
      if (delMrErr) throw delMrErr;
    }
  }

  async function startMatch(first: number) {
    if (!teamA || !teamB) return;
    if (!myRefereeId) return;

    // Si ja està preparat, no fem res
    if (started) {
      Alert.alert("Info", "Aquest partit ja està preparat.");
      return;
    }

    const other = first === teamA.id ? teamB.id : teamA.id;

    setSaving(true);
    try {
      const total = Math.max(1, Math.floor(matchRoundsCount || 2));

      // Ensure we don't have leftover match_rounds from a previous configuration (e.g., 2 rounds) when now configured as 1.
      await trimExtraMatchRounds(total);

      const matchRounds = await ensureMatchRounds(total);
      const orderedMR = (matchRounds ?? [])
        .map((x: any) => ({ ...x, number: Number(x.number) }))
        .filter((x: any) => !Number.isNaN(x.number))
        .sort((a: any, b: any) => a.number - b.number)
        .filter((x: any) => x.number >= 1 && x.number <= total);

      const mr1 = orderedMR.find((x: any) => x.number === 1);
      if (!mr1) {
        Alert.alert("Error", "No s'ha pogut crear/obtenir match_round 1.");
        return;
      }

      // Si ja hi ha rounds, no dupliquem
      const { data: existingRounds, error: existingErr } = await supabase
        .from("round")
        .select("id")
        .in("match_round_id", orderedMR.length ? orderedMR.map((x: any) => x.id) : [mr1.id])
        .limit(1);

      if (existingErr) throw existingErr;

      if (existingRounds && existingRounds.length > 0) {
        await detectPreparedState();
        Alert.alert("Info", "Ja hi havia rounds creats. No s'ha duplicat res.");
        return;
      }

      const roundsToCreate: any[] = [];
      for (const mr of orderedMR) {
        roundsToCreate.push(
          { match_round_id: mr.id, number: mr.number, turn: 1, attacking_team_id: first, defending_team_id: other },
          { match_round_id: mr.id, number: mr.number, turn: 2, attacking_team_id: other, defending_team_id: first }
        );
      }

      const { error: insErr } = await supabase.from("round").insert(roundsToCreate);
      if (insErr) throw insErr;

      await detectPreparedState();
      //Guardar la variable started_at a la BBDD
      const { error: startedErr } = await supabase
          .from("match")
          .update({ started_at: new Date().toISOString() })
          .eq("id", matchId);

      if (startedErr) {
          console.warn("No s'ha pogut guardar started_at:", startedErr.message);
          // opcional: Alert.alert("Error", "No s'ha pogut guardar l'inici del partit.");
      }
      Alert.alert("Partit iniciat ✅", "Rounds creats i atac/defensa establert.");
      // ✅ Anar directament a la primera alineació (Round 1, Torn 1)
      const { data: firstRound, error: frErr } = await supabase
        .from("round")
        .select("id")
        .eq("match_round_id", mr1.id)
        .eq("turn", 1)
        .single();

      if (frErr || !firstRound) {
        Alert.alert("Error", "No s'ha pogut obtenir el primer round.");
        return;
      }

      router.replace({ pathname: "/lineup", params: { matchId: String(matchId), roundId: String(firstRound.id) } });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error iniciant el partit.");
    } finally {
      setSaving(false);
    }
  }

  
  function confirmStart(teamId: number) {
    if (!teamA || !teamB) return;

    const teamName = teamId === teamA.id ? teamA.name : teamB.name;

    Alert.alert(
      "Confirmar inici",
      `Estàs segur que comença ${teamName}?`,
      [
        { text: "Cancel·lar", style: "cancel" },
        { text: "Sí", style: "destructive", onPress: () => startMatch(teamId) },
      ]
    );
  }

/**
   * ✅ NO PRESENTAT (walkover) – crea 1 play + 1 event i tanca match a 5-0
   * Es mostra dins el bloc “Qui tira primer?”
   */
  async function finishByNoShow(absentTeamId: number) {
    if (!matchView || !matchRow || !teamA || !teamB) return;

    if (matchRow.is_finished) {
      Alert.alert("Partit Finalitzat", "Aquest partit ja està tancat.");
      return;
    }

    if (started) {
      Alert.alert(
        "No presentat",
        "Aquest partit ja està preparat/iniciat. No es pot marcar com a no presentat."
      );
      return;
    }

    const winnerTeamId = absentTeamId === teamA.id ? teamB.id : teamA.id;
    const loserTeamId = absentTeamId === teamA.id ? teamA.id : teamB.id;

    setSaving(true);
    try {
      // 1) assegurar match_round #1
      let matchRoundId: number;

      const { data: mr, error: mrErr } = await supabase
        .from("match_round")
        .select("id")
        .eq("match_id", matchId)
        .eq("number", 1)
        .maybeSingle();

      if (mrErr) throw mrErr;

      if (mr?.id) {
        matchRoundId = mr.id;
      } else {
        const { data: created, error: e2 } = await supabase
          .from("match_round")
          .insert({ match_id: matchId, number: 1 })
          .select("id")
          .single();
        if (e2) throw e2;
        matchRoundId = created.id;
      }

      // 2) assegurar round (torn 1) dins match_round #1
      let roundId: number;

      const { data: r, error: rErr } = await supabase
        .from("round")
        .select("id")
        .eq("match_round_id", matchRoundId)
        .eq("turn", 1)
        .maybeSingle();

      if (rErr) throw rErr;

      if (r?.id) {
        roundId = r.id;
      } else {
        const { data: created, error: e2 } = await supabase
          .from("round")
          .insert({
            match_round_id: matchRoundId,
            number: 1,
            turn: 1,
            attacking_team_id: winnerTeamId,
            defending_team_id: loserTeamId,
          })
          .select("id")
          .single();
        if (e2) throw e2;
        roundId = created.id;
      }

      // 3) crear play (sense jugador)
      const { data: play, error: pErr } = await supabase
        .from("play")
        .insert({
          round_id: roundId,
          attacker_player_id: null,
          eliminated: false,
          eliminated_by_player_id: null,
        })
        .select("id")
        .single();

      if (pErr) throw pErr;

      // 4) event: 5 canes a l'equip guanyador (sense jugador)
      const { error: evErr } = await supabase.from("play_event").insert({
        play_id: play.id,
        event_type: "NOT_PRESENTED",
        value: 5,
        player_id: null,
      });

      if (evErr) throw evErr;

      // 5) resultat final a match i tancar
      const scoreA = winnerTeamId === teamA.id ? 5 : 0;
      const scoreB = winnerTeamId === teamB.id ? 5 : 0;

      const { error: mErr } = await supabase
        .from("match")
        .update({
          is_finished: true,
          score_team_a: scoreA,
          score_team_b: scoreB,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        })
        .eq("id", matchId);

      if (mErr) throw mErr;

      Alert.alert("Partit finalitzat", `Resultat registrat: ${scoreA} - ${scoreB}`);
      router.replace("/matches");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Error marcant no presentat.");
    } finally {
      setSaving(false);
    }
  }

  
  function doCoinFlip() {
    // Open modal in "pick face" step (no auto-result)
    if (!teamA || !teamB) return;

    // Reset all coinflip UI state
    setCoinFlipResult(null);
    setCoinFlipAt(null);
    setCoinFlipPendingPick(null);
    setCoinFlipFaceTeam(null);
    setCoinFlipFace(null);
    setCoinFlipWinnerTeam(null);
    setCoinFlipWinnerChoice(null);
    setCoinFlipHighlight(false);

    coinSpin.setValue(0);
    coinScale.setValue(1);

    setCoinFlipStep("pickFace");
    setCoinFlipVisible(true);
    setCoinFlipSpinning(false);
  }

  function startCoinFlipSpin() {
    if (!teamA || !teamB) return;

    if (!coinFlipFaceTeam) {
      Alert.alert("Falta selecció", "Escull quin equip és Cara abans de tirar la moneda.");
      return;
    }

    setCoinFlipSpinning(true);
    setCoinFlipStep("spinning");
    setCoinFlipFace(null);
    setCoinFlipWinnerTeam(null);
    setCoinFlipWinnerChoice(null);
    setCoinFlipHighlight(false);

    // Decideix Cara/Creu i guanyador ara, però el revelem al final de l'animació
    const face: "Cara" | "Creu" = Math.random() < 0.5 ? "Cara" : "Creu";
    const winner: "A" | "B" =
      face === "Cara"
        ? coinFlipFaceTeam
        : coinFlipFaceTeam === "A"
          ? "B"
          : "A";

    // Reset animació (abans d'arrencar)
    coinSpin.setValue(0);
    coinScale.setValue(1);

    // IMPORTANT (iOS): esperar que el modal ja estigui pintat abans d'animar
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        Animated.parallel([
          Animated.timing(coinSpin, {
            toValue: 1,
            duration: 1400,
            easing: Easing.linear,
            useNativeDriver: true,
          }),
          Animated.sequence([
            Animated.timing(coinScale, {
              toValue: 1.06,
              duration: 250,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(coinScale, {
              toValue: 1,
              duration: 300,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ]).start(() => {
          setCoinFlipSpinning(false);
          setCoinFlipFace(face);
          setCoinFlipWinnerTeam(winner);
          setCoinFlipResult(winner);
          setCoinFlipAt(Date.now());
          setCoinFlipHighlight(true);
          setCoinFlipStep("winnerPick");
        });
      });
    });
  }

function onNoShowPress() {
    if (!teamA || !teamB) return;

    if (matchRow?.is_finished) {
      Alert.alert("Partit Finalitzat", "Aquest partit ja està tancat.");
      return;
    }

    if (started) {
      Alert.alert(
        "No presentat",
        "Aquest partit ja està preparat/iniciat. No es pot marcar com a no presentat."
      );
      return;
    }

    Alert.alert("No presentat", "Quin equip NO s'ha presentat?", [
  {
    text: `No presentat: ${teamA.name}`,
    style: "destructive",
    onPress: () => {
      Alert.alert(
        "Confirmar incompareixença",
        `Estàs segur que ${teamA.name} no s'ha presentat? Aquesta acció tancarà el partit.`,
        [
          { text: "Cancel·lar", style: "cancel" },
          {
            text: "Sí, confirmar",
            style: "destructive",
            onPress: () => finishByNoShow(teamA.id),
          },
        ]
      );
    },
  },
  {
    text: `No presentat: ${teamB.name}`,
    style: "destructive",
    onPress: () => {
      Alert.alert(
        "Confirmar incompareixença",
        `Estàs segur que ${teamB.name} no s'ha presentat? Aquesta acció tancarà el partit.`,
        [
          { text: "Cancel·lar", style: "cancel" },
          {
            text: "Sí, confirmar",
            style: "destructive",
            onPress: () => finishByNoShow(teamB.id),
          },
        ]
      );
    },
  },
  { text: "Cancel·lar", style: "cancel" },
]);

  }


  async function loadSimulationPreview() {
    if (!matchRow || !teamA || !teamB) return;

    try {
      setSimulateChecking(true);
      setSimulateCanRun(null);
      setSimulatePreviewText("Comprovant si el partit està buit...");

      const { data: teamPlayers, error: teamPlayersErr } = await supabase
        .from("team_player")
        .select("team_id, player_id")
        .eq("championship_id", matchRow.championship_id)
        .in("team_id", [teamA.id, teamB.id]);

      if (teamPlayersErr) throw teamPlayersErr;

      const teamACount = (teamPlayers ?? []).filter((x: any) => x.team_id === teamA.id).length;
      const teamBCount = (teamPlayers ?? []).filter((x: any) => x.team_id === teamB.id).length;

      setSimulateTeamACount(teamACount);
      setSimulateTeamBCount(teamBCount);

      if (teamACount < 4 || teamBCount < 4) {
        setSimulateCanRun(false);
        setSimulatePreviewText("❌ No es pot simular: cada equip ha de tenir almenys 4 jugadors.");
        return;
      }

      const { data: matchRounds, error: mrErr } = await supabase
        .from("match_round")
        .select("id")
        .eq("match_id", matchId);

      if (mrErr) throw mrErr;

      const matchRoundIds = (matchRounds ?? []).map((x: any) => x.id);

      if (matchRoundIds.length === 0) {
        setSimulateCanRun(true);
        setSimulatePreviewText("✅ El partit està buit. Es generaran totes les rondes, jugades i el resultat final automàticament.");
        return;
      }

      const { data: rounds, error: roundErr } = await supabase
        .from("round")
        .select("id")
        .in("match_round_id", matchRoundIds);

      if (roundErr) throw roundErr;

      const roundIds = (rounds ?? []).map((x: any) => x.id);

      const { count: lineupCount, error: lineupErr } = roundIds.length
        ? await supabase
            .from("round_lineup")
            .select("id", { count: "exact", head: true })
            .in("round_id", roundIds)
        : { count: 0, error: null as any };

      if (lineupErr) throw lineupErr;

      const { data: plays, error: playErr } = roundIds.length
        ? await supabase
            .from("play")
            .select("id")
            .in("round_id", roundIds)
        : { data: [], error: null as any };

      if (playErr) throw playErr;

      const playIds = (plays ?? []).map((x: any) => x.id);

      const { count: eventCount, error: eventErr } = playIds.length
        ? await supabase
            .from("play_event")
            .select("id", { count: "exact", head: true })
            .in("play_id", playIds)
        : { count: 0, error: null as any };

      if (eventErr) throw eventErr;

      const hasData =
        matchRoundIds.length > 0 ||
        roundIds.length > 0 ||
        (lineupCount ?? 0) > 0 ||
        (plays ?? []).length > 0 ||
        (eventCount ?? 0) > 0;

      if (hasData) {
        setSimulateCanRun(false);
        setSimulatePreviewText("❌ El partit ja té dades creades. La simulació completa només es permet en partits completament buits.");
        return;
      }

      setSimulateCanRun(true);
      setSimulatePreviewText("✅ El partit està buit. Es generaran totes les rondes, jugades i el resultat final automàticament.");
    } catch (e: any) {
      setSimulateCanRun(false);
      setSimulatePreviewText(`❌ Error comprovant el partit: ${e?.message ?? "error desconegut"}`);
    } finally {
      setSimulateChecking(false);
    }
  }

  async function runFullSimulation() {
    Alert.alert(
      "Simulació completa",
      "Segur que vols simular el partit complet? Es tancarà automàticament amb totes les jugades generades.",
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: async () => {
            try {
              setSaving(true);

              const { error } = await supabase.rpc("admin_simulate_match_full", {
                p_match_id: matchId,
              });

              if (error) throw error;

              setSimulateModalOpen(false);
              await refreshMatch();
              await detectPreparedState();

              Alert.alert("Fet ✅", "Partit simulat i finalitzat correctament.");
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut simular el partit.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  if (loading || !matchView || !matchRow || !teamA || !teamB) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>

      {coinFlipModal}
      {simulateModal}

        <ActivityIndicator size="large" />
      </View>
    );
  }

  const refereeLabel = isUnassignedReferee(matchView.referee_id)
    ? "Sense àrbitre"
    : matchView.referee_name ?? `#${matchView.referee_id}`;

  const firstTeamName =
    firstTeamId === teamA.id ? teamA.name : firstTeamId === teamB.id ? teamB.name : null;

  return (
    <View style={{ flex: 1, padding: 16 }}>
      {coinFlipModal}
      {simulateModal}
      <Pressable
        onPress={() => router.replace('/matches')}
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
{myRefereeId !== 2 && (
      <Pressable
        onPress={() => {
          if (saving || !!matchRow?.is_finished) return;
          Alert.alert(
            "Assignar",
            "Vols assignar aquest partit a l'àrbitre genèric?",
            [
              { text: "Cancel·lar", style: "cancel" },
              { text: "Assignar", style: "destructive", onPress: assignGenericReferee },
            ]
          );
        }}
        disabled={saving || !!matchRow?.is_finished}
        style={{
          position: "absolute",
          top: 16,
          right: 16,
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: "#ccc",
          backgroundColor: "white",
          opacity: saving || !!matchRow?.is_finished ? 0.6 : 1
        }}
      >
        <Text style={{ fontWeight: "600" }}>Assignar a àrbitre genèric</Text>
      </Pressable>
)}

      <Text style={{ fontSize: 20, fontWeight: "bold", textAlign: "center" }}>
        {teamA.name} vs {teamB.name}
      </Text>

      <Text style={{ textAlign: "center", color: "#666", marginTop: 6 }}>
        Match #{matchView.match_id} · Àrbitre: {refereeLabel}
      </Text>

      <View style={{ height: 18 }} />

      {!started ? (
        <View
          style={{
            padding: 14,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#ddd",
            backgroundColor: "#fafafa",
          }}
        >
          <Text style={{ fontSize: 16, fontWeight: "800", textAlign: "center" }}>
            Qui tira primer?
          </Text>

          <View style={{ height: 14 }} />

          <Pressable
            disabled={saving}
            onPress={() => confirmStart(teamA.id)}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: "#e6f7ed",
              borderWidth: 1,
              borderColor: "#cfeedd",
              marginBottom: 10,
              alignItems: "center",
              opacity: saving ? 0.6 : 1,
            }}
          >
            <Text style={{ fontWeight: "800" }}>{teamA.name}</Text>
          </Pressable>

          <Pressable
            disabled={saving}
            onPress={() => confirmStart(teamB.id)}
            style={{
              padding: 14,
              borderRadius: 12,
              backgroundColor: "#e6f7ed",
              borderWidth: 1,
              borderColor: "#cfeedd",
              alignItems: "center",
              opacity: saving ? 0.6 : 1,
            }}
          >
            <Text style={{ fontWeight: "800" }}>{teamB.name}</Text>
          </Pressable>

          {saving ? (
            <Text style={{ marginTop: 10, textAlign: "center", color: "#666" }}>
              Preparant partit...
            </Text>
          ) : null}
        </View>
      ) : (
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
          <Text style={{ fontSize: 16, fontWeight: "800" }}>Partit preparat ✅</Text>
          <Text style={{ marginTop: 6, textAlign: "center", color: "#666" }}>
            {firstTeamName ? (
              <>
                Comença: <Text style={{ fontWeight: "900" }}>{firstTeamName}</Text>
              </>
            ) : (
              "Ja podem continuar."
            )}
          </Text>

          <View style={{ height: 12 }} />

          <Pressable
            onPress={() =>
              router.push({
                pathname: "/lineup",
                params: { matchId: String(matchView.match_id) },
              })
            }
            style={{
              paddingVertical: 10,
              paddingHorizontal: 14,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#ccc",
            }}
          >
            <Text style={{ fontWeight: "600" }}>Continuar</Text>
          </Pressable>
        </View>
      )}
    <View style={{ height: 16, flex:1 }} />

    {/* Botó No presentat */}
    {/* 🪙 Coinflip (qui escull primer) */}
    <Pressable
      onPress={doCoinFlip}
      disabled={saving || !!matchRow?.is_finished}
      style={{
        marginBottom: 12,
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#ddd",
        backgroundColor: "white",
        alignItems: "center",
        opacity: saving || !!matchRow?.is_finished ? 0.6 : 1,
      }}
    >
      <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 8 }}>
         <FontAwesome5 name="coins" size={18} />
         <Text style={{ fontSize: 16, fontWeight: "900" }}>Moneda a l'aire</Text>
      </View>
      <Text style={{ marginTop: 2, color: "#666" }}>
        Decideix qui escull primer
      </Text>

      {coinFlipResult && teamA && teamB && (
        <Text style={{ marginTop: 8, fontWeight: "800" }}>
          Resultat: {coinFlipResult === "A" ? teamA.name : teamB.name}
          {coinFlipAt ? `  ·  ${new Date(coinFlipAt).toLocaleTimeString()}` : ""}
        </Text>
      )}
    </Pressable>

    <Pressable
      onPress={onNoShowPress}
      disabled={saving || !!matchRow?.is_finished || started}
      style={{
        padding: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#f3caca",
        backgroundColor: "#ffecec",
        alignItems: "center",
        opacity: saving || !!matchRow?.is_finished || started ? 0.6 : 1,
      }}
    >
      <Text style={{ fontWeight: "900" }}>No presentat</Text>
      <Text style={{ marginTop: 2, color: "#7a2f2f" }}>
        Finalitza el partit (5 - 0)
      </Text>
    </Pressable>
    {isAdmin && (
      <Pressable
        onPress={() => {
          setSimulateModalOpen(true);
          setSimulateCanRun(null);
          setSimulateTeamACount(null);
          setSimulateTeamBCount(null);
          setSimulatePreviewText("Carrega la previsualització abans de simular.");
        }}
        disabled={saving || !!matchRow?.is_finished}
        style={{
          paddingVertical: 8,
          paddingHorizontal: 12,
          borderRadius: 12,
          borderWidth: 1,
          borderColor: "#DDD6FE",
          backgroundColor: "#F5F3FF",
          marginBottom: 50,
          marginTop: 14,
          alignItems: "center",
          opacity: saving || !!matchRow?.is_finished ? 0.6 : 1,
        }}
      >
        <Text style={{ fontWeight: "800", color: "#6D28D9"}}>🧪 Simular partit complet</Text>
        <Text style={{ marginTop: 2, color: "#7a2f2f" }}>
        Opció per fer TESTING.
      </Text>
      </Pressable>
)}
    </View>
  );
}