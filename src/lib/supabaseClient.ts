// ---------------------------------------------------------------------------
// Supabase BROWSER client (Client Components). No next/headers import here, so
// this module is safe to bundle for the browser. Server client lives in
// supabaseServer.ts. Anon/publishable key is safe in the frontend; RLS protects.
// ---------------------------------------------------------------------------
import { createBrowserClient } from "@supabase/ssr";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function createSupabaseBrowserClient() {
  return createBrowserClient(URL, KEY);
}
