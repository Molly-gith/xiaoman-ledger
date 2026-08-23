import { createClient } from "@supabase/supabase-js";

// The publishable key is intentionally safe for browser use. Data access is
// enforced in PostgreSQL by Row Level Security, never by hiding this value.
export const supabase = createClient(
  "https://ossuymtantsctyhtwnyw.supabase.co",
  "sb_publishable_S40OIuoA7SiL8Tnpu57vzg_GTX6bp8-",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
);

