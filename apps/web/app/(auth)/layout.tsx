/**
 * Shell for the auth route group.
 *
 * Deliberately a pass-through: the (auth) layout used to mount a Supabase
 * provider here so the (auth) pages could call `useSupabaseClient()`.
 * That provider rendered on the server with the children, but the
 * children prop is RSC-serialized, and the children that needed the
 * context (the login form) ran with the context provider's server-render
 * output in a state that React's `useContext` could not see. The form
 * threw during SSR.
 *
 * The login page now mounts its own provider as a client-only island
 * (see `app/(auth)/login/login-form-client.tsx`). If anything else ever
 * appears under (auth) and needs Supabase, it should mount its own
 * provider the same way — keeping the providers local to the leaves
 * that need them is the rule that broke.
 */

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
