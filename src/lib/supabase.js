import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://ikjgtsvauctfmxpqwmyd.supabase.co'
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlramd0c3ZhdWN0Zm14cHF3bXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MzI5NTEsImV4cCI6MjA5NDMwODk1MX0.Bkzz7c1125OUf2B7MXTqtKnls52mGCwE64LiBjyR5Do'

export const supabase = createClient(SUPABASE_URL, ANON_KEY)

// Always uses anon key — for public pages that must not inherit the logged-in user's JWT
export const publicSupabase = createClient(SUPABASE_URL, ANON_KEY, {
  global: { headers: { Authorization: `Bearer ${ANON_KEY}` } },
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
})
