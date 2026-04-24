import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";
import { useAppTheme } from "../../src/theme";

type RefereeRow = {
  id: number;
  name: string;
  created_at?: string | null;
  assigned_matches: number;
  has_user: boolean;
  linked_users_count: number;
  active_users_count: number;
  linked_user_ids: string[];
  is_protected: boolean;
};

function normalize(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString();
}

export default function AdminRefereesScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [rows, setRows] = useState<RefereeRow[]>([]);
  const [query, setQuery] = useState("");

  const [newName, setNewName] = useState("");
  const [savingCreate, setSavingCreate] = useState(false);

  const [editOpen, setEditOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<RefereeRow | null>(null);
  const [editName, setEditName] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const visibleRows = useMemo(() => {
    const q = normalize(query);
    if (!q) return rows;
    return rows.filter((r) => normalize(`${r.name} ${r.id}`).includes(q));
  }, [rows, query]);

  const summary = useMemo(() => {
    return {
      total: rows.length,
      withUsers: rows.filter((r) => r.has_user).length,
      free: rows.filter((r) => !r.has_user).length,
      blocked: rows.filter((r) => r.assigned_matches > 0).length,
    };
  }, [rows]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const { data: refData, error: refErr } = await supabase
        .from("referee")
        .select("id,name,created_at")
        .order("id", { ascending: true });
      if (refErr) throw refErr;

      const { data: matchData, error: matchErr } = await supabase
        .from("match")
        .select("referee_id");

      if (matchErr) throw matchErr;

      const { data: refereeUserData, error: ruErr } = await supabase
        .from("referee_user")
        .select("referee_id,user_id,is_active");
      if (ruErr) throw ruErr;

      const matchCountByRef = new Map<number, number>();
      for (const m of matchData ?? []) {
        const refereeId = Number((m as any).referee_id);
        if (!Number.isFinite(refereeId)) continue;
        matchCountByRef.set(refereeId, (matchCountByRef.get(refereeId) ?? 0) + 1);
      }

      const usersByRef = new Map<number, { total: number; active: number; ids: string[] }>();
      for (const row of refereeUserData ?? []) {
  const refereeId = Number((row as any).referee_id);

  if (!Number.isFinite(refereeId)) continue;

  const current = usersByRef.get(refereeId) ?? { total: 0, active: 0, ids: [] };
  current.total += 1;
  if ((row as any).is_active) current.active += 1;
  if ((row as any).user_id) current.ids.push((row as any).user_id);
  usersByRef.set(refereeId, current);
}

      const nextRows: RefereeRow[] = ((refData as any[]) ?? []).map((r) => {
        const userInfo = usersByRef.get(r.id) ?? { total: 0, active: 0, ids: [] };
        return {
          id: r.id,
          name: r.name,
          created_at: r.created_at,
          assigned_matches: matchCountByRef.get(r.id) ?? 0,
          has_user: userInfo.total > 0,
          linked_users_count: userInfo.total,
          active_users_count: userInfo.active,
          linked_user_ids: userInfo.ids,
          is_protected: r.id === 1 || r.id === 2,
        };
      });
      setRows(nextRows);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'han pogut carregar els àrbitres.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load(false);
  }, [load]);

  async function createReferee() {
    const name = newName.trim();
    if (name.length < 2) {
      Alert.alert("Nom invàlid", "Escriu un nom d'àrbitre vàlid.");
      return;
    }

    try {
      setSavingCreate(true);
      const { error } = await supabase.rpc("admin_create_referee", {
        p_name: name,
      });
      if (error) throw error;

      setNewName("");
      await load(false);
      Alert.alert("Fet ✅", "Àrbitre creat correctament.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut crear l'àrbitre.");
    } finally {
      setSavingCreate(false);
    }
  }

  function openEdit(row: RefereeRow) {
    if (row.is_protected) {
      Alert.alert("Bloquejat", "Aquest àrbitre no es pot modificar.");
      return;
    }
    setEditingRow(row);
    setEditName(row.name);
    setEditOpen(true);
  }

  async function saveEdit() {
    if (!editingRow) return;

    const name = editName.trim();
    if (name.length < 2) {
      Alert.alert("Nom invàlid", "Escriu un nom d'àrbitre vàlid.");
      return;
    }

    try {
      setSavingEdit(true);
      const { error } = await supabase.rpc("admin_update_referee", {
        p_referee_id: editingRow.id,
        p_name: name,
      });
      if (error) throw error;

      setEditOpen(false);
      setEditingRow(null);
      setEditName("");
      await load(false);
      Alert.alert("Fet ✅", "Nom d'àrbitre actualitzat.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut actualitzar l'àrbitre.");
    } finally {
      setSavingEdit(false);
    }
  }

  function askDelete(row: RefereeRow) {
    if (row.is_protected) {
      Alert.alert("Bloquejat", "Aquest àrbitre no es pot eliminar.");
      return;
    }

    if (row.assigned_matches > 0) {
      Alert.alert(
        "No es pot eliminar",
        `Aquest àrbitre té ${row.assigned_matches} partit(s) assignat(s). No es pot eliminar per no perdre l'històric.`
      );
      return;
    }

    Alert.alert(
      "Eliminar àrbitre",
      `Segur que vols eliminar ${row.name}?`,
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Eliminar",
          style: "destructive",
          onPress: async () => {
            try {
              const { error } = await supabase.rpc("admin_delete_referee", {
                p_referee_id: row.id,
              });
              if (error) throw error;

              await load(false);
              Alert.alert("Fet ✅", "Àrbitre eliminat correctament.");
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut eliminar l'àrbitre.");
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={{ flex: 1, justifyContent: "center", alignItems: "center" }}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 10, color: colors.muted, fontWeight: "700" }}>Carregant…</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, backgroundColor: colors.bg, padding: 16 }}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        contentContainerStyle={{ paddingBottom: 20 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
          <BackButton onPress={() => router.back()} />
          <RefreshButton onPress={() => load(true)} />
        </View>

        <Text style={{ fontSize: 24, fontWeight: "900", color: colors.text, textAlign: "center" }}>
          👨‍⚖️ Gestió d'àrbitres
        </Text>
        <Text style={{ marginTop: 6, textAlign: "center", color: colors.muted, fontWeight: "700" }}>
          Crea, edita i controla quins àrbitres tenen usuari assignat.
        </Text>

        {/* <View
          style={{
            marginTop: 14,
            backgroundColor: "white",
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: "#E5E7EB",
          }}
        >
          <Text style={{ fontWeight: "900", fontSize: 17, color: "#111827", marginBottom: 10 }}>
            Resum
          </Text>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <View style={{ flex: 1, backgroundColor: "#F9FAFB", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#6B7280", fontWeight: "800", fontSize: 12 }}>Total</Text>
              <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.total}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: "#EFF6FF", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#1D4ED8", fontWeight: "800", fontSize: 12 }}>Amb usuari</Text>
              <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.withUsers}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1, backgroundColor: "#F0FDF4", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#166534", fontWeight: "800", fontSize: 12 }}>Sense usuari</Text>
              <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.free}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: "#FEF2F2", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#991B1B", fontWeight: "800", fontSize: 12 }}>Bloquejats</Text>
              <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.blocked}</Text>
            </View>
          </View>
        </View> */}

        <View
          style={{
            marginTop: 14,
            backgroundColor: colors.card,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontWeight: "900", fontSize: 17, color: colors.text, marginBottom: 10 }}>
            Afegir àrbitre
          </Text>

          <TextInput
            value={newName}
            onChangeText={setNewName}
            placeholder="Nom de l'àrbitre"
            placeholderTextColor="#9CA3AF"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: colors.card,
            }}
          />

          <Pressable
            onPress={createReferee}
            disabled={savingCreate}
            style={{
              marginTop: 12,
              backgroundColor: colors.primary,
              borderRadius: 12,
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 12,
              opacity: savingCreate ? 0.5 : 1,
            }}
          >
            {savingCreate ? <ActivityIndicator color={colors.primaryText} /> : <Text style={{ color: colors.primaryText, fontWeight: "900" }}>Afegir àrbitre</Text>}
          </Pressable>
        </View>

        <View
          style={{
            marginTop: 14,
            backgroundColor: colors.card,
            borderRadius: 16,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontWeight: "900", fontSize: 17, color: colors.text, marginBottom: 10 }}>
            Llistat actual
          </Text>

          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Buscar per nom o ID..."
            placeholderTextColor="#9CA3AF"
            style={{
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 10,
              backgroundColor: colors.card,
              marginBottom: 12,
            }}
          />

          {visibleRows.length === 0 ? (
            <View style={{ paddingVertical: 36, alignItems: "center" }}>
              <Text style={{ fontWeight: "900", color: colors.text, fontSize: 18 }}>Sense àrbitres</Text>
              <Text style={{ marginTop: 8, color: colors.muted, fontWeight: "700" }}>
                No hi ha coincidències amb aquest filtre.
              </Text>
            </View>
          ) : (
            visibleRows.map((item) => {
              const userLabel = item.has_user
                ? item.active_users_count > 0
                  ? `Usuari actiu (${item.active_users_count})`
                  : `Usuari vinculat (${item.linked_users_count})`
                : "Sense usuari";

              return (
                <View
                  key={item.id}
                  style={{
                    borderWidth: 1,
                    borderColor: colors.border,
                    borderRadius: 14,
                    padding: 14,
                    marginBottom: 10,
                    backgroundColor: item.is_protected ? colors.cardAlt : colors.card,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontWeight: "900", color: colors.text, fontSize: 16 }}>
                        {item.name}
                      </Text>
                      <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "700" }}>
                        ID #{item.id}
                        {item.created_at ? ` · creat ${formatDate(item.created_at)}` : ""}
                      </Text>
                    </View>

                    <View
                      style={{
                        borderRadius: 999,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        backgroundColor: item.has_user ? "#DBEAFE" : "#F3F4F6",
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: "900",
                          color: item.has_user ? "#1D4ED8" : "#374151",
                          fontSize: 12,
                        }}
                      >
                        {userLabel}
                      </Text>
                    </View>
                  </View>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
                    <View
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        backgroundColor: item.assigned_matches > 0 ? "#FEF2F2" : "#F0FDF4",
                      }}
                    >
                      <Text
                        style={{
                          fontWeight: "900",
                          color: item.assigned_matches > 0 ? "#991B1B" : "#166534",
                          fontSize: 12,
                        }}
                      >
                        Partits assignats: {item.assigned_matches}
                      </Text>
                    </View>

                    {item.is_protected ? (
                      <View
                        style={{
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 999,
                          backgroundColor: "#FFF7ED",
                        }}
                      >
                        <Text style={{ fontWeight: "900", color: "#9A3412", fontSize: 12 }}>
                          Sistema protegit
                        </Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                    <Pressable
                      onPress={() => openEdit(item)}
                      disabled={item.is_protected}
                      style={{
                        flex: 1,
                        borderWidth: 1,
                        borderColor: colors.border,
                        borderRadius: 12,
                        paddingVertical: 10,
                        alignItems: "center",
                        backgroundColor: colors.card,
                        opacity: item.is_protected ? 0.45 : 1,
                      }}
                    >
                      <Text style={{ fontWeight: "900", color: colors.text }}>Editar</Text>
                    </Pressable>

                    <Pressable
                      onPress={() => askDelete(item)}
                      disabled={item.is_protected || item.assigned_matches > 0}
                      style={{
                        flex: 1,
                        borderWidth: 1,
                        borderColor: "#FCA5A5",
                        borderRadius: 12,
                        paddingVertical: 10,
                        alignItems: "center",
                        backgroundColor: "#FEF2F2",
                        opacity: item.is_protected || item.assigned_matches > 0 ? 0.45 : 1,
                      }}
                    >
                      <Text style={{ fontWeight: "900", color: "#B91C1C" }}>Eliminar</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <Modal visible={editOpen} transparent animationType="fade" onRequestClose={() => setEditOpen(false)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.35)",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontSize: 19, fontWeight: "900", color: colors.text, marginBottom: 12 }}>
              Editar àrbitre
            </Text>

            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Nom de l'àrbitre"
              placeholderTextColor="#9CA3AF"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                backgroundColor: colors.card,
              }}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable
                onPress={() => setEditOpen(false)}
                style={{
                  flex: 1,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 12,
                  paddingVertical: 12,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900", color: colors.text }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={saveEdit}
                disabled={savingEdit}
                style={{
                  flex: 1,
                  backgroundColor: colors.primary,
                  borderRadius: 12,
                  paddingVertical: 12,
                  alignItems: "center",
                  opacity: savingEdit ? 0.45 : 1,
                }}
              >
                {savingEdit ? <ActivityIndicator color={colors.primaryText} /> : <Text style={{ color: colors.primaryText, fontWeight: "900" }}>Guardar</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}