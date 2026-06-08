import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(SUPABASE_URL, ANON_KEY)

// Always uses anon key — for public pages that must not inherit the logged-in user's JWT
export const publicSupabase = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${ANON_KEY}` } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
