# Status page

## What it is

`/status/[slug]` is the cheapest acquisition surface in the product — a
link a team posts during an incident, in front of their users, under our
name. It is fully public (no auth, no signup wall) and is meant to be
read on a phone at 3am.

The page renders one row per enabled monitor for the project
("components"), plus an aggregated header. See the
[monitoring audit](./monitoring-audit.md) for the broader context.

## Polish settings (Phase 6.4)

The owner of a project can configure three things from
`/projects/<id>/settings → Status page`:

| Setting          | Type                                       | Default  |
| ---------------- | ------------------------------------------ | -------- |
| `logoUrl`        | `https://` URL or `data:image/...;base64,` | `null`   |
| `brandColor`     | `#RRGGBB` hex                              | `null`   |
| `robotsIndexable`| boolean                                    | `true`   |

All three are nullable / default-off, so projects created before Phase
6.4 behave exactly as they did until the owner opts in.

### Branding

- **`logoUrl`** — rendered next to the project name on the public page
  as a 32×32 object. `https://` only (no mixed content) or a base64
  `data:` URL for small SVG logos.
- **`brandColor`** — tinted as the status dot and a subtle border on the
  status banner (20% alpha). Defaults to emerald/red/gray when unset.

The brand colour never overrides the red "down" state — a brand colour
turns the dot into the brand hue only when the system is operational,
because red is the colour a customer is reading for at 3am.

### Search-engine indexing

`/status/<slug>` is **indexable by default**. A status page is meant
to be discoverable from links customers share in tweets, GitHub
issues, support threads, etc. Blocking it would shrink the free SEO
value the product captures from somebody else's incident.

Owners who want the page kept out of search results (private
dashboards, internal status pages they accidentally exposed) can flip
the switch off, and the page emits:

```html
<meta name="robots" content="noindex, nofollow">
```

The page is still readable — `noindex` does not protect anything; the
URL is the protection. It only stops a crawler from listing the page
in results.

`apps/web/app/robots.ts` permits `/status/<slug>` globally for
crawlers that respect robots.txt (the `<meta>` tag is for those that
don't). The owner's opt-out is honoured by the meta tag, not by
robots.txt — robots.txt is a per-deployment policy and would have to
be per-project to honour it, which it isn't today.

## Last updated + manual refresh

The page renders "Last updated X ago" with a small `↻ Refresh` button.
The button calls Next's `router.refresh()`, which re-fetches the
server-component tree without a hard navigation — the in-flight state
(open subscribe form, scroll position) survives.

The page is wrapped in `revalidate = 60` so a fresh fetch is
guaranteed at most once a minute anyway; the button is a "skip the
cache" knob for someone who is staring at the page during an active
incident.

## Maintenance banner

The page renders two kinds of maintenance banner:

1. **Per-component** — inside each `<ComponentCard>` when that one
   monitor's `getActiveMaintenanceWindow()` matches the current
   instant. One row per component; the visitor sees "this specific
   monitor is in maintenance".
2. **Project-wide** — at the top of the page, aggregating every
   active window across all components. The visitor sees "this
   project is in maintenance" once, with the union of reasons.

Per-component came from Phase 6.1; the project-wide aggregate was
added in Phase 6.4 so a customer who only cares about "is it down?"
sees one banner, not three.

## Subscribe form (Phase 6.3)

The page also carries a double-opt-in email subscribe form. See the
`statusSubscribers` table + `apps/web/lib/status-subscriber-email.ts`
for the full flow. The unsubscribe link in every notification uses
the same token as the confirm link — one secret covers both
actions, so a leak cannot be split.

## Schema (Phase 6.4)

Three columns added to `projects` in migration `0010_plain_the_leader.sql`:

- `logo_url text` — nullable
- `brand_color text` — nullable
- `robots_indexable boolean NOT NULL DEFAULT true`
