import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Ensure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY are set in your .env file.'
  );
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

/**
 * Call once from the root layout useEffect.
 * Cleans up a corrupt session so the user is not silently stuck in a bad state.
 */
export async function initSupabaseSession(): Promise<void> {
  try {
    const { error } = await supabase.auth.getSession();
    if (error) {
      console.warn('Sessió corrupta detectada → netejant');
      await supabase.auth.signOut();
    }
  } catch (e) {
    console.warn('Error comprovant sessió inicial:', e);
  }
}