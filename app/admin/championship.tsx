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
import { formatDate, formatDateTime } from "../../src/utils/format";
import { useAdminGuard } from "../../hooks/use-admin-guard";
import { useAppTheme } from "@/src/theme";

type ChampionshipRow = {
  id: number;
  year: number | null;
  name: string | null;
  location: string | null;
  created_at: string | null;
  is_active: boolean | null;
};

export default function AdminChampionship() {
  const router = useRouter();
  const { checking, isAdmin: allowed, recheck: checkAccess } = useAdminGuard();
  const { colors } = useAppTheme();
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

  useFocusEffect(
    useCallback(() => {
      checkAccess();
      load();
    }, [checkAccess, load])
  );

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
          borderColor: colors.border,
          backgroundColor: colors.bg,
          marginBottom: 14,
        }}
      >
<BackButton
          onPress={() => router.back()}
          style={{ marginBottom:15 }}
        />

        <Text style={{ fontWeight: "900", fontSize: 18, color: colors.text }}>Gestió de campionats</Text>
        <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "600" }}>
          Crea i edita campionats. No es poden eliminar perquè queden d&apos;històric.
        </Text>

        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <View
            style={{
              flex: 1,
              padding: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bg,
            }}
          >
            <Text style={{ fontWeight: "900", color: colors.text }}>Actiu</Text>
            <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "700" }}>{stats.activeLabel}</Text>
          </View>

          <View
            style={{
              width: 110,
              padding: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text style={{ fontWeight: "900", color: colors.text }}>Totals</Text>
            <Text style={{ marginTop: 6, fontSize: 20, fontWeight: "900", color: colors.text }}>{stats.total}</Text>
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
              borderColor: colors.success,
              backgroundColor: colors.successBg,
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "900" ,color:colors.text}}>＋ Nou campionat</Text>
          </Pressable>

          <Pressable
            onPress={load}
            style={{
              width: 120,
              paddingVertical: 12,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: colors.border,
              backgroundColor: colors.bg,
              alignItems: "center",
            }}
          >
            <Text style={{ fontWeight: "900", color: colors.text }}>↻ Refrescar</Text>
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
              <Text style={{ color: colors.muted, fontWeight: "800" }}>Encara no hi ha cap campionat.</Text>
              <Text style={{ color: colors.muted, marginTop: 6 }}>Crea&apos;n un amb “Nou campionat”.</Text>
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
                  borderColor: colors.border,
                  backgroundColor: colors.bg,
                  marginBottom: 12,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" }}>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Text style={{ fontWeight: "900", fontSize: 16 ,color: colors.text}} numberOfLines={2}>
                      {item.name || `Campionat #${item.id}`}
                    </Text>

                    {subtitle ? (
                      <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "700" }} numberOfLines={2}>
                        {subtitle}
                      </Text>
                    ) : null}

                    <Text style={{ marginTop: 6, color: colors.muted, fontWeight: "600" }}>
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
                        borderColor: colors.success,
                        backgroundColor: colors.successBg,
                      }}
                    >
                      <Text style={{ fontWeight: "900", color: colors.text }}>ACTIU</Text>
                    </View>
                  ) : (
                    <View
                      style={{
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: colors.border,
                        backgroundColor: colors.bg,
                      }}
                    >
                      <Text style={{ fontWeight: "800", color: colors.text }}>HISTÒRIC</Text>
                    </View>
                  )}
                </View>

                <Text style={{ marginTop: 10, color: colors.muted, fontWeight: "700" }}>Toca per editar</Text>
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
              backgroundColor: colors.bg,
              borderRadius: 18,
              padding: 16,
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Text style={{ fontWeight: "900", fontSize: 18, color: colors.text }}>
              {editing ? "Editar campionat" : "Nou campionat"}
            </Text>

            {/* Year */}
            <Text style={{ marginTop: 12, color: colors.muted, fontWeight: "800" }}>Any</Text>
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
                borderColor: colors.border,
                backgroundColor: colors.bg,
                color: colors.text,
              }}
            />

            {/* Name */}
            <Text style={{ marginTop: 12, color: colors.muted, fontWeight: "800" }}>Nom</Text>
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
                borderColor: colors.border,
                backgroundColor: colors.bg,
                color: colors.text,
              }}
            />

            {/* Location */}
            <Text style={{ marginTop: 12, color: colors.muted, fontWeight: "800" }}>Localització</Text>
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
                borderColor: colors.border,
                backgroundColor: colors.bg,
                color: colors.text,
              }}
            />

            {/* Active */}
            <View style={{ marginTop: 14, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={{ fontWeight: "900", color: colors.text }}>Campionat actiu</Text>
                <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "600" }}>
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
                  borderColor: colors.border, 
                  backgroundColor: colors.bg,
                  opacity: saving ? 0.6 : 1,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900", color: colors.text }}>Cancel·lar</Text>
              </Pressable>

              <Pressable
                onPress={save}
                disabled={saving}
                style={{
                  flex: 1,
                  paddingVertical: 12,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.success,
                  backgroundColor: colors.successBg,
                  opacity: saving ? 0.6 : 1,
                  alignItems: "center",
                }}
              >
                <Text style={{ fontWeight: "900", color: colors.text }}>{saving ? "Desant…" : "Desar"}</Text>
              </Pressable>
            </View>

            <Text style={{ marginTop: 10, color: colors.muted, fontWeight: "600" }}>
              No hi ha opció d&apos;eliminar.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}
