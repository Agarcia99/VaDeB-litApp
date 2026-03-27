import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  }
);

// 🔥 Limpieza de sesión corrupta al iniciar la app
(async () => {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      console.log('⚠️ Sesión corrupta detectada → limpiando');
      await supabase.auth.signOut();
      return;
    }

    // Si no hay sesión pero hay basura en storage (caso típico en Expo)
    if (!data?.session) {
      // opcional: descomenta si quieres limpiar siempre
      // await AsyncStorage.clear();
    }
  } catch (e) {
    console.log('Error comprobando sesión inicial:', e);
  }
})();