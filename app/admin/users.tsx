import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";
import { useAppTheme } from "../../src/theme";

type UserRow = {
  referee_id: number;
  referee_name: string;
  referee_created_at: string | null;
  assigned_matches: number;
  is_protected: boolean;
  has_user: boolean;
  user_id: string | null;
  is_active: boolean;
  link_created_at: string | null;
  email: string | null;
  user_created_at: string | null;
  last_sign_in_at: string | null;
};

function formatDate(iso?: string | null) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString();
}

function normalize(s: string) {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [rows, setRows] = useState<UserRow[]>([]);
  const [query, setQuery] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [selectedRefereeId, setSelectedRefereeId] = useState<number | null>(null);
  const [savingCreate, setSavingCreate] = useState(false);

  const [resetOpen, setResetOpen] = useState(false);
  const [resetReferee, setResetReferee] = useState<UserRow | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [savingReset, setSavingReset] = useState(false);

  const [reassignOpen, setReassignOpen] = useState(false);
  const [reassignFrom, setReassignFrom] = useState<UserRow | null>(null);
  const [reassignToRefereeId, setReassignToRefereeId] = useState<number | null>(null);
  const [savingReassign, setSavingReassign] = useState(false);

  const visibleRows = useMemo(() => {
    const q = normalize(query);
    if (!q) return rows;

    return rows.filter((r) =>
      normalize(`${r.referee_name} ${r.email ?? ""} ${r.referee_id}`).includes(q)
    );
  }, [rows, query]);

  const freeReferees = useMemo(
    () => rows.filter((r) => !r.has_user && !r.is_protected),
    [rows]
  );

  const summary = useMemo(() => {
    return {
      total: rows.length,
      withUser: rows.filter((r) => r.has_user).length,
      withoutUser: rows.filter((r) => !r.has_user).length,
      active: rows.filter((r) => r.has_user && r.is_active).length,
      inactive: rows.filter((r) => r.has_user && !r.is_active).length,
    };
  }, [rows]);

  const invokeAdminUsers = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("admin-referee-users", {
      body,
    });

    if (error) {
      const contextText =
        typeof (error as any)?.context?.text === "function"
          ? await (error as any).context.text()
          : null;

      if (contextText) {
        try {
          const parsed = JSON.parse(contextText);
          throw new Error(parsed?.error ?? error.message);
        } catch {
          throw new Error(contextText);
        }
      }

      throw new Error(error.message);
    }

    return data as any;
  }, []);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const data = await invokeAdminUsers({ action: "list" });
      setRows((data?.rows ?? []) as UserRow[]);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'han pogut carregar els usuaris.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [invokeAdminUsers]);

  useEffect(() => {
    load(false);
  }, [load]);

  async function createUser() {
    if (!email.trim() || !password.trim() || !selectedRefereeId) {
      Alert.alert("Falten dades", "Has d'omplir email, contrasenya i seleccionar un àrbitre.");
      return;
    }
    if (!confirmPassword.trim()) {
  Alert.alert("Falta confirmació", "Has de repetir la contrasenya.");
  return;
}

if (password !== confirmPassword) {
  Alert.alert("Contrasenyes diferents", "Les dues contrasenyes no coincideixen.");
  return;
}

    try {
      setSavingCreate(true);
      await invokeAdminUsers({
        action: "create",
        email: email.trim(),
        password: password,
        referee_id: selectedRefereeId,
      });

      setCreateOpen(false);
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setSelectedRefereeId(null);
      await load(false);
      Alert.alert("Fet ✅", "Usuari creat i vinculat correctament.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut crear l'usuari.");
    } finally {
      setSavingCreate(false);
    }
  }

  async function toggleActive(row: UserRow, nextValue: boolean) {
    try {
      await invokeAdminUsers({
        action: "set_active",
        referee_id: row.referee_id,
        is_active: nextValue,
      });

      await load(false);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut actualitzar l'estat.");
    }
  }

  function openResetPassword(row: UserRow) {
    setResetReferee(row);
    setNewPassword("");
    setResetOpen(true);
  }

  async function saveResetPassword() {
    if (!resetReferee) return;

    if (newPassword.trim().length < 5) {
      Alert.alert("Contrasenya invàlida", "La nova contrasenya ha de tenir almenys 5 caràcters.");
      return;
    }

    try {
      setSavingReset(true);
      await invokeAdminUsers({
        action: "reset_password",
        referee_id: resetReferee.referee_id,
        new_password: newPassword.trim(),
      });

      setResetOpen(false);
      setResetReferee(null);
      setNewPassword("");
      Alert.alert("Fet ✅", "Contrasenya actualitzada correctament.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut restablir la contrasenya.");
    } finally {
      setSavingReset(false);
    }
  }

  function openReassign(row: UserRow) {
    setReassignFrom(row);
    setReassignToRefereeId(null);
    setReassignOpen(true);
  }

  async function saveReassign() {
    if (!reassignFrom || !reassignToRefereeId) {
      Alert.alert("Falten dades", "Selecciona l'àrbitre destí.");
      return;
    }

    try {
      setSavingReassign(true);
      await invokeAdminUsers({
        action: "reassign",
        from_referee_id: reassignFrom.referee_id,
        to_referee_id: reassignToRefereeId,
      });

      setReassignOpen(false);
      setReassignFrom(null);
      setReassignToRefereeId(null);
      await load(false);
      Alert.alert("Fet ✅", "Usuari reasignat correctament.");
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut reasignar l'usuari.");
    } finally {
      setSavingReassign(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, justifyContent: "center", alignItems: "center", backgroundColor: colors.bg }}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator size="large" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["left", "right", "bottom"]} style={{ flex: 1, padding: 16, backgroundColor: colors.bg }}>
      <Stack.Screen options={{ headerShown: false }} />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }}>
          <BackButton onPress={() => router.back()} />
          <RefreshButton onPress={() => load(true)} />
        </View>

        <Text style={{ fontSize: 24, fontWeight: "900", color: colors.text, textAlign: "center" }}>
          👤 Usuaris
        </Text>
        <Text style={{ marginTop: 6, textAlign: "center", color: colors.muted, fontWeight: "700" }}>
          Crea, activa, desactiva, reinicia contrasenyes i reasigna usuaris d'àrbitre.
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
              <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.withUser}</Text>
            </View>
          </View>

          <View style={{ flexDirection: "row", gap: 10, marginTop: 10 }}>
            <View style={{ flex: 1, backgroundColor: "#F0FDF4", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#166534", fontWeight: "800", fontSize: 12 }}>Actius</Text>
              <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.active}</Text>
            </View>
            <View style={{ flex: 1, backgroundColor: "#FEF2F2", borderRadius: 14, padding: 12 }}>
              <Text style={{ color: "#991B1B", fontWeight: "800", fontSize: 12 }}>Inactius</Text>
              <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.inactive}</Text>
            </View>
          </View>

          <View style={{ marginTop: 10, backgroundColor: "#FAFAFA", borderRadius: 14, padding: 12 }}>
            <Text style={{ color: "#6B7280", fontWeight: "800", fontSize: 12 }}>Sense usuari</Text>
            <Text style={{ marginTop: 4, color: "#111827", fontWeight: "900", fontSize: 20 }}>{summary.withoutUser}</Text>
          </View>
        </View> */}

        <Pressable
          onPress={() => setCreateOpen(true)}
          style={{
            marginTop: 14,
            backgroundColor: colors.primary,
            borderRadius: 12,
            alignItems: "center",
            justifyContent: "center",
            paddingVertical: 12,
          }}
        >
          <Text style={{ color: colors.primaryText, fontWeight: "900" }}>＋ Afegir usuari</Text>
        </Pressable>

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
            placeholder="Buscar per àrbitre, email o ID..."
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
              <Text style={{ fontWeight: "900", color: colors.text, fontSize: 18 }}>Sense resultats</Text>
              <Text style={{ marginTop: 8, color: colors.muted, fontWeight: "700" }}>
                No hi ha coincidències amb aquest filtre.
              </Text>
            </View>
          ) : (
            visibleRows.map((row) => (
              <View
                key={row.referee_id}
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 14,
                  padding: 14,
                  marginBottom: 10,
                  backgroundColor: colors.card,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: "900", color: colors.text, fontSize: 16 }}>
                      {row.referee_name}
                    </Text>
                    <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "700" }}>
                      ID #{row.referee_id} · Partits assignats: {row.assigned_matches}
                    </Text>
                    <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "700" }}>
                      {row.email ?? "Sense usuari"}
                    </Text>
                    {row.has_user ? (
                      <Text style={{ marginTop: 4, color: "#9CA3AF", fontWeight: "700" }}>
                        Creat: {formatDate(row.user_created_at)} · Últim accés: {formatDate(row.last_sign_in_at)}
                      </Text>
                    ) : null}
                  </View>

                  <View
                    style={{
                      borderRadius: 999,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      backgroundColor: !row.has_user
                        ? "#F3F4F6"
                        : row.is_active
                        ? "#DCFCE7"
                        : "#FEE2E2",
                    }}
                  >
                    <Text
                      style={{
                        fontWeight: "900",
                        color: !row.has_user
                          ? "#374151"
                          : row.is_active
                          ? "#166534"
                          : "#991B1B",
                        fontSize: 12,
                      }}
                    >
                      {!row.has_user ? "Sense usuari" : row.is_active ? "Usuari actiu" : "Usuari inactiu"}
                    </Text>
                  </View>
                </View>

                {row.has_user ? (
                  <>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
                      <Text style={{ fontWeight: "800", color: colors.text }}>
                        Actiu
                      </Text>
                      <Switch value={row.is_active} onValueChange={(next) => toggleActive(row, next)} />
                    </View>

                    <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
                      <Pressable
                        onPress={() => openResetPassword(row)}
                        style={{
                          flex: 1,
                          borderWidth: 1,
                          borderColor: colors.border,
                          borderRadius: 12,
                          paddingVertical: 10,
                          alignItems: "center",
                          backgroundColor: colors.card,
                        }}
                      >
                        <Text style={{ fontWeight: "900", color: colors.text }}>Reset pass</Text>
                      </Pressable>

                      <Pressable
                        onPress={() => openReassign(row)}
                        style={{
                          flex: 1,
                          borderWidth: 1,
                          borderColor: "#DDD6FE",
                          borderRadius: 12,
                          paddingVertical: 10,
                          alignItems: "center",
                          backgroundColor: "#F5F3FF",
                        }}
                      >
                        <Text style={{ fontWeight: "900", color: "#6D28D9" }}>Reassignar</Text>
                      </Pressable>
                    </View>
                  </>
                ) : null}
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16 }}>

            <Text style={{ marginTop: 12, fontWeight: "800", color: colors.text }}>Correu electrònic</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              placeholder="nom@exemple.com"
              placeholderTextColor="#9CA3AF"
              style={{ borderWidth: 1, marginTop: 6, padding: 10, borderRadius: 10, borderColor: colors.border }}
            />

            <Text style={{ marginTop: 10, fontWeight: "800", color: colors.text }}>Contrasenya</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholderTextColor="#9CA3AF"
              placeholder="Escriu la contrasenya"
              style={{ borderWidth: 1, marginTop: 6, padding: 10, borderRadius: 10, borderColor: colors.border }}
            />

            <Text style={{ marginTop: 10, fontWeight: "800", color: colors.text }}>
              Repetir contrasenya
            </Text>
            <TextInput
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              placeholder="Torna a escriure la contrasenya"
              placeholderTextColor="#9CA3AF"
              style={{
                borderWidth: 1,
                marginTop: 6,
                padding: 10,
                borderRadius: 10,
                borderColor: colors.border,
              }}
            />

            <Text style={{ marginTop: 12, fontWeight: "900", color: colors.text }}>Selecciona àrbitre</Text>
            <ScrollView style={{ maxHeight: 180, marginTop: 6 }}>
              {freeReferees.map((r) => (
                <Pressable
                  key={r.referee_id}
                  onPress={() => setSelectedRefereeId(r.referee_id)}
                  style={{
                    padding: 10,
                    backgroundColor: selectedRefereeId === r.referee_id ? "#DDD6FE" : colors.cardAlt,
                    marginTop: 6,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ fontWeight: "700", color: colors.text }}>{r.referee_name}</Text>
                </Pressable>
              ))}

              {freeReferees.length === 0 ? (
                <Text style={{ color: colors.muted, fontWeight: "700", marginTop: 8 }}>
                  No hi ha àrbitres lliures per assignar.
                </Text>
              ) : null}
            </ScrollView>

            <View style={{ flexDirection: "row", marginTop: 14, gap: 10 }}>
              <Pressable
                onPress={() => {
                  setCreateOpen(false);
                  setEmail("");
                  setPassword("");
                  setConfirmPassword("");
                  setSelectedRefereeId(null);
                }}
                style={{ flex: 1, padding: 12, borderWidth: 1, borderRadius: 10, borderColor: colors.border }}
              >
                <Text style={{ textAlign: "center", fontWeight: "800", color: colors.text }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={createUser}
                disabled={
                  savingCreate ||
                  !email.trim() ||
                  !password.trim() ||
                  !confirmPassword.trim() ||
                  password !== confirmPassword ||
                  !selectedRefereeId
                }
                style={{ flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 10, opacity:savingCreate ||!email.trim() ||!password.trim() ||!confirmPassword.trim() ||password !== confirmPassword ||!selectedRefereeId ? 0.5 : 1 }}
              >
                {savingCreate ? (
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text style={{ color: colors.primaryText, textAlign: "center", fontWeight: "900" }}>
                    Crear
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={resetOpen} transparent animationType="fade" onRequestClose={() => setResetOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16 }}>
            <Text style={{ fontWeight: "900", fontSize: 18, color: colors.text }}>
              Reset password
            </Text>
            <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "700" }}>
              {resetReferee?.referee_name} · {resetReferee?.email ?? "Sense email"}
            </Text>

            <Text style={{ marginTop: 12, fontWeight: "800", color: colors.text }}>Nova contrasenya</Text>
            <TextInput
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              placeholder="Mínim 6 caràcters"
              placeholderTextColor="#9CA3AF"
              style={{ borderWidth: 1, marginTop: 6, padding: 10, borderRadius: 10, borderColor: colors.border }}
            />

            <View style={{ flexDirection: "row", marginTop: 14, gap: 10 }}>
              <Pressable
                onPress={() => setResetOpen(false)}
                style={{ flex: 1, padding: 12, borderWidth: 1, borderRadius: 10, borderColor: colors.border }}
              >
                <Text style={{ textAlign: "center", fontWeight: "800", color: colors.text }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={saveResetPassword}
                disabled={savingReset}
                style={{ flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 10, opacity: savingReset ? 0.5 : 1 }}
              >
                {savingReset ? (
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text style={{ color: colors.primaryText, textAlign: "center", fontWeight: "900" }}>
                    Guardar
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={reassignOpen} transparent animationType="fade" onRequestClose={() => setReassignOpen(false)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.35)", justifyContent: "center", padding: 16 }}>
          <View style={{ backgroundColor: colors.card, borderRadius: 16, padding: 16 }}>
            <Text style={{ fontWeight: "900", fontSize: 18, color: colors.text }}>
              Reassignar usuari
            </Text>
            <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "700" }}>
              Usuari actual de {reassignFrom?.referee_name}
            </Text>

            <Text style={{ marginTop: 12, fontWeight: "900", color: colors.text }}>Nou àrbitre</Text>
            <ScrollView style={{ maxHeight: 180, marginTop: 6 }}>
              {freeReferees.map((r) => (
                <Pressable
                  key={r.referee_id}
                  onPress={() => setReassignToRefereeId(r.referee_id)}
                  style={{
                    padding: 10,
                    backgroundColor: reassignToRefereeId === r.referee_id ? "#DDD6FE" : colors.cardAlt,
                    marginTop: 6,
                    borderRadius: 8,
                  }}
                >
                  <Text style={{ fontWeight: "700", color: colors.text }}>{r.referee_name}</Text>
                </Pressable>
              ))}
            </ScrollView>

            <View style={{ flexDirection: "row", marginTop: 14, gap: 10 }}>
              <Pressable
                onPress={() => setReassignOpen(false)}
                style={{ flex: 1, padding: 12, borderWidth: 1, borderRadius: 10, borderColor: colors.border }}
              >
                <Text style={{ textAlign: "center", fontWeight: "800", color: colors.text }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={saveReassign}
                disabled={savingReassign}
                style={{ flex: 1, backgroundColor: colors.primary, padding: 12, borderRadius: 10, opacity: savingReassign ? 0.5 : 1 }}
              >
                {savingReassign ? (
                  <ActivityIndicator color={colors.primaryText} />
                ) : (
                  <Text style={{ color: colors.primaryText, textAlign: "center", fontWeight: "900" }}>
                    Reassignar
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
