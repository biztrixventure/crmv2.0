const { createClient } = require('@supabase/supabase-js');
const { contextFetch } = require('../utils/requestContext');

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
// contextFetch stamps the signed-in user (and an optional reason) onto every
// PostgREST call made while serving a request, so the mig 313 change-record
// trigger knows who made each write -- deletes included. Outside a request it
// is a plain fetch. See utils/requestContext.js.
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  global: { fetch: contextFetch },
});

// Supabase client (uses anon key - respects RLS)
const supabaseClient = createClient(supabaseUrl, supabaseAnonKey);

module.exports = {
  supabaseAdmin,
  supabaseClient,
  supabaseUrl,
};
