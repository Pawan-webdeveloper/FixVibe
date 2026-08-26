import { SiteFooter } from '@/components/marketing/site-footer.tsx'

/**
 * Shell for the pages a logged-out visitor sees.
 *
 * Kept as a pure server component with no session read, so the landing page
 * and the pricing page stay statically rendered. SiteHeader explains why that
 * matters more here than showing a signed-in visitor their own name.
 *
 * The header itself lives one level down, in the (chrome) group: the landing
 * page's hero carries its own navigation inside its frame, and stacking the
 * shared header above it would be two navigations on one screen.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      {/* First tab stop on the page: a keyboard user should not have to walk
          the whole navigation to reach the URL field. */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-60 focus:bg-accent focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink"
      >
        Skip to content
      </a>

      <main id="main" className="flex-1">
        {children}
      </main>

      <SiteFooter />
    </div>
  )
}
