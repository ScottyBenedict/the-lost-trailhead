#!/usr/bin/env node
// Runs before `npm run dev`. Warns if any public table has RLS disabled.
// Requires tables_without_rls() SQL function to be installed in Supabase.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ikjgtsvauctfmxpqwmyd.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlramd0c3ZhdWN0Zm14cHF3bXlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MzI5NTEsImV4cCI6MjA5NDMwODk1MX0.Bkzz7c1125OUf2B7MXTqtKnls52mGCwE64LiBjyR5Do';

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
