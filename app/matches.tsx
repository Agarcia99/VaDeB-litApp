import { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Alert,
} from "react-native";
import { supabase } from "../src/supabase";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { RefreshButton } from "../components/HeaderButtons";
import { formatDateDDMMYYYY_HHMM } from "../src/utils/format";
import { compareMatches, getTodayRangeLocal } from "../src/utils/matchUtils";
import { useAppTheme } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";

type RefMap = { referee_id: number };

export default function Matches() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const { t } = useLanguage();

  const [loading, setLoading] = useState(true);
  const [matches, setMatches] = useState<any[]>([]);
  const [ref, setRef] = useState<RefMap | null>(null);
  const [refereeNameMap, setRefereeNameMap] = useState<Record<number, string>>({});
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const checkAccess = async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return;

      const { data } = await supabase
        .from("referee_user")
        .select("is_active")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!data?.is_active) {
        await supabase.auth.signOut();

        Alert.alert(
          t("matchesReferee.sessionClosedTitle"),
          t("matchesReferee.userDisabledSession")
        );

        router.replace("/login");
      }
    };

    checkAccess();
  }, [router, t]);

  useFocusEffect(
    useCallback(() => {
      loadMatches();
    }, [t])
  );

  async function loadRefereeNames(refIds: number[]) {
    const unique = Array.from(new Set(refIds.filter((x) => typeof x === "number" && x !== 1)));
    if (!unique.length) {
      setRefereeNameMap({});
      return;
    }

    const { data, error } = await supabase.from("referee").select("id,name").in("id", unique);

    if (error) {
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
      Alert.alert(t("common.error"), sessionErr.message);
      setLoading(false);
      return;
    }

    const user = sessionRes.session?.user;
    if (!user) {
      router.replace("/login");
      setLoading(false);
      return;
    }

    const { data: adminData } = await supabase
      .from("championship_admin_user")
      .select("user_id")
      .eq("user_id", user.id)
      .maybeSingle();
    setIsAdmin(!!adminData);

    const { data: refData, error: refErr } = await supabase
      .from("referee_user")
      .select("referee_id,is_active")
      .eq("user_id", user.id)
      .single();

    if (refErr) {
      Alert.alert(t("common.error"), t("matchesReferee.refereeAccessError"));
      await supabase.auth.signOut();
      router.replace("/login");
      setLoading(false);
      return;
    }

    if (!refData) {
      Alert.alert(t("matchesReferee.accessDeniedTitle"), t("matchesReferee.noRefereeLinked"));
      await supabase.auth.signOut();
      router.replace("/login");
      setLoading(false);
      return;
    }

    if (!refData.is_active) {
      Alert.alert(t("matchesReferee.userDisabledTitle"), t("matchesReferee.userDisabled"));
      await supabase.auth.signOut();
      router.replace("/login");
      setLoading(false);
      return;
    }

    setRef({ referee_id: refData.referee_id });

    const { start, end } = getTodayRangeLocal();
    const startIso = start.toISOString();
    const endIso = end.toISOString();

    let q = supabase
      .from("v_pending_matches")
      .select("*")
      .order("is_finished", { ascending: true })
      .order("referee_id", { ascending: false })
      .order("match_date", { ascending: true });

    if (refData.referee_id === 2) {
      q = q.eq("referee_id", 2);
    }

    q = q.gte("match_date", startIso).lt("match_date", endIso);

    const { data: matchData, error: matchErr } = await q;

    if (matchErr) {
      Alert.alert(t("common.error"), matchErr.message);
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
      <View style={{ flex: 1, justifyContent: "center", backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: colors.bg }}>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <Pressable
          onPress={async () => {
            await supabase.auth.signOut();
            router.replace("/login");
          }}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: colors.border,
            backgroundColor: colors.card,
          }}
        >
          <Text style={{ fontWeight: "600", color: colors.text }}>
            {t("matchesReferee.logout")}
          </Text>
        </Pressable>

        <RefreshButton
          onPress={async () => {
            try {
              await loadMatches();
            } catch (e: any) {
              Alert.alert(t("common.error"), e?.message ?? t("matchesReferee.refreshError"));
            }
          }}
          style={{ alignSelf: "center" }}
        />

        {isAdmin ? (
          <Pressable
            onPress={() => router.push("/admin")}
            style={{
              padding: 10,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.card,
            }}
          >
            <Text style={{ fontSize: 18 }}>⚙️</Text>
          </Pressable>
        ) : (
          <View style={{ width: 40 }} />
        )}
      </View>

      <Text
        style={{
          fontSize: 22,
          fontWeight: "bold",
          marginBottom: 16,
          textAlign: "center",
          color: colors.text,
        }}
      >
        {t("matchesReferee.todayMatches")}
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
            <Text style={{ textAlign: "center", fontSize: 16, color: colors.muted }}>
              {t("matchesReferee.noMatches")}
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
            ? (isDark ? "#2A0E0E" : "#ffecec")
            : isMine
              ? (isDark ? "#0E2A14" : "#e6f7ed")
              : isUnassigned
                ? (isDark ? "#2A2000" : "#fff8db")
                : (isDark ? "#2A1400" : "#fff0e0");

          const leftColor = isFinished
            ? "#e74c3c"
            : isMine
              ? "#2ecc71"
              : isUnassigned
                ? "#f1c40f"
                : "#f39c12";

          const statusText = isFinished
            ? t("matchesReferee.matchFinished")
            : isMine
              ? t("matchesReferee.assignedToYou")
              : isUnassigned
                ? t("matchesReferee.noReferee")
                : assignedName
                  ? t("matchesReferee.assignedTo", { name: assignedName })
                  : t("matchesReferee.assigned");

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
                  router.push({
                    pathname: "/match-summary",
                    params: { id: item.match_id },
                  });
                  return;
                }

                router.push({
                  pathname: "/match",
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
              <Text style={{ fontWeight: "bold", fontSize: 16, color: colors.text }}>
                {item.team_a_name} {t("publicMatches.vs")} {item.team_b_name}
              </Text>

              {isFinished && scoreA !== null && scoreB !== null && (
                <Text style={{ marginTop: 6, fontWeight: "800", color: "#e74c3c" }}>
                  {scoreA} - {scoreB}
                </Text>
              )}

              <Text style={{ color: colors.muted, marginTop: 6 }}>
                {formatDateDDMMYYYY_HHMM(item.match_date)}
              </Text>

              <Text style={{ color: colors.muted, marginTop: 2 }}>
                {t("matchesReferee.field")}: {item.field_code}
              </Text>

              {!!phaseName && (
                <Text style={{ color: colors.muted, marginTop: 2, fontWeight: "700" }}>
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