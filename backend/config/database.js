const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

// Validate required environment variables
if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  throw new Error(
    'Missing required Supabase environment variables: VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY'
  );
}

// Supabase admin client (uses service role key - can bypass RLS)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

// Supabase client (uses anon key - respects RLS)
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

module.exports = {
  supabaseAdmin,
  supabaseClient,
  supabaseUrl,
};
