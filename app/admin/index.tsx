import { View, Text, Pressable, Alert, ScrollView, Modal, TextInput, ActivityIndicator } from "react-native";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { supabase } from "../../src/supabase";

type BackupRow = {
  id: number;
  match_id?: number;
  created_at: string;
  created_by: string | null;
  reason: string | null;
};

export default function AdminHome() {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  // ⚠️ Opció sensible: netejar dades d'un partit
  const [cleanModalOpen, setCleanModalOpen] = useState(false);
  const [cleanMatchId, setCleanMatchId] = useState("");
  const [cleanReason, setCleanReason] = useState("");
  const [cleanConfirmText, setCleanConfirmText] = useState("");
  const [cleaning, setCleaning] = useState(false);

  // ♻️ Recuperar partit (des de backups)
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreMatchId, setRestoreMatchId] = useState("");
  const [restoreLoading, setRestoreLoading] = useState(false);
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [selectedBackupId, setSelectedBackupId] = useState<number | null>(null);

  const canRunClean = useMemo(() => {
    const n = Number(cleanMatchId.trim());
    return Number.isFinite(n) && n > 0 && cleanConfirmText.trim().toUpperCase() === "NETEJAR";
  }, [cleanMatchId, cleanConfirmText]);

  useEffect(() => {
    (async () => {
      setLoading(true);

      const { data: sessionRes } = await supabase.auth.getSession();
      const user = sessionRes.session?.user;

      if (!user) {
        router.replace("/login");
        return;
      }

      const { data: adminRow, error } = await supabase
        .from("championship_admin_user")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (error) {
        Alert.alert("Error", error.message);
        setAllowed(false);
      } else {
        setAllowed(!!adminRow);
      }

      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (!loading && !allowed) {
      Alert.alert("Accés denegat", "Aquesta secció és només per gestors del campionat.");
      router.back();
    }
  }, [loading, allowed]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <Text style={{ textAlign: "center" }}>Carregant…</Text>
      </View>
    );
  }

  if (!allowed) return null;

  const resetCleanModal = () => {
    setCleanModalOpen(false);
    setCleanMatchId("");
    setCleanReason("");
    setCleanConfirmText("");
  };

  const resetRestoreModal = () => {
    setRestoreModalOpen(false);
    setRestoreMatchId("");
    setBackups([]);
    setSelectedBackupId(null);
  };

  const runCleanMatch = async () => {
    const n = Number(cleanMatchId.trim());
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert("ID invàlid", "Introdueix un número de partit vàlid.");
      return;
    }
    if (cleanConfirmText.trim().toUpperCase() !== "NETEJAR") {
      Alert.alert("Confirmació necessària", "Has d'escriure NETEJAR per habilitar aquesta acció.");
      return;
    }

    Alert.alert(
      "⚠️ Confirmació final",
      `Segur que vols NETEJAR el partit ${n}?\n\nAixò crearà un backup i després esborrarà dades de joc (jugades, events, alineacions/rounds). Aquesta acció és irreversible.`,
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Sí, netejar",
          style: "destructive",
          onPress: async () => {
            try {
              setCleaning(true);
              const { error } = await supabase.rpc("admin_clean_match", {
                p_match_id: n,
                p_reason: cleanReason.trim() ? cleanReason.trim() : null,
              });
              if (error) throw error;

              resetCleanModal();
              Alert.alert("Fet ✅", "Partit netejat correctament (backup guardat).");
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut netejar el partit.");
            } finally {
              setCleaning(false);
            }
          },
        },
      ]
    );
  };

  const fetchBackupsForMatch = async () => {
    const n = Number(restoreMatchId.trim());
    if (!Number.isFinite(n) || n <= 0) {
      Alert.alert("ID invàlid", "Introdueix un número de partit vàlid.");
      return;
    }

    try {
      setRestoreLoading(true);
      setBackups([]);
      setSelectedBackupId(null);

      const { data, error } = await supabase
        .from("match_cleanup_backup")
        .select("id, match_id, created_at, created_by, reason")
        .eq("match_id", n)
        .order("created_at", { ascending: false });

      if (error) throw error;

      setBackups((data ?? []) as any);
      if (!data || data.length === 0) {
        Alert.alert("Sense backups", `No hi ha cap backup guardat pel partit ${n}.`);
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'han pogut carregar els backups.");
    } finally {
      setRestoreLoading(false);
    }
  };

  const runRestore = async () => {
    if (!selectedBackupId) {
      Alert.alert("Falta selecció", "Selecciona un backup a recuperar.");
      return;
    }

    Alert.alert(
      "♻️ Recuperar partit",
      "Aquesta acció restaurarà les dades esborrades DES DEL BACKUP seleccionat.\n\nNomés es permet si el partit NO ha començat (started_at és NULL).",
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Recuperar",
          style: "default",
          onPress: async () => {
            try {
              setRestoreLoading(true);
              const { error } = await supabase.rpc("admin_restore_match_from_backup", {
                p_backup_id: selectedBackupId,
              });
              if (error) throw error;

              Alert.alert("Fet ✅", "Partit recuperat correctament.");
              resetRestoreModal();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut recuperar el partit.");
            } finally {
              setRestoreLoading(false);
            }
          },
        },
      ]
    );
  };

  const Btn = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#ddd",
        backgroundColor: "white",
        marginBottom: 12,
      }}
    >
      <Text style={{ fontWeight: "700", fontSize: 16 }}>{title}</Text>
    </Pressable>
  );

  const DangerBtn = ({ title, onPress }: { title: string; onPress: () => void }) => (
    <Pressable
      onPress={onPress}
      style={{
        paddingVertical: 14,
        paddingHorizontal: 14,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "rgba(239, 68, 68, 0.45)",
        backgroundColor: "rgba(239, 68, 68, 0.08)",
        marginBottom: 12,
      }}
    >
      <Text style={{ fontWeight: "800", fontSize: 16, color: "#B91C1C" }}>{title}</Text>
    </Pressable>
  );

  return (
    <View style={{ flex: 1, padding: 16 }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
        <Pressable onPress={() => router.back()} style={{ paddingVertical: 8, paddingHorizontal: 8 }}>
          <Text style={{ fontWeight: "800" }}>←</Text>
        </Pressable>

        <Text style={{ fontSize: 22, fontWeight: "800", flex: 1, textAlign: "center", marginRight: 32 }}>
          ⚙️ Administració
        </Text>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
        <Btn title="🏆 Campionats" onPress={() => router.push("/admin/championship")} />
        <Btn title="🧩 Configuració" onPress={() => router.push("/admin/championship-config")} />
        <Btn title="👥 Equips" onPress={() => router.push("/admin/teams")} />
        <Btn title="🧍 Jugadors" onPress={() => router.push("/admin/players")} />
        <Btn title="🗓️ Crear Calendari" onPress={() => router.push("/admin/create-calendar")} />
        <Btn title="🎲 Sorteig/Crear partits" onPress={() => router.push("/admin/draw-matches")} />
        <Btn title="🎲 Crear eliminatories" onPress={() => router.push("/admin/draw-elimination")} />
        <Btn title="🗓️ Moure partits d'horari" onPress={() => router.push("/admin/calendar")} />

        <View style={{ height: 8 }} />
        <DangerBtn title="🌧️ Ajornar / treure ajornament" onPress={() => router.push("/admin/match-postpone")} />
        <DangerBtn title="🕒 Canviar hores partit" onPress={() => router.push("/admin/edit-match-times")} />
        <DangerBtn title="🛠️ Corregir jugades" onPress={() => router.push("/admin/edit-match-plays")} />
        <DangerBtn title="🧹 Netejar partit (EXTREM)" onPress={() => setCleanModalOpen(true)} />
        <DangerBtn title="♻️ Recuperar partit (BACKUP)" onPress={() => setRestoreModalOpen(true)} />
        <DangerBtn title="🚫 Sancions d'equip" onPress={() => router.push("/admin/team-sanctions")} />
      </ScrollView>

      {/* =======================
          MODAL: NETEJAR
         ======================= */}
      <Modal
        visible={cleanModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => (cleaning ? null : resetCleanModal())}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 520,
              backgroundColor: "white",
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: "#eee",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 6 }}>🧹 Netejar partit (EXTREM)</Text>
            <Text style={{ color: "#444", marginBottom: 12 }}>
              Introdueix l'ID del partit i el motiu. Per seguretat, has d'escriure NETEJAR per habilitar el botó.
              {"\n\n"}Abans d'esborrar, es guardarà un backup complet a la BD.
            </Text>

            <Text style={{ fontWeight: "800", marginBottom: 8 }}>ID del partit</Text>
            <TextInput
              value={cleanMatchId}
              onChangeText={setCleanMatchId}
              editable={!cleaning}
              keyboardType="number-pad"
              placeholder="Ex: 123"
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontWeight: "700",
              }}
            />

            <Text style={{ fontWeight: "800", marginBottom: 8, marginTop: 12 }}>Motiu (opcional)</Text>
            <TextInput
              value={cleanReason}
              onChangeText={setCleanReason}
              editable={!cleaning}
              placeholder="Ex: errors de càrrega, partit mal configurat…"
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
              }}
            />

            <Text style={{ fontWeight: "900", color: "#991B1B", marginBottom: 8, marginTop: 12 }}>
              Escriu NETEJAR per confirmar
            </Text>
            <TextInput
              value={cleanConfirmText}
              onChangeText={setCleanConfirmText}
              editable={!cleaning}
              autoCapitalize="characters"
              autoCorrect={false}
              placeholder="NETEJAR"
              style={{
                borderWidth: 1,
                borderColor: "#FCA5A5",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontWeight: "900",
              }}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
              <Pressable
                disabled={cleaning}
                onPress={() => resetCleanModal()}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "800" }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={runCleanMatch}
                disabled={cleaning || !canRunClean}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  backgroundColor: "#DC2626",
                  alignItems: "center",
                  opacity: cleaning || !canRunClean ? 0.45 : 1,
                }}
              >
                {cleaning ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <ActivityIndicator />
                    <Text style={{ fontWeight: "900", color: "white" }}>Netejant…</Text>
                  </View>
                ) : (
                  <Text style={{ fontWeight: "900", color: "white" }}>Netejar</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* =======================
          MODAL: RECUPERAR
         ======================= */}
      <Modal
        visible={restoreModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => (restoreLoading ? null : resetRestoreModal())}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              width: "100%",
              maxWidth: 520,
              backgroundColor: "white",
              borderRadius: 16,
              padding: 16,
              borderWidth: 1,
              borderColor: "#eee",
            }}
          >
            <Text style={{ fontSize: 18, fontWeight: "900", marginBottom: 6 }}>♻️ Recuperar partit (BACKUP)</Text>
            <Text style={{ color: "#444", marginBottom: 12 }}>
              Busca backups pel match id i selecciona'n un per recuperar. Només es pot recuperar si el partit NO ha
              començat (started_at = NULL).
            </Text>

            <Text style={{ fontWeight: "800", marginBottom: 8 }}>ID del partit</Text>
            <TextInput
              value={restoreMatchId}
              onChangeText={setRestoreMatchId}
              editable={!restoreLoading}
              keyboardType="number-pad"
              placeholder="Ex: 123"
              style={{
                borderWidth: 1,
                borderColor: "#ddd",
                borderRadius: 12,
                paddingHorizontal: 12,
                paddingVertical: 10,
                fontWeight: "700",
              }}
            />

            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <Pressable
                disabled={restoreLoading}
                onPress={fetchBackupsForMatch}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  alignItems: "center",
                  backgroundColor: "white",
                }}
              >
                {restoreLoading ? <ActivityIndicator /> : <Text style={{ fontWeight: "800" }}>Cercar backups</Text>}
              </Pressable>

              <Pressable
                disabled={restoreLoading}
                onPress={resetRestoreModal}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  alignItems: "center",
                  backgroundColor: "white",
                }}
              >
                <Text style={{ fontWeight: "800" }}>Tancar</Text>
              </Pressable>
            </View>

            <View style={{ marginTop: 14, maxHeight: 260 }}>
              <ScrollView showsVerticalScrollIndicator={false}>
                {backups.map((b) => {
                  const selected = selectedBackupId === b.id;
                  const dateLabel = new Date(b.created_at).toLocaleString();
                  return (
                    <Pressable
                      key={b.id}
                      onPress={() => setSelectedBackupId(b.id)}
                      style={{
                        paddingVertical: 12,
                        paddingHorizontal: 12,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: selected ? "#111827" : "#E5E7EB",
                        backgroundColor: selected ? "rgba(17,24,39,0.06)" : "white",
                        marginBottom: 10,
                      }}
                    >
                      <Text style={{ fontWeight: "900" }}>Backup #{b.id}</Text>
                      <Text style={{ color: "#374151", marginTop: 2 }}>{dateLabel}</Text>
                      {b.reason ? <Text style={{ color: "#111827", marginTop: 6 }}>Motiu: {b.reason}</Text> : null}
                    </Pressable>
                  );
                })}
                {backups.length === 0 ? (
                  <Text style={{ color: "#6B7280", marginTop: 6 }}>
                    Encara no has carregat backups (o no n'hi ha).
                  </Text>
                ) : null}
              </ScrollView>
            </View>

            <Pressable
              onPress={runRestore}
              disabled={restoreLoading || !selectedBackupId}
              style={{
                marginTop: 10,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "#111827",
                alignItems: "center",
                opacity: restoreLoading || !selectedBackupId ? 0.45 : 1,
              }}
            >
              {restoreLoading ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <ActivityIndicator color="white" />
                  <Text style={{ fontWeight: "900", color: "white" }}>Recuperant…</Text>
                </View>
              ) : (
                <Text style={{ fontWeight: "900", color: "white" }}>Recuperar backup seleccionat</Text>
              )}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
