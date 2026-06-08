#!/usr/bin/env node
// Runs before `npm run dev`. Warns if any public table has RLS disabled.
// Requires tables_without_rls() SQL function to be installed in Supabase.

import { readFileSync } from 'fs';
import { createClient } from '@supabase/supabase-js';

// Load .env.local manually — this script runs outside Vite
try {
  const env = readFileSync(new URL('../.env.local', import.meta.url), 'utf8');
  for (const line of env.split('\n')) {
    const [key, ...rest] = line.split('=');
    if (key && rest.length) process.env[key.trim()] = rest.join('=').trim();
  }
} catch { /* .env.local is optional */ }

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !ANON_KEY) {
  console.warn('\x1b[33m⚠  RLS check skipped: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set in .env.local\x1b[0m');
  process.exit(0);
}

const supabase = createClient(SUPABASE_URL, ANON_KEY);
const { data, error } = await supabase.rpc('tables_without_rls');

if (error) {
  console.warn('\x1b[33m⚠  RLS check skipped (run setup SQL first):\x1b[0m', error.message);
  process.exit(0);
}

if (data && data.length > 0) {
  const names = data.map(r => r.table_name).join(', ');
  console.error(`\x1b[31m\n🔴 RLS DISABLED on: ${names}`);
  console.error('Fix: ALTER TABLE <name> ENABLE ROW LEVEL SECURITY;\n\x1b[0m');
  process.exit(1);
}

console.log('\x1b[32m✅ RLS enabled on all public tables\x1b[0m');
