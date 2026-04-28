import { createBrowserClient } from '@supabase/ssr'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** Supabase 是否已配置（env 变量非空） */
export const isSupabaseConfigured = !!(url && key)

export function createClient() {
  if (!isSupabaseConfigured) {
    // 返回一个 dummy 对象，避免在 Supabase 未配置时崩溃
    return {
      auth: {
        getUser: async () => ({ data: { user: null }, error: null }),
        signInWithPassword: async () => ({ data: null, error: { message: 'Supabase 尚未配置' } }),
        signInWithOAuth: async () => ({ data: null, error: { message: 'Supabase 尚未配置' } }),
        signUp: async () => ({ data: null, error: { message: 'Supabase 尚未配置' } }),
        signOut: async () => ({ error: null }),
        updateUser: async () => ({ data: null, error: null }),
        resetPasswordForEmail: async () => ({ data: null, error: null }),
        onAuthStateChange: (_event: string, _callback: unknown) => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }) }) }),
        update: () => ({ eq: async () => ({ data: null, error: null }) }),
        upsert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }) }),
      }),
    } as any
  }
  return createBrowserClient(url!, key!)
}
