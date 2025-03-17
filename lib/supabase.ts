import { createClient } from "@supabase/supabase-js"

/**
 * Supabase Client
 *
 * This file initializes and exports a Supabase client instance.
 * The client is created using environment variables for the Supabase URL and anonymous key.
 *
 * Environment Variables:
 * - NEXT_PUBLIC_SUPABASE_URL: The URL of your Supabase project
 * - NEXT_PUBLIC_SUPABASE_ANON_KEY: The anonymous key for your Supabase project
 *
 * Usage:
 * Import this client in other files to interact with your Supabase database:
 * import { supabase } from '@/lib/supabase'
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL as string
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

