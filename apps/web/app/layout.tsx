import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Darvin — scan any website for security and SEO problems',
    template: '%s · Darvin',
  },
  description:
    'Paste a URL and get a report on the security headers, TLS, cookies, email authentication and ' +
    'on-page SEO of any public website. No signup.',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  )
}
