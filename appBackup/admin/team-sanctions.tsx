import { useCallback, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";

type ChampionshipRow = {
  id: number;
  name: string;
};

type ConfigRow = {
  id: number;
  value: {
    points?: number;
    canes?: number;
  } | null;
};

type TeamOption = {
  championship_team_id: number;
  team_id: number;
  team_name: string;
  team_short_name: string | null;
};

type SanctionType = "points" | "canes" | "both";

type SanctionRow = {
  id: number;
  championship_id: number;
  championship_team_id: number;
  sanction_type: SanctionType;
  points_value: number;
  canes_value: number;
  created_at: string;
  created_by: string | null;
  championship_team?: {
    id: number;
    team?: {
      id: number;
      name: string;
      short_name: string | null;
    } | null;
  } | null;
};

export default function TeamSanctionsScreen() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [championship, setChampionship] = useState<ChampionshipRow | null>(null);
  const [configId, setConfigId] = useState<number | null>(null);
  const [pointsConfig, setPointsConfig] = useState("3");
  const [canesConfig, setCanesConfig] = useState("300");

  const [teams, setTeams] = useState<TeamOption[]>([]);
  const [selectedChampionshipTeamId, setSelectedChampionshipTeamId] = useState<number | null>(null);
  const [showTeamPicker, setShowTeamPicker] = useState(false);

  const [sanctionType, setSanctionType] = useState<SanctionType>("points");
  const [sanctions, setSanctions] = useState<SanctionRow[]>([]);

  const selectedTeam = useMemo(
    () => teams.find((t) => t.championship_team_id === selectedChampionshipTeamId) ?? null,
    [teams, selectedChampionshipTeamId]
  );

  const computedValues = useMemo(() => {
    const p = Number(pointsConfig || "0");
    const c = Number(canesConfig || "0");

    if (sanctionType === "points") return { points: p, canes: 0 };
    if (sanctionType === "canes") return { points: 0, canes: c };
    return { points: p, canes: c };
  }, [sanctionType, pointsConfig, canesConfig]);

  const load = useCallback(async () => {
    try {
      setLoading(true);

      const { data: ch, error: chErr } = await supabase
        .from("championship")
        .select("id, name")
        .eq("is_active", true)
        .limit(1)
        .maybeSingle();

      if (chErr) throw chErr;

      if (!ch) {
        setChampionship(null);
        setTeams([]);
        setSanctions([]);
        setConfigId(null);
        return;
      }

      setChampionship(ch as ChampionshipRow);

      const { data: cfg, error: cfgErr } = await supabase
        .from("championship_config")
        .select("id, value")
        .eq("championship_id", ch.id)
        .is("phase_id", null)
        .eq("key", "team_sanction")
        .limit(1)
        .maybeSingle();

      if (cfgErr) throw cfgErr;

      if (cfg) {
        const cfgRow = cfg as ConfigRow;
        setConfigId(cfgRow.id);
        setPointsConfig(String(cfgRow.value?.points ?? 3));
        setCanesConfig(String(cfgRow.value?.canes ?? 300));
      } else {
        setConfigId(null);
        setPointsConfig("3");
        setCanesConfig("300");
      }

      const { data: teamData, error: teamErr } = await supabase
        .from("championship_team")
        .select("id, team_id, team:team_id(id, name, short_name)")
        .eq("championship_id", ch.id)
        .order("id", { ascending: true });

      if (teamErr) throw teamErr;

      const mappedTeams: TeamOption[] = (teamData ?? []).map((row: any) => ({
        championship_team_id: row.id,
        team_id: row.team_id,
        team_name: row.team?.name ?? `Equip ${row.team_id}`,
        team_short_name: row.team?.short_name ?? null,
      }));

      mappedTeams.sort((a, b) => a.team_name.localeCompare(b.team_name, "ca"));

      setTeams(mappedTeams);

      const { data: sanctionData, error: sanctionErr } = await supabase
        .from("team_sanction")
        .select(`
          id,
          championship_id,
          championship_team_id,
          sanction_type,
          points_value,
          canes_value,
          created_at,
          created_by,
          championship_team:championship_team_id(
            id,
            team:team_id(
              id,
              name,
              short_name
            )
          )
        `)
        .eq("championship_id", ch.id)
        .order("created_at", { ascending: false });

      if (sanctionErr) throw sanctionErr;

      setSanctions((sanctionData ?? []) as SanctionRow[]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'han pogut carregar les sancions.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  /*
async function saveConfig() {
  if (!championship?.id) return;

  const points = Number(pointsConfig);
  const canes = Number(canesConfig);

  if (!Number.isFinite(points) || points < 0) {
    Alert.alert("Valor invàlid", "Els punts han de ser un número >= 0.");
    return;
  }

  if (!Number.isFinite(canes) || canes < 0) {
    Alert.alert("Valor invàlid", "Els canes han de ser un número >= 0.");
    return;
  }

  try {
    setSaving(true);

    if (configId) {
      const { error } = await supabase
        .from("championship_config")
        .update({
          value: { points, canes },
          updated_at: new Date().toISOString(),
        })
        .eq("id", configId);

      if (error) throw error;
    } else {
      const { data, error } = await supabase
        .from("championship_config")
        .insert({
          championship_id: championship.id,
          phase_id: null,
          key: "team_sanction",
          value: { points, canes },
        })
        .select("id")
        .single();

      if (error) throw error;
      setConfigId(data.id);
    }

    Alert.alert("Fet ✅", "Configuració de sancions guardada.");
  } catch (e: any) {
    Alert.alert("Error", e?.message ?? "No s'ha pogut guardar la configuració.");
  } finally {
    setSaving(false);
  }
}
*/

  async function createSanction() {
    if (!championship?.id) {
      Alert.alert("Sense campionat", "No hi ha cap campionat actiu.");
      return;
    }

    if (!selectedChampionshipTeamId) {
      Alert.alert("Falta equip", "Selecciona un equip.");
      return;
    }

    const points = computedValues.points;
    const canes = computedValues.canes;

    try {
      setSaving(true);

      const {
        data: { user },
        error: userErr,
      } = await supabase.auth.getUser();

      if (userErr) throw userErr;

      const { error } = await supabase.from("team_sanction").insert({
        championship_id: championship.id,
        championship_team_id: selectedChampionshipTeamId,
        sanction_type: sanctionType,
        points_value: points,
        canes_value: canes,
        created_by: user?.id ?? null,
      });

      if (error) throw error;

      Alert.alert("Fet ✅", "Sanció creada correctament.");
      setSelectedChampionshipTeamId(null);
      setSanctionType("points");
      setShowTeamPicker(false);
      await load();
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut crear la sanció.");
    } finally {
      setSaving(false);
    }
  }

  async function editSanction(item: SanctionRow) {
    Alert.alert(
      "Editar sanció",
      "Vols substituir aquesta sanció pels valors actuals configurats?",
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Aplicar",
          onPress: async () => {
            try {
              setSaving(true);

              let nextPoints = 0;
              let nextCanes = 0;

              if (sanctionType === "points") nextPoints = Number(pointsConfig);
              if (sanctionType === "canes") nextCanes = Number(canesConfig);
              if (sanctionType === "both") {
                nextPoints = Number(pointsConfig);
                nextCanes = Number(canesConfig);
              }

              const { error } = await supabase
                .from("team_sanction")
                .update({
                  sanction_type: sanctionType,
                  points_value: nextPoints,
                  canes_value: nextCanes,
                })
                .eq("id", item.id);

              if (error) throw error;

              Alert.alert("Fet ✅", "Sanció actualitzada.");
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut editar la sanció.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  async function deleteSanction(id: number) {
    Alert.alert(
      "Eliminar sanció",
      "Segur que vols eliminar aquesta sanció?",
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              setSaving(true);

              const { error } = await supabase
                .from("team_sanction")
                .delete()
                .eq("id", id);

              if (error) throw error;

              Alert.alert("Fet ✅", "Sanció eliminada.");
              await load();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut eliminar la sanció.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.loadingWrap}>
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left","right","bottom"]} style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }} showsVerticalScrollIndicator={false}>
        <View style={styles.topRow}>
	<BackButton
          onPress={() => router.back()}
          style={{ marginTop:5 }}
        />
        </View>

        <Text style={styles.title}>🚫 Sancions d'equip</Text>
        <Text style={styles.subTitle}>
          {championship ? `Campionat actiu: ${championship.name}` : "No hi ha cap campionat actiu"}
        </Text>

        {/*
<View style={styles.card}>
  <Text style={styles.cardTitle}>Configuració</Text>

  <Text style={styles.label}>Punts a restar</Text>
  <TextInput
    value={pointsConfig}
    onChangeText={setPointsConfig}
    keyboardType="number-pad"
    style={styles.input}
    placeholder="3"
  />

  <Text style={styles.label}>Canes a restar</Text>
  <TextInput
    value={canesConfig}
    onChangeText={setCanesConfig}
    keyboardType="number-pad"
    style={styles.input}
    placeholder="300"
  />

  <Pressable onPress={saveConfig} disabled={saving} style={[styles.primaryBtn, saving && styles.btnDisabled]}>
    {saving ? <ActivityIndicator color="white" /> : <Text style={styles.primaryBtnText}>Guardar configuració</Text>}
  </Pressable>
</View>
*/}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Nova sanció</Text>

          <Text style={styles.label}>Equip</Text>
          <Pressable onPress={() => setShowTeamPicker((v) => !v)} style={styles.selectBtn}>
            <Text style={styles.selectBtnText}>
              {selectedTeam ? selectedTeam.team_name : "Selecciona un equip"}
            </Text>
            <Text style={styles.selectBtnChevron}>{showTeamPicker ? "▲" : "▼"}</Text>
          </Pressable>

          {showTeamPicker ? (
            <View style={styles.dropdown}>
              {teams.map((team) => {
                const selected = selectedChampionshipTeamId === team.championship_team_id;
                return (
                  <Pressable
                    key={team.championship_team_id}
                    onPress={() => {
                      setSelectedChampionshipTeamId(team.championship_team_id);
                      setShowTeamPicker(false);
                    }}
                    style={[styles.dropdownItem, selected && styles.dropdownItemSelected]}
                  >
                    <Text style={[styles.dropdownItemText, selected && styles.dropdownItemTextSelected]}>
                      {team.team_name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          <Text style={styles.label}>Tipus de sanció</Text>
          <View style={styles.chipsRow}>
            {(["points", "canes", "both"] as SanctionType[]).map((type) => {
              const active = sanctionType === type;
              return (
                <Pressable
                  key={type}
                  onPress={() => setSanctionType(type)}
                  style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                >
                  <Text style={[styles.chipText, active ? styles.chipTextActive : styles.chipTextInactive]}>
                    {type === "points" ? "Punts" : type === "canes" ? "Canes" : "Tots dos"}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.previewBox}>
            <Text style={styles.previewTitle}>Valor aplicat</Text>
            <Text style={styles.previewText}>Punts: -{computedValues.points}</Text>
            <Text style={styles.previewText}>Canes: -{computedValues.canes}</Text>
          </View>

          <Pressable onPress={createSanction} disabled={saving} style={[styles.dangerBtn, saving && styles.btnDisabled]}>
            {saving ? <ActivityIndicator color="white" /> : <Text style={styles.dangerBtnText}>Crear sanció</Text>}
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Sancions creades</Text>

          {sanctions.length === 0 ? (
            <Text style={styles.emptyText}>Encara no hi ha sancions creades.</Text>
          ) : (
            sanctions.map((item) => {
              const teamName =
                item.championship_team?.team?.name ??
                item.championship_team?.team?.short_name ??
                `Equip ${item.championship_team_id}`;

              return (
                <View key={item.id} style={styles.sanctionCard}>
                  <Text style={styles.sanctionTitle}>{teamName}</Text>
                  <Text style={styles.sanctionMeta}>
                    Tipus: {item.sanction_type} · Punts: -{item.points_value} · Canes: -{item.canes_value}
                  </Text>
                  <Text style={styles.sanctionDate}>
                    {new Date(item.created_at).toLocaleString()}
                  </Text>

                  <View style={styles.actionsRow}>
                    <Pressable onPress={() => editSanction(item)} style={styles.secondaryAction}>
                      <Text style={styles.secondaryActionText}>Editar</Text>
                    </Pressable>

                    <Pressable onPress={() => deleteSanction(item.id)} style={styles.deleteAction}>
                      <Text style={styles.deleteActionText}>Eliminar</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: "#F6F7FB",
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F6F7FB",
  },
  topRow: {
    marginBottom: 12,
  },
  backBtn: {
    alignSelf: "flex-start",
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: "white",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  backBtnText: {
    fontWeight: "900",
    fontSize: 16,
    color: "#111827",
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 4,
  },
  subTitle: {
    color: "#6B7280",
    fontWeight: "700",
    marginBottom: 14,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    padding: 14,
    marginBottom: 14,
  },
  cardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#111827",
    marginBottom: 12,
  },
  label: {
    fontWeight: "800",
    color: "#111827",
    marginBottom: 8,
    marginTop: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "white",
  },
  selectBtn: {
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "white",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  selectBtnText: {
    fontWeight: "700",
    color: "#111827",
    flex: 1,
  },
  selectBtnChevron: {
    fontWeight: "900",
    color: "#6B7280",
  },
  dropdown: {
    marginTop: 8,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "white",
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#F3F4F6",
  },
  dropdownItemSelected: {
    backgroundColor: "#EEF2FF",
  },
  dropdownItemText: {
    fontWeight: "700",
    color: "#111827",
  },
  dropdownItemTextSelected: {
    color: "#312E81",
  },
  chipsRow: {
    flexDirection: "row",
    gap: 10,
    flexWrap: "wrap",
    marginTop: 4,
  },
  chip: {
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  chipInactive: {
    backgroundColor: "white",
    borderColor: "#D1D5DB",
  },
  chipText: {
    fontWeight: "800",
  },
  chipTextActive: {
    color: "white",
  },
  chipTextInactive: {
    color: "#111827",
  },
  previewBox: {
    marginTop: 14,
    borderRadius: 12,
    backgroundColor: "#FFF7ED",
    borderWidth: 1,
    borderColor: "#FED7AA",
    padding: 12,
  },
  previewTitle: {
    fontWeight: "900",
    color: "#9A3412",
    marginBottom: 6,
  },
  previewText: {
    fontWeight: "700",
    color: "#7C2D12",
  },
  primaryBtn: {
    marginTop: 14,
    backgroundColor: "#111827",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  primaryBtnText: {
    color: "white",
    fontWeight: "900",
  },
  dangerBtn: {
    marginTop: 14,
    backgroundColor: "#DC2626",
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
  },
  dangerBtnText: {
    color: "white",
    fontWeight: "900",
  },
  btnDisabled: {
    opacity: 0.5,
  },
  emptyText: {
    color: "#6B7280",
    fontWeight: "700",
  },
  sanctionCard: {
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
  },
  sanctionTitle: {
    fontWeight: "900",
    fontSize: 15,
    color: "#111827",
  },
  sanctionMeta: {
    marginTop: 4,
    color: "#374151",
    fontWeight: "700",
  },
  sanctionDate: {
    marginTop: 6,
    color: "#6B7280",
    fontSize: 12,
    fontWeight: "700",
  },
  actionsRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 12,
  },
  secondaryAction: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#D1D5DB",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
    backgroundColor: "white",
  },
  secondaryActionText: {
    fontWeight: "800",
    color: "#111827",
  },
  deleteAction: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#FCA5A5",
    backgroundColor: "#FEF2F2",
    borderRadius: 10,
    alignItems: "center",
    paddingVertical: 10,
  },
  deleteActionText: {
    fontWeight: "800",
    color: "#B91C1C",
  },
});