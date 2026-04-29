import { View, Text, Pressable, ActivityIndicator, Alert, ScrollView, Image, Modal, Linking, Platform, Switch } from "react-native";
import { useCallback, useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../src/supabase";
import * as Application from "expo-application";
import { BackButton, RefreshButton } from "../components/HeaderButtons";
import Constants from "expo-constants";
import { useAppTheme } from "../src/theme";
import { useLanguage } from "../src/i18n/LanguageContext";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";

// --- App update gate ---
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

type TeamRow = {
  id: number;
  name: string;
};

const currentVersion =
  (Constants.expoConfig?.version as string | undefined) ??
  Application.nativeApplicationVersion ??
  "0.0.0";

function parseVersion(v: string): number[] {
  return String(v)
    .split(".")
    .map((x) => {
      const n = parseInt(x, 10);
      return Number.isFinite(n) ? n : 0;
    });
}

function isVersionLess(a: string, b: string): boolean {
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

export default function PublicMenu() {
  const router = useRouter();
  const { colors, isDark, toggleMode } = useAppTheme();
  const { t, language, toggleLanguage } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [champName, setChampName] = useState<string>("");
  const [championTeamName, setChampionTeamName] = useState<string | null>(null);

  const [updateVisible, setUpdateVisible] = useState(false);
  const [updateForce, setUpdateForce] = useState(false);
  const [updateMessage, setUpdateMessage] = useState<string | null>(null);
  const [updateStoreUrl, setUpdateStoreUrl] = useState<string | null>(null);
  const [updateLatest, setUpdateLatest] = useState<string | null>(null);

  const [isMaintenanceMode, setIsMaintenanceMode] = useState(false);
  const [maintenanceMessage, setMaintenanceMessage] = useState<string>(
    t("home.maintenanceDefaultMessage")
  );
  const [settingsVisible, setSettingsVisible] = useState(false);

  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const [notifyMatchStarted, setNotifyMatchStarted] = useState(true);
  const [notifyMatchFinished, setNotifyMatchFinished] = useState(true);
  const [notifyRoundFinished, setNotifyRoundFinished] = useState(true);

  const [activeChampionshipId, setActiveChampionshipId] = useState<number | null>(null);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [selectedTeamIds, setSelectedTeamIds] = useState<number[]>([]);
  const [savingPreferences, setSavingPreferences] = useState(false);

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
  }, []);

  const loadTeams = useCallback(async (championshipId: number) => {
    const { data, error } = await supabase
      .from("championship_team")
      .select(`
      team_id,
      team:team_id (
        id,
        name
      )
    `)
      .eq("championship_id", championshipId);

    if (error) {
      console.log("Error loading teams:", error.message);
      setTeams([]);
      return;
    }

    const mappedTeams =
      data
        ?.map((row: any) => row.team)
        .filter(Boolean)
        .map((team: any) => ({
          id: team.id,
          name: team.name,
        }))
        .sort((a: TeamRow, b: TeamRow) => a.name.localeCompare(b.name)) ?? [];

    setTeams(mappedTeams);
  }, []);

  async function openStore() {
    if (!updateStoreUrl) {
      Alert.alert(t("common.error"), t("update.missingStoreUrl"));
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
      Alert.alert(t("common.error"), t("update.openStoreError"));
    }
  }

  async function getOrCreateDeviceId() {
    const key = "belit_device_id";

    const existing = await AsyncStorage.getItem(key);
    if (existing) return existing;

    const newId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    await AsyncStorage.setItem(key, newId);

    return newId;
  }

  async function saveNotificationPreferences() {
    if (!activeChampionshipId) {
      Alert.alert(t("common.error"), "No se ha encontrado el campeonato activo.");
      return;
    }
    setSavingPreferences(true);
    try {
      const expoPushToken = notificationsEnabled
        ? await registerForPush()
        : null;
      const deviceId = await getOrCreateDeviceId();

      const existingDevice = await supabase
        .from("notification_devices")
        .select("id")
        .eq("device_id", deviceId)
        .maybeSingle();

      if (existingDevice.error) throw existingDevice.error;

      if (existingDevice.data?.id) {
        const updateDevice = await supabase
          .from("notification_devices")
          .update({
            platform: Platform.OS,
            notifications_enabled: notificationsEnabled,
            championship_id: activeChampionshipId,
            expo_push_token: expoPushToken,
            updated_at: new Date().toISOString(),
          })
          .eq("device_id", deviceId);

        if (updateDevice.error) throw updateDevice.error;
      } else {
        const insertDevice = await supabase
          .from("notification_devices")
          .insert({
            device_id: deviceId,
            platform: Platform.OS,
            notifications_enabled: notificationsEnabled,
            championship_id: activeChampionshipId,
            expo_push_token: expoPushToken,
            updated_at: new Date().toISOString(),
          });

        if (insertDevice.error) throw insertDevice.error;
      }

      const deleteResult = await supabase
        .from("notification_team_preferences")
        .delete()
        .eq("device_id", deviceId)
        .eq("championship_id", activeChampionshipId);

      if (deleteResult.error) throw deleteResult.error;

      if (notificationsEnabled && selectedTeamIds.length > 0) {
        const rows = selectedTeamIds.map((teamId) => ({
          device_id: deviceId,
          championship_id: activeChampionshipId,
          team_id: teamId,
          match_started: notifyMatchStarted,
          match_finished: notifyMatchFinished,
          round_finished: notifyRoundFinished,
          updated_at: new Date().toISOString(),
        }));

        const insertResult = await supabase
          .from("notification_team_preferences")
          .insert(rows);

        if (insertResult.error) throw insertResult.error;
      }
      setSettingsVisible(false);
      Alert.alert(t("common.ok"), t("home.preferencesSaved"));
    } catch (e: any) {

      Alert.alert(
        t("common.error"),
        e?.message ?? t("home.preferencesError")
      );
    } finally {
      setSavingPreferences(false);
    }
  }

  async function registerForPush() {
    try {
      const { status: existingStatus } =
        await Notifications.getPermissionsAsync();

      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") return null;

      const tokenData = await Notifications.getExpoPushTokenAsync();

      return tokenData.data;
    } catch (e) {
      console.log("PUSH ERROR:", e);
      return null;
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
        setMaintenanceMessage(t("home.maintenanceDefaultMessage"));
        return;
      }

      const row = data as MaintenanceConfigRow | null;
      const enabled = row?.value?.enabled === true;
      const message =
        row?.value?.message?.trim() || t("home.maintenanceDefaultMessage");

      setIsMaintenanceMode(enabled);
      setMaintenanceMessage(message);
    } catch {
      setIsMaintenanceMode(false);
      setMaintenanceMessage(t("home.maintenanceDefaultMessage"));
    }
  }, []);

  function toggleTeamSelection(teamId: number) {
    setSelectedTeamIds((prev) =>
      prev.includes(teamId)
        ? prev.filter((id) => id !== teamId)
        : [...prev, teamId]
    );
  }

  async function loadNotificationPreferences(championshipId: number) {
    try {
      const deviceId = await getOrCreateDeviceId();

      const { data: device, error: deviceError } = await supabase
        .from("notification_devices")
        .select("notifications_enabled")
        .eq("device_id", deviceId)
        .maybeSingle();

      if (deviceError) throw deviceError;

      setNotificationsEnabled(device?.notifications_enabled === true);

      const { data: prefs, error: prefsError } = await supabase
        .from("notification_team_preferences")
        .select("team_id, match_started, match_finished, round_finished")
        .eq("device_id", deviceId)
        .eq("championship_id", championshipId);

      if (prefsError) throw prefsError;

      const rows = prefs ?? [];

      setSelectedTeamIds(rows.map((row: any) => row.team_id));

      if (rows.length > 0) {
        setNotifyMatchStarted(rows.some((row: any) => row.match_started));
        setNotifyMatchFinished(rows.some((row: any) => row.match_finished));
        setNotifyRoundFinished(rows.some((row: any) => row.round_finished));
      }
    } catch (e: any) {
      console.log("LOAD NOTIFICATION PREFS ERROR:", e?.message ?? e);
    }
  }

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
      setActiveChampionshipId(q1.data.id);
      setChampName(q1.data.name);
      await loadTeams(q1.data.id);
      await loadNotificationPreferences(q1.data.id);
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
      setActiveChampionshipId(q2.data.id);
      setChampName(q2.data.name);
      await loadTeams(q2.data.id);
      await loadNotificationPreferences(q2.data.id);
      await loadMaintenanceMode(q2.data.id);
      await loadChampionBanner(q2.data.id);
      setLoading(false);
      return;
    }

    setChampionTeamName(null);
    setIsMaintenanceMode(false);
    setMaintenanceMessage(t("home.maintenanceDefaultMessage"));
    setChampName(t("home.defaultChampionshipName"));
    setLoading(false);
  }, [loadChampionBanner, loadMaintenanceMode, loadTeams]);

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
        borderColor: colors.border,
        backgroundColor: colors.card,
        minHeight: 92,
        alignItems: "center",
      }}
    >
      <Text style={{ fontWeight: "900", fontSize: 16, textAlign: "center", color: colors.text }}>{title}</Text>
      <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "600", textAlign: "center" }}>
        {subtitle}
      </Text>
    </Pressable>
  );

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16, backgroundColor: colors.bg }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ textAlign: "center", marginTop: 12, color: colors.muted }}>
          {t("common.loading")}
        </Text>
      </View>
    );
  }
  if (isMaintenanceMode && !__DEV__) {
    return (
      <View
        style={{
          flex: 1,
          padding: 24,
          justifyContent: "center",
          alignItems: "center",
          backgroundColor: colors.bg,
        }}
      >
        <View
          style={{
            width: "100%",
            maxWidth: 420,
            backgroundColor: colors.card,
            borderRadius: 24,
            paddingVertical: 28,
            paddingHorizontal: 22,
            borderWidth: 1,
            borderColor: colors.border,
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
              color: colors.text,
              textAlign: "center",
            }}
          >
            {t("home.maintenanceTitle")}
          </Text>

          <Text
            style={{
              marginTop: 12,
              fontSize: 16,
              lineHeight: 22,
              color: colors.muted,
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
              backgroundColor: colors.primary,
            }}
          >
            <Text style={{ color: colors.primaryText, fontWeight: "900" }}>{t("common.retry")}</Text>
          </Pressable>
        </View>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: colors.bg }}>
      <View style={{ alignItems: "flex-end", marginBottom: 4 }}>
        <Pressable
          onPress={() => setSettingsVisible(true)}
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <Text style={{ fontSize: 22 }}>⚙️</Text>
        </Pressable>
      </View>
      {isMaintenanceMode && __DEV__ ? (
        <View
          style={{
            marginHorizontal: 0,
            marginTop: 12,
            marginBottom: 4,
            paddingVertical: 10,
            paddingHorizontal: 12,
            borderRadius: 12,
            backgroundColor: "#FEF3C7",
            borderWidth: 1,
            borderColor: "#FCD34D",
          }}
        >
          <Text style={{ color: "#92400E", fontWeight: "800", textAlign: "center" }}>
            {t("home.maintenanceActiveDev")}
          </Text>
        </View>
      ) : null}
      {/* Títol del campionat en actiu */}
      <View style={{ alignItems: "center", marginBottom: 12 }}>
        <View
          style={{
            width: 70,
            height: 70,
            borderRadius: 35,
            backgroundColor: colors.card,
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
            color: colors.text,
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
            {t("home.congratulations", { team: championTeamName })}
          </Text>
        ) : null}
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
          <View style={{ backgroundColor: colors.card, borderRadius: 18, padding: 16 }}>
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 8 }}>
              {t("update.title")}
            </Text>

            <Text style={{ fontSize: 14, color: colors.text, marginBottom: 14 }}>
              {updateMessage ?? t("update.defaultMessage")}
            </Text>

            {updateLatest ? (
              <Text style={{ fontSize: 13, color: colors.muted, marginBottom: 14, fontWeight: "700" }}>
                {t("update.versionInfo", { current: currentVersion, latest: updateLatest })}
              </Text>
            ) : null}

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10 }}>
              {!updateForce ? (
                <Pressable
                  onPress={() => setUpdateVisible(false)}
                  style={{ paddingVertical: 10, paddingHorizontal: 12 }}
                >
                  <Text style={{ fontWeight: "800", color: colors.muted }}>{t("common.later")}</Text>
                </Pressable>
              ) : null}

              <Pressable
                onPress={openStore}
                style={{
                  paddingVertical: 10,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  backgroundColor: colors.primary,
                }}
              >
                <Text style={{ fontWeight: "900", color: colors.primaryText }}>{t("common.update")}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal visible={settingsVisible} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 20,
              padding: 18,
              borderWidth: 1,
              borderColor: colors.border,
              maxHeight: "88%",
            }}
          >
            <Text
              style={{
                fontSize: 22,
                fontWeight: "900",
                color: colors.text,
                marginBottom: 16,
              }}
            >
              {t("home.configuration")}
            </Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              <View style={{ marginBottom: 18 }}>
                <Text style={{ color: colors.muted, fontWeight: "900", marginBottom: 8 }}>
                  {t("home.appearance")}
                </Text>

                <Pressable
                  onPress={toggleMode}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 14,
                    backgroundColor: colors.bg,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "800" }}>
                    {isDark ? t("settings.lightMode") : t("settings.darkMode")}
                  </Text>
                </Pressable>
              </View>

              <View style={{ marginBottom: 18 }}>
                <Text style={{ color: colors.muted, fontWeight: "900", marginBottom: 8 }}>
                  {t("home.language")}
                </Text>

                <Pressable
                  onPress={toggleLanguage}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 14,
                    backgroundColor: colors.bg,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Text style={{ color: colors.text, fontWeight: "800" }}>
                    🌐 {language === "ca" ? t("settings.spanish") : t("settings.catalan")}
                  </Text>
                </Pressable>
              </View>

              <View style={{ marginBottom: 18 }}>
                <Text style={{ color: colors.muted, fontWeight: "900", marginBottom: 8 }}>
                  {t("home.notifications")}
                </Text>

                <View
                  style={{
                    padding: 14,
                    borderRadius: 14,
                    backgroundColor: colors.bg,
                    borderWidth: 1,
                    borderColor: colors.border,
                    gap: 12,
                  }}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text style={{ color: colors.text, fontWeight: "800", flex: 1 }}>
                      {t("home.activatenotifications")}
                    </Text>

                    <Switch
                      value={notificationsEnabled}
                      onValueChange={setNotificationsEnabled}
                    />
                  </View>

                  <View style={{ opacity: notificationsEnabled ? 1 : 0.45, gap: 12 }}>
                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>
                        {t("home.matchStarted")}
                      </Text>

                      <Switch
                        value={notifyMatchStarted}
                        onValueChange={setNotifyMatchStarted}
                        disabled={!notificationsEnabled}
                      />
                    </View>

                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>
                        {t("home.matchFinished")}
                      </Text>

                      <Switch
                        value={notifyMatchFinished}
                        onValueChange={setNotifyMatchFinished}
                        disabled={!notificationsEnabled}
                      />
                    </View>

                    <View
                      style={{
                        flexDirection: "row",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ color: colors.text, fontWeight: "700", flex: 1 }}>
                        {t("home.roundFinished")}
                      </Text>

                      <Switch
                        value={notifyRoundFinished}
                        onValueChange={setNotifyRoundFinished}
                        disabled={!notificationsEnabled}
                      />
                    </View>
                  </View>
                </View>
              </View>

              {notificationsEnabled ? (
                <View style={{ marginBottom: 18 }}>
                  <Text style={{ color: colors.muted, fontWeight: "900", marginBottom: 8 }}>
                    {t("home.teams")}
                  </Text>

                  {teams.length === 0 ? (
                    <Text style={{ color: colors.muted, fontWeight: "700" }}>
                      {t("home.noTeams")}
                    </Text>
                  ) : (
                    <View style={{ gap: 10 }}>
                      {teams.map((team) => {
                        const selected = selectedTeamIds.includes(team.id);

                        return (
                          <Pressable
                            key={team.id}
                            onPress={() => toggleTeamSelection(team.id)}
                            style={{
                              flexDirection: "row",
                              justifyContent: "space-between",
                              alignItems: "center",
                              paddingVertical: 10,
                              paddingHorizontal: 12,
                              borderRadius: 12,
                              backgroundColor: colors.bg,
                              borderWidth: 1,
                              borderColor: selected ? colors.primary : colors.border,
                            }}
                          >
                            <Text style={{ color: colors.text, fontWeight: "800", flex: 1 }}>
                              {team.name}
                            </Text>

                            <Switch
                              value={selected}
                              onValueChange={() => toggleTeamSelection(team.id)}
                            />
                          </Pressable>
                        );
                      })}
                    </View>
                  )}
                </View>
              ) : null}
            </ScrollView>

            <Pressable
              onPress={saveNotificationPreferences}
              disabled={savingPreferences}
              style={{
                marginTop: 8,
                paddingVertical: 13,
                borderRadius: 14,
                backgroundColor: savingPreferences ? colors.border : colors.primary,
                alignItems: "center",
                opacity: savingPreferences ? 0.7 : 1,
              }}
            >
              <Text style={{ color: colors.primaryText, fontWeight: "900" }}>
                {savingPreferences ? t("common.saving") : t("common.saveChanges")}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 18 }}>

        {/* Grid 2 columnes */}
        {/* Aquesta setmana (accés ràpid) */}
        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <Tile
            title={t("home.thisWeekTitle")}
            subtitle={t("home.thisWeekSubtitle")}
            onPress={() => router.push("/public-week-matches")}
          />
        </View>

        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <Tile
            title={t("home.matchesTitle")}
            subtitle={t("home.matchesSubtitle")}
            onPress={() => router.push("/public-matches")}
          />
          <Tile
            title={t("home.calendarTitle")}
            subtitle={t("home.calendarSubtitle")}
            onPress={() => router.push("/public-calendar")}
          />
        </View>

        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <Tile
            title={t("home.individualRankingTitle")}
            subtitle={t("home.individualRankingSubtitle")}
            onPress={() => router.push("/rankings")}
          />
          <Tile
            title={t("home.teamRankingTitle")}
            subtitle={t("home.teamRankingSubtitle")}
            onPress={() => router.push("/team-rankings")}
          />
        </View>

        <View style={{ flexDirection: "row", gap: 12, marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Tile
              title={t("home.refereeTitle")}
              subtitle={t("home.refereeSubtitle")}
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
