import { View, Text, Pressable, ActivityIndicator, Alert, ScrollView, Image, Modal, Linking, Platform } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../src/supabase";
import * as Application from "expo-application";
import { BackButton, RefreshButton } from "../components/HeaderButtons";
import Constants from "expo-constants";

export default function PublicMenu() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [champName, setChampName] = useState<string>("");
  const [championTeamName, setChampionTeamName] = useState<string | null>(null);


// --- App update gate (manual store update prompt) ---
type AppReleaseRow = {
  platform: "android" | "ios";
  latest_version: string;
  min_supported_version: string | null;
  store_url: string;
  message: string | null;
  is_active: boolean;
};

type MaintenanceConfigRow = {
  value: {
    enabled?: boolean;
    message?: string | null;
  } | null;
};

const currentVersion =
  (Constants.expoConfig?.version as string | undefined) ??
  Application.nativeApplicationVersion ??
  "0.0.0";

const [updateVisible, setUpdateVisible] = useState(false);
const [updateForce, setUpdateForce] = useState(false);
const [updateMessage, setUpdateMessage] = useState<string | null>(null);
const [updateStoreUrl, setUpdateStoreUrl] = useState<string | null>(null);
const [updateLatest, setUpdateLatest] = useState<string | null>(null);

const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
const [maintenanceMessage, setMaintenanceMessage] = useState<string>(
  "Aplicació en manteniment, torna més tard"
);

