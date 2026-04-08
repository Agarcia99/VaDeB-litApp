import { useCallback, useState } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { supabase } from "../../src/supabase";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";

type RefMap = { referee_id: number };

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateDDMMYYYY_HHMM(iso: string) {
  const d = new Date(iso);
  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();
  const hour = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${day}/${month}/${year} - ${hour}:${min}`;
}

function getTodayRangeLocal() {
  // Agafa el dia "d'avui" segons el mòbil (Europa/Madrid si el dispositiu està en aquesta TZ)
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0);
  return { start, end };
}
function getFieldOrder(fieldCode?: string | null) {
  const code = (fieldCode ?? "").trim().toUpperCase();

  if (code === "A") return 0;
  if (code === "B") return 1;
  return 99;
}

function compareMatches(a: any, b: any) {
  const finishedA = !!a.is_finished;
  const finishedB = !!b.is_finished;

  // Pendents primer, finalitzats després
  if (finishedA !== finishedB) {
    return finishedA ? 1 : -1;
  }

  const timeA = a.match_date ? new Date(a.match_date).getTime() : Number.MAX_SAFE_INTEGER;
  const timeB = b.match_date ? new Date(b.match_date).getTime() : Number.MAX_SAFE_INTEGER;

  // Primer data i hora
  if (timeA !== timeB) {
    return timeA - timeB;
  }

  // Després camp A abans que B
  const fieldA = getFieldOrder(a.field_code);
  const fieldB = getFieldOrder(b.field_code);

  if (fieldA !== fieldB) {
    return fieldA - fieldB;
  }

  // Desempat estable extra
  const refA = typeof a.referee_id === "number" ? a.referee_id : Number.MAX_SAFE_INTEGER;
  const refB = typeof b.referee_id === "number" ? b.referee_id : Number.MAX_SAFE_INTEGER;

  if (refA !== refB) {
    return refB - refA;
  }

  const idA = typeof a.match_id === "number" ? a.match_id : Number.MAX_SAFE_INTEGER;
  const idB = typeof b.match_id === "number" ? b.match_id : Number.MAX_SAFE_INTEGER;

  return idA - idB;
}
export default function Matches() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<any[]>([]);
  const [ref, setRef] = useState<RefMap | null>(null);
  const [refereeNameMap, setRefereeNameMap] = useState<Record<number, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadMatches();
    }, [])
  );

  
  async function loadRefereeNames(refIds: number[]) {
    const unique = Array.from(new Set(refIds.filter((x) => typeof x === "number" && x !== 1)));
    if (!unique.length) {
      setRefereeNameMap({});
      return;
    }

    // Schema-safe: referee table must at least have id + name
    const { data, error } = await supabase.from("referee").select("id,name").in("id", unique);

    if (error) {
      // If referee table is protected, we just won't show names.
      // You can loosen RLS for SELECT on referee for authenticated refs if needed.
      console.log("loadRefereeNames error:", error.message);
      setRefereeNameMap({});
      return;
    }

    const map: Record<number, string> = {};
    for (const r of (data ?? []) as any[]) {
      const id = typeof r.id === "number" ? r.id : Number(r.id);
      const name = typeof r.name === "string" ? r.name : null;
      if (Number.isFinite(id) && name) map[id] = name;
    }
    setRefereeNameMap(map);
  }

async function loadMatches() {
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
      setLoading(false);
      return;
    }

     // Admin check (for config button)
     const { data: adminData } = await supabase
       .from("championship_admin_user")
       .select("user_id")
       .eq("user_id", user.id)
       .maybeSingle();
     setIsAdmin(!!adminData);

    const { data: refData, error: refErr } = await supabase
      .from("referee_user")
      .select("referee_id")
      .eq("user_id", user.id)
      .single();

    if (refErr || !refData) {
      Alert.alert("Error", "No s'ha trobat el teu referee_id (referee_user).");
      setLoading(false);
      return;
    }

    setRef(refData);

    // ✅ FILTRE ACTIU: només partits d'avui (el dia)
    // Si vols DESACTIVAR el filtre per fer proves, comenta aquestes 3 línies:
    const { start, end } = getTodayRangeLocal();
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    let q = supabase
      .from("v_pending_matches")
      .select("*")
      .order("is_finished", { ascending: true })
      .order("referee_id", { ascending: false })
      .order("match_date", { ascending: true });

    // ✅ Si l'àrbitre és el "genèric" (referee_id=2), només veu els seus partits
    if (refData.referee_id === 2) {
      q = q.eq("referee_id", 2);
    }


    // ✅ APLICA FILTRE "AVUI"
    // Si vols DESACTIVAR el filtre per fer proves, comenta aquesta línia:
    //q = q.gte("match_date", startIso).lt("match_date", endIso);

    const { data: matchData, error: matchErr } = await q;

    if (matchErr) {
      Alert.alert("Error", matchErr.message);
      setLoading(false);
      return;
    }

    const sortedMatches = (matchData || []).slice().sort(compareMatches);
    setMatches(sortedMatches);

    const ids = (matchData || []).map((m: any) => m.referee_id).filter((x: any) => typeof x === "number") as number[];
    await loadRefereeNames(ids);

    setLoading(false);
  }

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center" }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <BackButton onPress={() => router.back()} />

<RefreshButton
          onPress={async () => {
              try {
                await loadMatches();
              } catch (e: any) {
                Alert.alert("Error", e?.message ?? "No s'ha pogut actualitzar.");
              }
            }}
          style={{ alignSelf: "center" }}
        />
      </View>

      <Text
        style={{
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 16,
          textAlign: "center",
        }}
      >
        Partits d&apos;el campionat
      </Text>

      <FlatList
        data={matches}
        keyExtractor={(item) => item.match_id.toString()}
        ListEmptyComponent={() => (
          <View
            style={{
              alignItems: "center",
              justifyContent: "center",
              marginTop: 80,
            }}
          >
            <Text style={{ textAlign: "center", fontSize: 16, color: "#666" }}>
              No hi ha partits.
            </Text>
          </View>
        )}
        renderItem={({ item }) => {
          const isMine = ref ? item.referee_id === ref.referee_id : false;
          const isUnassigned = item.referee_id === 1 || item.referee_id == null;
          const isFinished = !!item.is_finished;
          const isOtherAssigned = !isFinished && !isMine && !isUnassigned;
          const assignedName =
            isOtherAssigned && typeof item.referee_id === "number"
              ? refereeNameMap[item.referee_id]
              : null;

          const scoreA =
            typeof item.score_team_a === "number" ? item.score_team_a : null;
          const scoreB =
            typeof item.score_team_b === "number" ? item.score_team_b : null;

          const cardBg = isFinished
            ? "#ffecec" // vermell suau
            : isMine
              ? "#e6f7ed" // verd suau
              : isUnassigned
                ? "#fff8db" // groc suau
                : "#fff0e0"; // taronja suau

          const leftColor = isFinished
            ? "#e74c3c" // vermell
            : isMine
              ? "#2ecc71" // verd
              : isUnassigned
                ? "#f1c40f" // groc
                : "#f39c12"; // taronja

          const statusText = isFinished
            ? "Partit Finalitzat"
            : isMine
              ? "Assignat a tu"
              : isUnassigned
                ? "Sense àrbitre!"
                : assignedName
                  ? `Assignat a ${assignedName}`
                  : "Assignat";

          const statusColor = isFinished
            ? "#e74c3c"
            : isMine
              ? "#2ecc71"
              : isUnassigned
                ? "#f1c40f"
                : "#f39c12";

          const phaseName: string | null =
            (typeof item.phase_name === "string" && item.phase_name) ||
            (typeof item.phase === "string" && item.phase) ||
            (item.phase && typeof item.phase.name === "string" && item.phase.name) ||
            null;

          return (
            <Pressable
              onPress={() => {
                if (isFinished) {
                  {/*router.push({
                    pathname: "../match-summary",
                    params: { id: item.match_id },
                  });*/}
                  return;
                }

                router.push({
                  pathname: "../match",
                  params: { id: item.match_id },
                });
              }}
              style={{
    backgroundColor: cardBg,
    borderLeftWidth: 6,
    borderLeftColor: leftColor,
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    opacity: isFinished ? 0.9 : 1,
  }}
>
              <Text style={{ fontWeight: "bold", fontSize: 16 }}>
                {item.team_a_name} vs {item.team_b_name}
              </Text>

              {/* ✅ Resultat només si finalitzat */}
              {isFinished && scoreA !== null && scoreB !== null && (
                <Text style={{ marginTop: 6, fontWeight: "800", color: "#e74c3c" }}>
                  {scoreA} - {scoreB}
                </Text>
              )}

              <Text style={{ color: "#555", marginTop: 6 }}>
                {formatDateDDMMYYYY_HHMM(item.match_date)}
              </Text>

              <Text style={{ color: "#888", marginTop: 2 }}>
                Camp: {item.field_code}
              </Text>

              {!!phaseName && (
                <Text style={{ color: "#666", marginTop: 2, fontWeight: "700" }}>
                  {phaseName}
                </Text>
              )}

              <Text
                style={{
                  marginTop: 6,
                  fontWeight: "700",
                  color: statusColor,
                }}
              >
                {statusText}
              </Text>
            </Pressable>
          );
        }}
      />
    </View>
  );
}
