import { LabeledRule } from '@/components/ui/labeled-rule.tsx'
import { SettingsTabs } from './settings-tabs.tsx'

/**
 * The shell every settings screen shares.
 *
 * It exists the moment there are two of them. Billing carried its own
 * container and its own idea of the page width; a second screen copying that
 * is two files that drift, and a third is a redesign. The width, the header
 * and the tab strip are defined here and nowhere else.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl px-6 py-10">
      <LabeledRule label="Settings" />
      <SettingsTabs />
      {children}
    </div>
  )
}