function parseVersion(v: string) {
  return String(v)
    .split(".")
    .map((x) => {
      const n = parseInt(x, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function isVersionLess(a: string, b: string) {
  const av = parseVersion(a);
  const bv = parseVersion(b);
  const n = Math.max(av.length, bv.length);
  for (let i = 0; i < n; i++) {
    const ai = av[i] ?? 0;
    const bi = bv[i] ?? 0;
    if (ai < bi) return true;
    if (ai > bi) return false;
  }
  return false;
}

const checkForAppUpdate = useCallback(async () => {
  try {
    const platform = Platform.OS === "android" ? "android" : "ios";

    const q = await supabase
      .from("app_release")
      .select("platform,latest_version,min_supported_version,store_url,message,is_active")
      .eq("is_active", true)
      .eq("platform", platform)
      .order("latest_version", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (q.error || !q.data) return;

    const rel = q.data as AppReleaseRow;

    // store url + message
    setUpdateStoreUrl(rel.store_url ?? null);
    setUpdateMessage(rel.message ?? null);
    setUpdateLatest(rel.latest_version ?? null);

    const mustUpdate =
      !!rel.min_supported_version && isVersionLess(currentVersion, rel.min_supported_version);

    const hasUpdate =
      !!rel.latest_version && isVersionLess(currentVersion, rel.latest_version);

    if (mustUpdate || hasUpdate) {
      setUpdateForce(mustUpdate);
      setUpdateVisible(true);
    } else {
      setUpdateVisible(false);
    }
  } catch (e: any) {
    console.log("Update check failed:", e?.message ?? e);
  }
}, [currentVersion]);

async function openStore() {
  if (!updateStoreUrl) {
    Alert.alert("Error", "Falta l'enllaç de la botiga per actualitzar.");
    return;
  }
  try {
    await Linking.openURL(updateStoreUrl);
  } catch (e) {
    // Android fallback if market:// fails
    if (Platform.OS === "android") {
      const pkg = Application.applicationId;
      if (pkg) {
        await Linking.openURL(`https://play.google.com/store/apps/details?id=${pkg}`);
        return;
      }
    }
    Alert.alert("Error", "No s'ha pogut obrir la botiga.");
  }
}

const loadMaintenanceMode = useCallback(async (championshipId: number) => {
  try {
    const { data, error } = await supabase
      .from("championship_config")
      .select("value")
      .eq("championship_id", championshipId)
      .is("phase_id", null)
      .eq("key", "maintenance_mode")
      .limit(1)
      .maybeSingle();

    if (error) {
      setIsMaintenanceMode(false);
      setMaintenanceMessage("Aplicació en manteniment, torna més tard");
      return;
    }

    const row = data as MaintenanceConfigRow | null;
    const enabled = row?.value?.enabled === true;
    const message =
      row?.value?.message?.trim() || "Aplicació en manteniment, torna més tard";

    setIsMaintenanceMode(enabled);
    setMaintenanceMessage(message);
  } catch {
    setIsMaintenanceMode(false);
    setMaintenanceMessage("Aplicació en manteniment, torna més tard");
  }
}, []);
  
  const loadChampionBanner = useCallback(
    async (championshipId: number) => {
      // Default: no banner
      setChampionTeamName(null);

      // 1) Agafa el partit de FINAL (phase_id = 5) i comprova si està acabat.
      // No tenim winner_team_id a la taula: el calculem amb score_team_a / score_team_b.
      const qFinal = await supabase
        .from("match")
        .select(
          "team_a_id,team_b_id,score_team_a,score_team_b,is_finished,phase_id,match_date"
        )
        .eq("championship_id", championshipId)
        .eq("phase_id", 5)
        .order("match_date", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (qFinal.error) return;
      const isFinished = qFinal.data?.is_finished;

      if (!isFinished) return;

      const a = qFinal.data?.score_team_a;
      const b = qFinal.data?.score_team_b;
      const teamA = qFinal.data?.team_a_id;
      const teamB = qFinal.data?.team_b_id;

      // Si falta algun valor o hi ha empat, no mostrem cap campió.
      if (a == null || b == null || teamA == null || teamB == null) return;
      if (a === b) return;

      const winnerId = a > b ? teamA : teamB;

      if (!winnerId) return;

      // 2) Carrega el nom de l'equip guanyador
      const qTeam = await supabase
        .from("team")
        .select("name")
        .eq("id", winnerId)
        .maybeSingle();

      if (qTeam.error) return;
      if (qTeam.data?.name) setChampionTeamName(qTeam.data.name);
    },
    []
  );

const loadChampionship = useCallback(async () => {
    setLoading(true);

    // Intent 1: championship amb is_active = true
    const q1 = await supabase
      .from("championship")
      .select("id,name")
      .eq("is_active", true)
      .order("id", { ascending: false })
      .maybeSingle();

    if (!q1.error && q1.data?.name) {
  setChampName(q1.data.name);
  await loadMaintenanceMode(q1.data.id);
  await loadChampionBanner(q1.data.id);
  setLoading(false);
  return;
}

    // Intent 2: primer championship disponible
    const q2 = await supabase
      .from("championship")
      .select("id,name")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!q2.error && q2.data?.name) {
  setChampName(q2.data.name);
  await loadMaintenanceMode(q2.data.id);
  await loadChampionBanner(q2.data.id);
  setLoading(false);
  return;
}

    setChampionTeamName(null);
setIsMaintenanceMode(false);
setMaintenanceMessage("Aplicació en manteniment, torna més tard");
setChampName("Campionat del món de Bélit");
setLoading(false);
  }, [loadChampionBanner, loadMaintenanceMode]);

  useEffect(() => {
    loadChampionship();
    checkForAppUpdate();
  }, [loadChampionship, checkForAppUpdate]);

  // Recarrega en tornar a la pantalla (per si canvies el campionat en actiu)
  useFocusEffect(
    useCallback(() => {
      loadChampionship();
      checkForAppUpdate();
    }, [loadChampionship, checkForAppUpdate])
  );

  const Tile = ({
    title,
    subtitle,
    onPress,
  }: {
    title: string;
    subtitle: string;
    onPress: () => void;
  }) => (
    <Pressable
      onPress={onPress}
      style={{
        flex: 1,
        paddingVertical: 16,
        paddingHorizontal: 14,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: "#e6e6e6",
        backgroundColor: "white",
        minHeight: 92,
        alignItems: "center",
      }}
    >
      <Text style={{ fontWeight: "900", fontSize: 16 }}>{title}</Text>
      <Text style={{ marginTop: 6, color: "#6b6b6b", fontWeight: "600" }}>
        {subtitle}
      </Text>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <ActivityIndicator size="large" />
        <Text style={{ textAlign: "center", marginTop: 12, color: "#666" }}>
          Carregant…
        </Text>
      </View>
    );
  }
  if (isMaintenanceMode) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: "#f8fafc",
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: "white",
            borderRadius: 24,
            paddingVertical: 28,
            paddingHorizontal: 22,
            borderWidth: 1,
            borderColor: "#e5e7eb",
            alignItems: "center",
            shadowColor: "#000",
            shadowOpacity: 0.08,
            shadowRadius: 10,
            shadowOffset: { width: 0, height: 4 },
            elevation: 3,
          }}
        >
          <View
            style={{
              width: 84,
              height: 84,
              borderRadius: 42,
              backgroundColor: "#FEF2F2",
              justifyContent: "center",
              alignItems: "center",
              marginBottom: 16,
            }}
          >
            <Text style={{ fontSize: 34 }}>🚧</Text>
          </View>

          <Text
            style={{
              fontSize: 24,
              fontWeight: "900",
              color: "#111827",
              textAlign: "center",
            }}
          >
            Aplicació en manteniment
          </Text>

          <Text
            style={{
              marginTop: 12,
              fontSize: 16,
              lineHeight: 22,
              color: "#6B7280",
              fontWeight: "600",
              textAlign: "center",
            }}
          >
            {maintenanceMessage}
          </Text>

          <Pressable
            onPress={loadChampionship}
            style={{
              marginTop: 20,
              paddingVertical: 12,
              paddingHorizontal: 18,
              borderRadius: 14,
              backgroundColor: "#111827",
            }}
          >
            <Text style={{ color: "white", fontWeight: "900" }}>Tornar a provar</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, padding: 16 }}>
      {/* Títol del campionat en actiu */}
