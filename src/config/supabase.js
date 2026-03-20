const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error('Missing Supabase env vars');
    client = createClient(url, key);
  }
  return client;
}

module.exports = getSupabase();