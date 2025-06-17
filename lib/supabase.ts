import { createClient, SupabaseClient } from "@supabase/supabase-js"

/**
 * Supabase Client
 *
 * This file provides a lazy-initialized Supabase client instance.
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

let _supabase: SupabaseClient | null = null

function createSupabaseClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!supabaseUrl || !supabaseAnonKey) {
    // For build time or missing env vars, create a placeholder client
    console.warn('Supabase environment variables not found, using placeholder client')
    return createClient(
      'https://placeholder.supabase.co',
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsYWNlaG9sZGVyIiwicm9sZSI6ImFub24iLCJpYXQiOjE2NDUxOTI4MDAsImV4cCI6MTk2MDc2ODgwMH0.placeholder'
    )
  }

  return createClient(supabaseUrl, supabaseAnonKey)
}

export const supabase = new Proxy({} as SupabaseClient, {
  get(target, prop) {
    if (!_supabase) {
      _supabase = createSupabaseClient()
    }
    return _supabase[prop as keyof SupabaseClient]
  }
})

