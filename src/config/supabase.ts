import { createClient } from '@supabase/supabase-js';
import { config } from './env.js';

// This client only validates customer access tokens with Supabase Auth.
// It uses the publishable key and never exposes a service-role credential.
export const supabaseAuth = createClient(config.supabaseUrl, config.supabasePublishableKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