<View style={{ alignItems: "center", marginBottom: 12 }}>
  <View
    style={{
      width: 70,
      height: 70,
      borderRadius: 35,
      backgroundColor: "#fff",
      justifyContent: "center",
      alignItems: "center",
      shadowColor: "#000",
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 3 },
      elevation: 4, // Android
    }}
  >
    <Image
      source={require("../assets/images/belit.png")} // ajusta el path si cal
      style={{
        width: 60,
        height: 60,
        borderRadius: 30,
      }}
      resizeMode="contain"
    />
  </View>
</View>
      <View style={{ marginBottom: 14 }}>
        <Text
          style={{
            fontSize: 20,
            fontWeight: "900",
            textAlign: "center",
          }}
        >
          {champName}
        </Text>
        {championTeamName ? (
          <Text
            style={{
              marginTop: 8,
              textAlign: "center",
              fontWeight: "900",
              fontSize: 20,
              color: "#1f7a1f",
            }}
          >
            🎉 Enhorabona {championTeamName}!
          </Text>
)  : null}
</View>

{/* Update modal */}
<Modal visible={updateVisible} transparent animationType="fade">
  <View
    style={{
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.45)",
      justifyContent: "center",
      padding: 18,
    }}
  >
    <View style={{ backgroundColor: "white", borderRadius: 18, padding: 16 }}>
      <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
        Nova versió disponible
      </Text>

      <Text style={{ fontSize: 14, color: "#374151", marginBottom: 14 }}>
        {updateMessage ??
          "Hi ha una actualització disponible. Ves a la botiga per instal·lar-la."}
      </Text>

      {updateLatest ? (
        <Text style={{ fontSize: 13, color: "#6B7280", marginBottom: 14, fontWeight: "700" }}>
          Versió instal·lada: {currentVersion} · Nova: {updateLatest}
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
        {!updateForce ? (
          <Pressable
            onPress={() => setUpdateVisible(false)}
            style={{ paddingVertical: 10, paddingHorizontal: 12 }}
          >
            <Text style={{ fontWeight: "800", color: "#6B7280" }}>Més tard</Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={openStore}
          style={{
            paddingVertical: 10,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: "#111827",
          }}
        >
          <Text style={{ fontWeight: "900", color: "white" }}>Actualitzar</Text>
        </Pressable>
      </View>
    </View>
  </View>
</Modal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 18 }}>
        
        {/* Grid 2 columnes */}
{/* Aquesta setmana (accés ràpid) */}
<View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
    <Tile
      title="🗓️ Aquesta setmana"
      subtitle="Partits d’aquesta setmana"
      onPress={() => router.push("/public-week-matches")}
    />
</View>

        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <Tile
            title="📅 Partits"
            subtitle="Resultats dels partits"
            onPress={() => router.push("/public-matches")}
          />
          <Tile
            title="📅 Calendari"
            subtitle="Horaris dels partits"
            onPress={() => router.push("/public-calendar")}
          />
        </View>

        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <Tile
            title="🥇 Classificació individual"
            subtitle="Rànquing de jugadors"
            onPress={() => router.push("/rankings")}
          />
          <Tile
            title="🏅 Classificació equips"
            subtitle="Rànquing d'equips"
            onPress={() => router.push("/team-rankings")}
          />
        </View>

        <View style={{ flexDirection: "row",gap: 12, marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
    <Tile
      title="👨‍⚖️ Arbitratge"
      subtitle="Entrar com àrbitre"
      onPress={() => router.push("/login")}
    />
  </View>
        </View>

        <RefreshButton
          onPress={loadChampionship}
          style={{ alignSelf: "center" }}
        />
      </ScrollView>
    </View>
  );
}
