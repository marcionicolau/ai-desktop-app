# Data Model: Interface Usability Overhaul

Presentation-only feature; one persisted field.

## Settings (extended)

| Field | Type | Default | Validation |
|---|---|---|---|
| `density` | `"comfortable" \| "compact"` | absent ⇒ `"comfortable"` | any other value ⇒ `INVALID_PARAMS`; never written when unchanged |

`themeMode` is unchanged. OS preferences (reduced motion, increased contrast, forced colors) are read live from media queries and never persisted.

## Design scale (not persisted — defined in CSS tokens)

| Group | Contents |
|---|---|
| Type | families (UI, reading, mono); 6 size steps; 3 weights; line heights |
| Spacing | 4 px base, named steps; density multiplier |
| Radii / shadows | 3 radii, 2 elevations |
| Icon sizes | `sm` 14, `md` 16, `lg` 20 (named, no ad-hoc sizes) |
| Color roles | background, foreground, muted, border, ring, primary, secondary, accent, destructive, success, warning, info (+ `-foreground`) in light, dark, and high-contrast variants |

## Notice (in-memory, transient)

`{ id, kind: "success"|"error"|"info"|"warning"|"progress", title, description?, action?: {label, run}, durationMs? }` — error notices persist until dismissed; success auto-dismisses.

## ActionEntry (in-memory registry)

`{ id, label, group: "conversation"|"navigate"|"action", keywords: string[], shortcut?: string, run(): void, available(): {ok: true} | {ok: false, reason: string} }` — `reason` feeds the disabled-with-reason display (FR-019).

## Relationships

`ActionEntry.shortcut` entries are the single source for both the palette rows and the shortcuts reference list. `Notice` is produced only through `notify()`.
