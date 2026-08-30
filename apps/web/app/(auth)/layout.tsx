import { SupabaseAuthProvider } from '@/components/auth/supabase-provider.tsx'

/**
 * The Supabase Auth client context, mounted here rather than at the root.
 *
 * The session cookie is read server-side by the proxy and by `currentIdentity()`
 * in `lib/auth/supabase.ts`; this provider's job is to expose the Supabase
 * client to client components (`useSupabaseClient`, `useSession`). Mounted
 * under (auth) because these are the pages where signing in actually happens,
 * keeping the marketing landing page and the pricing page free of an auth
 * client they do not need.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <SupabaseAuthProvider>{children}</SupabaseAuthProvider>
}
