import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
// Use the anon key here as getUser is a client-side accessible method usually,
// but protected by the JWT itself. For service operations, use service_role key.
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabase = createClient(supabaseUrl, supabaseAnonKey);

export async function authenticateUser(eventHeaders) {
  const authHeader = eventHeaders.authorization;
  if (!authHeader) {
    return { error: 'Missing authentication token', user: null, statusCode: 401 };
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return { error: 'Malformed authentication token', user: null, statusCode: 401 };
  }

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return { error: error?.message || 'Invalid or expired token', user: null, statusCode: 401 };
  }
  return { user, error: null, statusCode: 200 };
}