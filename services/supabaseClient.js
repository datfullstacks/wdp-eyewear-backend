const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseBucket = process.env.SUPABASE_STORAGE_BUCKET || 'wdp-products';

if (!supabaseUrl) {
  console.warn('⚠️  SUPABASE_URL is missing.');
}

// Admin client – dùng cho storage, bypass RLS
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Auth client – dùng anon key cho getUser() verify OAuth access_token
const supabaseAuth = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

module.exports = {
  supabase,
  supabaseAuth,
  supabaseBucket
};
