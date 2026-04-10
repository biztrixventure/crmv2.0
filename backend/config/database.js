import { createClient } from "@supabase/supabase-js";

// Supabase client with service role key for admin operations
const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || "https://tdqljwenzuptupjihsvg.supabase.co",
  process.env.SUPABASE_SERVICE_ROLE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkcWxqd2VuenVwdHVwamloc3ZnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg2MjY1NSwiZXhwIjoyMDkxNDM4NjU1fQ.98i0APW9m8nJyEGezStXKeOaOTepotbgrvE3jbiTYso"
);

// Supabase client with anon key for client-side operations
const supabaseAnon = createClient(
  process.env.VITE_SUPABASE_URL || "https://tdqljwenzuptupjihsvg.supabase.co",
  process.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRkcWxqd2VuenVwdHVwamloc3ZnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NjI2NTUsImV4cCI6MjA5MTQzODY1NX0.a9HjMeLTD3musGmzND0sq715JMadU_6hk6W0g9CL4O4"
);

export { supabaseAdmin, supabaseAnon };
