import {
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  TextInput,
  Switch,
  Platform,
} from "react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, Stack } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "../../src/supabase";
import { BackButton, RefreshButton } from "../../components/HeaderButtons";

type ChampionshipRow = {
  id: number;
  year: number | null;
  name: string | null;
  location: string | null;
  created_at: string | null;
  is_active: boolean | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDate(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

function formatDateTime(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(
    d.getHours()
  )}:${pad2(d.getMinutes())}`;
}

export default function AdminChampionship() {
  const router = useRouter();

  // Access control
  const [checking, setChecking] = useState(true);
  const [allowed, setAllowed] = useState(false);

  // Data
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<ChampionshipRow[]>([]);

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ChampionshipRow | null>(null);

  const [year, setYear] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [isActive, setIsActive] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setEditing(null);
    setYear("");
    setName("");
    setLocation("");
    setIsActive(false);
  }, []);

  const openCreate = useCallback(() => {
    resetForm();
    // auto-suggest current year
    setYear(String(new Date().getFullYear()));
    setModalOpen(true);
  }, [resetForm]);

  const openEdit = useCallback((row: ChampionshipRow) => {
    setEditing(row);
    setYear(row.year ? String(row.year) : "");
    setName((row.name ?? "").toString());
    setLocation((row.location ?? "").toString());
    setIsActive(!!row.is_active);
    setModalOpen(true);
  }, []);

  const checkAccess = useCallback(async () => {
    setChecking(true);

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

    setChecking(false);
  }, [router]);

  const load = useCallback(async () => {
    setLoading(true);

    const { data, error } = await supabase
      .from("championship")
      .select("id,year,name,location,created_at,is_active")
      .order("is_active", { ascending: false })
      .order("year", { ascending: false })
      .order("id", { ascending: false });

    if (error) {
      Alert.alert("Error", error.message);
      setItems([]);
      setLoading(false);
      return;
    }

    setItems((data ?? []) as ChampionshipRow[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  useFocusEffect(
    useCallback(() => {
      checkAccess();
      load();
    }, [checkAccess, load])
  );

  useEffect(() => {
    if (!checking && !allowed) {
      Alert.alert("Accés denegat", "Aquesta secció és només per gestors del campionat.");
      router.back();
    }
  }, [checking, allowed, router]);

  const stats = useMemo(() => {
    const total = items.length;
    const active = items.find((x) => !!x.is_active);
    const activeLabel =
      active ? `${active.name || `Campionat #${active.id}`}${active.year ? ` · ${active.year}` : ""}` : "Cap";
    return { total, activeLabel };
  }, [items]);

  const ensureSingleActive = useCallback(async () => {
    // Desactiva qualsevol campionat actiu abans d'activar-ne un altre.
    const { error } = await supabase.from("championship").update({ is_active: false }).eq("is_active", true);

    if (error) {
      Alert.alert("Error", error.message);
      return false;
    }
    return true;
  }, []);

  const validate = useCallback(() => {
    const cleanName = name.trim();
    if (!cleanName) return "Falta el nom del campionat.";

    if (year.trim()) {
      const y = Number(year.trim());
      if (!Number.isInteger(y) || y < 1900 || y > 2100) return "L'any no és vàlid (ex: 2026).";
    }
    return null;
  }, [name, year]);

  const save = useCallback(async () => {
    const errMsg = validate();
    if (errMsg) {
      Alert.alert("Revisa el formulari", errMsg);
      return;
    }

    const cleanName = name.trim();
    const cleanLocation = location.trim();
    const y = year.trim() ? Number(year.trim()) : null;

    setSaving(true);

    try {
      if (isActive) {
        const ok = await ensureSingleActive();
        if (!ok) {
          setSaving(false);
          return;
        }
      }

      if (editing) {
        const { error } = await supabase
          .from("championship")
          .update({
            year: y,
            name: cleanName,
            location: cleanLocation || null,
            is_active: isActive,
          })
          .eq("id", editing.id);

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
      } else {
        const { error } = await supabase.from("championship").insert({
          year: y,
          name: cleanName,
          location: cleanLocation || null,
          is_active: isActive,
        });

        if (error) {
          Alert.alert("Error", error.message);
          return;
        }
      }

      setModalOpen(false);
      resetForm();
      await load();
    } finally {
      setSaving(false);
    }
  }, [validate, name, location, year, isActive, editing, ensureSingleActive, load, resetForm]);

  const title = useMemo(() => "Campionats", []);

  if (checking) {
    return (
      <View style={{ flex: 1, justifyContent: "center", padding: 16 }}>
        <ActivityIndicator size="large" />
        <Text style={{ textAlign: "center", marginTop: 12, color: "#666" }}>Validant accés…</Text>
      </View>
    );
  }

  if (!allowed) return null;

  return (
    <View style={{ flex: 1, padding: 16 }}>
      {/* Hero / summary */}
      <View
        style={{
          padding: 16,
          borderRadius: 18,
          borderWidth: 1,
          borderColor: "#eee",
          backgroundColor: "#fafafa",
          marginBottom: 14,
        }}
      >
<BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />

        <Text style={{ fontWeight: "900", fontSize: 18 }}>Gestió de campionats</Text>
        <Text style={{ marginTop: 6, color: "#666", fontWeight: "600" }}>
          Crea i edita campionats. No es poden eliminar perquè queden d&apos;històric.
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <View
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#eee",
              backgroundColor: "white",
            }}
          >
            <Text style={{ fontWeight: "900" }}>Actiu</Text>
            <Text style={{ marginTop: 6, color: "#555", fontWeight: "700" }}>{stats.activeLabel}</Text>
          </View>

          <View
            style={{
              width: 110,
              padding: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#eee",
              backgroundColor: "white",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontWeight: "900" }}>Totals</Text>
            <Text style={{ marginTop: 6, fontSize: 20, fontWeight: "900" }}>{stats.total}</Text>
          </View>
        </View>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Pressable
            onPress={openCreate}
            style={{
              flex: 1,
              paddingVertical: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#d7f2df",
              backgroundColor: "#e6f7ed",
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "900" }}>＋ Nou campionat</Text>
          </Pressable>

          <Pressable
            onPress={load}
            style={{
              width: 120,
              paddingVertical: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: "#ddd",
              backgroundColor: "white",
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "900" }}>↻ Refrescar</Text>
          </Pressable>
        </View>
      </View>

      {/* List */}
      {loading ? (
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator size="large" />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => String(it.id)}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={() => (
            <View style={{ alignItems: "center", marginTop: 50 }}>
              <Text style={{ color: "#666", fontWeight: "800" }}>Encara no hi ha cap campionat.</Text>
              <Text style={{ color: "#888", marginTop: 6 }}>Crea&apos;n un amb “Nou campionat”.</Text>
            </View>
          )}
          renderItem={({ item }) => {
            const active = !!item.is_active;
            const subtitleParts: string[] = [];
            if (item.year) subtitleParts.push(String(item.year));
            if (item.location) subtitleParts.push(item.location);
            const subtitle = subtitleParts.join(" · ");

            return (
              <Pressable
                onPress={() => openEdit(item)}
                style={{
                  padding: 14,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#e6e6e6",
                  backgroundColor: "white",
                  marginBottom: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ fontWeight: "900", fontSize: 16 }} numberOfLines={2}>
                      {item.name || `Campionat #${item.id}`}
                    </Text>

                    {subtitle ? (
                      <Text style={{ marginTop: 6, color: "#666", fontWeight: "700" }} numberOfLines={2}>
                        {subtitle}
                      </Text>
                    ) : null}

                    <Text style={{ marginTop: 6, color: "#888", fontWeight: "600" }}>
                      Creat: {formatDateTime(item.created_at) || "—"}
                    </Text>
                  </View>

                  {active ? (
                    <View
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "#d7f2df",
                        backgroundColor: "#e6f7ed",
                      }}
                    >
                      <Text style={{ fontWeight: "900" }}>ACTIU</Text>
                    </View>
                  ) : (
                    <View
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: "#eee",
                        backgroundColor: "#fafafa",
                      }}
                    >
                      <Text style={{ fontWeight: "800", color: "#666" }}>històric</Text>
                    </View>
                  )}
                </View>

                <Text style={{ marginTop: 10, color: "#777", fontWeight: "700" }}>Toca per editar</Text>
              </Pressable>
            );
          }}
        />
      )}

      {/* Modal Create/Edit */}
      <Modal
        transparent
        visible={modalOpen}
        animationType={Platform.OS === "ios" ? "slide" : "fade"}
        onRequestClose={() => setModalOpen(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.45)",
            justifyContent: "center",
            padding: 16,
          }}
        >
          <View
            style={{
              backgroundColor: "white",
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: "#eee",
            }}
          >
            <Text style={{ fontWeight: "900", fontSize: 18 }}>
              {editing ? "Editar campionat" : "Nou campionat"}
            </Text>

            {/* Year */}
            <Text style={{ marginTop: 12, color: "#666", fontWeight: "800" }}>Any</Text>
            <TextInput
              value={year}
              onChangeText={(v) => setYear(v.replace(/[^0-9]/g, "").slice(0, 4))}
              placeholder="Ex: 2026"
              keyboardType="number-pad"
              style={{
                marginTop: 8,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#ddd",
              }}
            />

            {/* Name */}
            <Text style={{ marginTop: 12, color: "#666", fontWeight: "800" }}>Nom</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Ex: Lliga Belit"
              autoCapitalize="words"
              style={{
                marginTop: 8,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#ddd",
              }}
            />

            {/* Location */}
            <Text style={{ marginTop: 12, color: "#666", fontWeight: "800" }}>Localització</Text>
            <TextInput
              value={location}
              onChangeText={setLocation}
              placeholder="Ex: Girona"
              autoCapitalize="words"
              style={{
                marginTop: 8,
                paddingVertical: 10,
                paddingHorizontal: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#ddd",
              }}
            />

            {/* Active */}
            <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontWeight: "900" }}>Campionat actiu</Text>
                <Text style={{ marginTop: 4, color: "#666", fontWeight: "600" }}>
                  Si l&apos;actives, desactivarem automàticament l&apos;anterior.
                </Text>
              </View>
              <Switch value={isActive} onValueChange={setIsActive} />
            </View>

            <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
              <Pressable
                onPress={() => {
                  setModalOpen(false);
                  resetForm();
                }}
                disabled={saving}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#ddd",
                  backgroundColor: "white",
                  opacity: saving ? 0.6 : 1,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900" }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={save}
                disabled={saving}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: "#d7f2df",
                  backgroundColor: "#e6f7ed",
                  opacity: saving ? 0.6 : 1,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900" }}>{saving ? "Desant…" : "Desar"}</Text>
              </Pressable>
            </View>

            <Text style={{ marginTop: 10, color: "#888", fontWeight: "600" }}>
              No hi ha opció d&apos;eliminar.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
