import { ConvexAuthNextjsServerProvider } from '@convex-dev/auth/nextjs/server'
import { ConvexAuthProvider } from '@/components/auth/convex-provider.tsx'

/**
 * Both halves of Convex Auth, mounted here rather than at the root.
 *
 * The server provider calls `cookies()`, and everything under a component that
 * does is rendered dynamically — at the root that cost the landing page and the
 * pricing page their static prerender, to read a cookie neither consults. These
 * pages are the ones where signing in actually happens, so they pay for it.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ConvexAuthNextjsServerProvider>
      <ConvexAuthProvider>{children}</ConvexAuthProvider>
    </ConvexAuthNextjsServerProvider>
  )
}
