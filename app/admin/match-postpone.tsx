import { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { supabase } from "../../src/supabase";
import { BackButton } from "../../components/HeaderButtons";
import { Keyboard } from "react-native";
import { useAppTheme } from "../../src/theme";

type MatchRow = {
  id: number;
  match_date: string | null;
  display_status: string | null;
  started_at:string |null;
  is_finished: boolean;
  team_a_id: number | null;
  team_b_id: number | null;
  team_a?: { name: string } | null;
  team_b?: { name: string } | null;
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateDDMMYYYY_HHMM(iso?: string | null) {
  if (!iso) return "Data pendent";
  const d = new Date(iso);
  const day = pad2(d.getDate());
  const month = pad2(d.getMonth() + 1);
  const year = d.getFullYear();
  const hour = pad2(d.getHours());
  const min = pad2(d.getMinutes());
  return `${day}/${month}/${year} · ${hour}:${min}`;
}

export default function MatchPostponeScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();

  const [matchIdInput, setMatchIdInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [matchRow, setMatchRow] = useState<MatchRow | null>(null);
  const [reason, setReason] = useState("");

  async function loadMatch() {
    Keyboard.dismiss();

    const matchId = Number(matchIdInput.trim());
    if (!Number.isFinite(matchId) || matchId <= 0) {
      Alert.alert("ID invàlid", "Introdueix un match_id vàlid.");
      return;
    }

    try {
      setLoading(true);

      const { data, error } = await supabase
        .from("match")
        .select(`
          id,
          match_date,
          display_status,
          started_at,
          is_finished,
          team_a_id,
          team_b_id,
          team_a:team_a_id(name),
          team_b:team_b_id(name)
        `)
        .eq("id", matchId)
        .single();

      if (error) throw error;

      const raw = data as any;
      const row: MatchRow = {
        id: raw.id,
        match_date: raw.match_date ?? null,
        display_status: raw.display_status ?? null,
        started_at: raw.started_at ?? null,
        is_finished: !!raw.is_finished,
        team_a_id: raw.team_a_id ?? null,
        team_b_id: raw.team_b_id ?? null,
        team_a: Array.isArray(raw.team_a) ? raw.team_a[0] ?? null : raw.team_a ?? null,
        team_b: Array.isArray(raw.team_b) ? raw.team_b[0] ?? null : raw.team_b ?? null,
      };

      setMatchRow(row);
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "No s'ha pogut carregar el partit.");
    } finally {
      setLoading(false);
    }
  }

  async function updateDisplayStatus(nextStatus: "AJORNAT" | null) {
    if (!matchRow) return;
    
    if (nextStatus === "AJORNAT" && (matchRow.is_finished || !!matchRow.started_at)) {
    Alert.alert(
      "No permès",
      "Només es pot ajornar un partit que encara no ha començat."
    );
    return;
  }

    const actionLabel = nextStatus === "AJORNAT" ? "ajornar" : "treure l'ajornament";

    Alert.alert(
      "Confirmació final",
      `Segur que vols ${actionLabel} el partit ${matchRow.id}?`,
      [
        { text: "Cancel·lar", style: "cancel" },
        {
          text: "Confirmar",
          onPress: async () => {
            try {
              setSaving(true);

              const { error } = await supabase.rpc("admin_set_match_display_status", {
                p_match_id: matchRow.id,
                p_display_status: nextStatus,
              });

              if (error) throw error;

              Alert.alert(
                "Fet ✅",
                nextStatus === "AJORNAT"
                  ? "Partit marcat com ajornat."
                  : "Ajornament tret correctament."
              );

              await loadMatch();
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "No s'ha pogut actualitzar l'estat del partit.");
            } finally {
              setSaving(false);
            }
          },
        },
      ]
    );
  }
const cannotPostpone = !!matchRow && (matchRow.is_finished || !!matchRow.started_at);

  return (
    <View style={{ flex: 1, padding: 16, backgroundColor: colors.bg }}>
      <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 16 }}>
        <BackButton onPress={() => router.back()} />
      </View>

      <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 6, color: colors.text }}>
        🌧️ Ajornar partit
      </Text>
      <Text style={{ color: colors.muted, fontWeight: "700", marginBottom: 16 }}>
        Busca un partit per ID i marca'l com ajornat o treu l'ajornament.
      </Text>

      <View
        style={{
          backgroundColor: colors.card,
          borderRadius: 14,
          padding: 14,
          borderWidth: 1,
          borderColor: colors.border,
          marginBottom: 14,
        }}
      >
        <Text style={{ fontWeight: "800", marginBottom: 8, color: colors.text }}>ID del partit</Text>
        <TextInput
          value={matchIdInput}
          onChangeText={setMatchIdInput}
          keyboardType="number-pad"
          placeholder="Ex: 123"
          style={{
            borderWidth: 1,
            borderColor: colors.border,
            borderRadius: 12,
            paddingHorizontal: 12,
            paddingVertical: 10,
            marginBottom: 12,
            color: colors.text,
          }}
        />

        <Pressable
          onPress={loadMatch}
          disabled={loading}
          style={{
            paddingVertical: 12,
            borderRadius: 12,
            backgroundColor: colors.primary,
            alignItems: "center",
            opacity: loading ? 0.45 : 1,
          }}
        >
          {loading ? (
            <ActivityIndicator color={colors.primaryText} />
          ) : (
            <Text style={{ color: colors.primaryText, fontWeight: "900" }}>Carregar partit</Text>
          )}
        </Pressable>
      </View>

      {matchRow ? (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 14,
            padding: 14,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ fontWeight: "900", fontSize: 16, color: colors.text }}>
            {matchRow.team_a?.name ?? `Equip ${matchRow.team_a_id}`} vs {matchRow.team_b?.name ?? `Equip ${matchRow.team_b_id}`}
          </Text>

          <Text style={{ marginTop: 8, color: colors.muted, fontWeight: "700" }}>
            Data: {formatDateDDMMYYYY_HHMM(matchRow.match_date)}
          </Text>

          <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "700" }}>
            Estat actual: {matchRow.display_status ?? "NORMAL"}
          </Text>

          <Text style={{ marginTop: 4, color: colors.muted, fontWeight: "700" }}>
            Partit finalitzat: {matchRow.is_finished ? "Sí" : "No"}
          </Text>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={() => updateDisplayStatus("AJORNAT")}
              disabled={saving || cannotPostpone}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                backgroundColor: "#DC2626",
                alignItems: "center",
                opacity: saving || cannotPostpone ? 0.45 : 1,
              }}
            >
              {saving ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={{ color: "white", fontWeight: "900" }}>Ajornar</Text>
              )}
            </Pressable>

            <Pressable
              onPress={() => updateDisplayStatus(null)}
              disabled={saving || cannotPostpone}
              style={{
                flex: 1,
                paddingVertical: 12,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
              backgroundColor: colors.card,
                alignItems: "center",
                opacity: saving || cannotPostpone ? 0.45 : 1,
              }}
            >
              <Text style={{ color: colors.text, fontWeight: "900" }}>Treure ajornament</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}
