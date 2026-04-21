import { useState } from "react";
import { View, Text, TextInput, Pressable, Alert } from "react-native";
import { supabase } from "../src/supabase";
import { Stack, useRouter } from "expo-router";
import { BackButton, RefreshButton } from "../components/HeaderButtons";

export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleLogin() {
  setLoading(true);

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error) {
    setLoading(false);
    Alert.alert("Error", error.message);
    return;
  }

  const userId = data.user?.id;

  if (!userId) {
    setLoading(false);
    Alert.alert("Error", "No s'ha pogut validar l'usuari.");
    return;
  }

  // 🔍 Comprobamos si tiene árbitro y si está activo
  const { data: refereeUser, error: ruError } = await supabase
    .from("referee_user")
    .select("referee_id, is_active")
    .eq("user_id", userId)
    .maybeSingle();

  setLoading(false);

  if (ruError) {
    await supabase.auth.signOut();
    Alert.alert("Error", "No s'ha pogut comprovar l'accés.");
    return;
  }

  if (!refereeUser) {
    await supabase.auth.signOut();
    Alert.alert("Accés denegat", "Aquest usuari no està vinculat a cap àrbitre.");
    return;
  }

  if (!refereeUser.is_active) {
    await supabase.auth.signOut();
    Alert.alert("Usuari desactivat", "Aquest usuari està desactivat.");
    return;
  }

  // ✅ TODO OK → entra
  router.replace("/matches");
}

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ headerTitle: "" }} />

      {/* Botó just sota el header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
        <BackButton
          onPress={() => router.replace("/public-menu")}
          style={{ marginTop:5 }}
        />
      </View>

      {/* Login com abans */}
      <View style={{ flex: 1, padding: 24 }}>
        <Text style={{ fontSize: 28, fontWeight: "bold", marginBottom: 24, textAlign: "center" }}>
          Àrbitres
        </Text>

        <Text>Email</Text>
        <TextInput
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          style={{
            borderWidth: 1,
            borderColor: "#ccc",
            borderRadius: 8,
            padding: 12,
            marginBottom: 12,
          }}
        />

        <Text>Password</Text>
        <TextInput
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={{
            borderWidth: 1,
            borderColor: "#ccc",
            borderRadius: 8,
            padding: 12,
            marginBottom: 20,
          }}
        />

        <Pressable
          onPress={handleLogin}
          style={{
            backgroundColor: "#111",
            padding: 14,
            borderRadius: 8,
            alignItems: "center",
          }}
        >
          <Text style={{ color: "white", fontWeight: "bold" }}>
            {loading ? "Entrant..." : "Entrar"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
