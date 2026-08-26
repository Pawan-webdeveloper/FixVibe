import { SiteHeader } from '@/components/marketing/site-header.tsx'

/**
 * Marketing pages that need the standard site header.
 *
 * The landing page sits outside this group on purpose: its hero is a
 * page-sized terminal window with its own navigation inside the frame, and a
 * second header stacked above it would be two navigations on one screen.
 * Everything else — pricing, and whatever follows it — gets the shared one.
 */
export default function ChromeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      {children}
    </>
  )
}
