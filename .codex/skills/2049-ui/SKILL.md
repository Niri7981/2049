---
name: 2049-ui
description: Product-specific visual language, components, material boundaries, and budget semantics for the 2049 native macOS app. Use when designing or reviewing its card/window, Authority, Connection, Activity, Agent switching, or navigation. Pair with 2049-motion for interaction mechanics.
---

# 2049 UI

2049 is an economic control layer for AI agents. Its product character is **editorial agent infrastructure × native macOS restraint**.

This skill owns visual language, hierarchy, components, product semantics, and material boundaries. [2049 Motion](../2049-motion/SKILL.md) owns timing, continuity, physical behavior, and interruption. Together they are the project-specific design guidance; the user's current request takes precedence.

Before implementation, read [plan.md](../../../plan.md) for scope and business semantics, [native App instructions](../../../apps/macos/2049/AGENTS.md), the relevant views/tests, and the [Liquid Glass design reference](../../../docs/design/apple-liquid-glass-guidelines.md) when material is involved. These baselines express the current design direction; existing code may lag them. Design guidance does not authorize additional implementation, payments, commits, or publishing.

Use `$swiftui-pro`, `$swiftui-ui-patterns`, and `$swiftui-liquid-glass` for reusable implementation techniques. Their examples do not override 2049's structure; check actual macOS API support and deployment targets.

## Product object and navigation

**The entire app is the card.** The narrow vertical macOS window itself is the product object. Keep a visually frameless, quiet shell with bounds close to visible interactive content.

- Do not insert a decorative physical credit card into the UI or stack cards inside the window.
- Details expand within the same card/window, with a clear return path and a relationship to their source.
- Agent switching happens in place. Preserve the window, shell, and spatial context; never hard-code identity around a mock Agent.
- Preserve the narrow vertical silhouette. Activity may scroll; do not widen the window to fit more records.
- Avoid fintech dashboards, generic settings-page layouts, Android/Material UI, crypto wallet clones, luxury banking styling, and concept-mockup effects.

The **top Agent selector** and **compact bottom navigation** are stable visual primitives. Preserve them unless a task explicitly asks to redesign them.

Current navigation baseline (design target): **Connection, Authority, Members, Settings**. Bottom navigation belongs inside the same card, with restrained native/Apple-like Liquid Glass behavior. Keep it compact rather than a large mobile tab bar. Preserve labels, keyboard focus, full hit regions, and space for content above it. Do not automatically copy iOS scroll-collapse behavior.

Activity has a dedicated ledger view/detail pattern; this does not add a fifth tab. Connection is a first-class tab/page, not an Activity row or part of Latest Activity.

## Product and budget semantics

**The app-level daily budget is shared across all Agents / CardMembers.** Selecting another Agent must not imply a fresh daily allowance.

| Concept | UI meaning |
| --- | --- |
| Shared daily budget / Daily Authority | Global daily control and remaining amount, shared by all Agents. |
| Agent / CardMember | Identity, member-specific connection, and purchase ownership. |
| SpendGrant | Member-specific delegated authority, scope, lifetime grant total, and per-transaction constraints. Its total does not reset with the daily budget. |
| Reserved | Funds held for a purchase or unresolved payment; not already paid. |
| Paid | Confirmed spending; does not by itself prove delivery or completion. |
| Remaining | Backend-provided available authority after applicable paid/reserved accounting; distinct from wallet balance and grant remaining. |
| Payments / Execution | Use the backend's actual scope. Current pause and execution mode are shared service controls, not independent per-Agent settings. |
| Purchase / Activity | Intent, policy decision, payment and delivery facts, associated with the owning member. |

Label shared daily authority separately from the selected Agent's grant and per-transaction limit. Avoid “Codex's daily budget” or “each Agent's daily limit”; name an explicitly scoped grant if that is what the value means.

The UI displays backend facts and submits management actions; it does not make authoritative budget or authorization decisions. Keep Reserved / Paid / Remaining distinct; unknown payments retain their reservation until the backend resolves them. Unset or unavailable authority is not zero. Payments On does not imply a valid connection, grant, or permission to buy. Keep asset/network and simulated/Devnet context clear; a currency-styled figure is not proof of production USDC support.

## Visual language

### Color

- Surfaces: cool off-white / pale blue-gray.
- Primary text: graphite / near-black; secondary text: cool gray with readable contrast.
- Dividers: subtle blue-gray hairlines.
- Primary signal: restrained soft blue for active navigation, connection state, the Authority Line, focus/selection, and brief feedback.

**Blue is a system signal, not paint.** Prefer a quieter tint over saturated system blue where contrast permits. Do not use warm beige/cream or orange as the default theme, neon, excessive gradients, large blue fills, or a colored outline around the whole window.

Semantic colors may distinguish approved/paid/complete, reserved, and denied, but stay restrained and accompany explicit labels. Approval, payment, and completion remain different facts even when they share a color family. Unknown/pending states must not look successful.

### Typography and grouping

Use an editorial typography system:

- Large financial/hero figures may use serif; the Authority hero baseline uses a large serif balance.
- Operational controls and descriptions stay clean sans-serif.
- Small uppercase labels with restrained tracking identify metadata and policy: `REMAINING TODAY`, `GRANT`, `PER TRANSACTION`, `LATEST ACTIVITY`, `CONNECTION`.
- Build hierarchy through type, whitespace, alignment, and hairline separators before adding containers.

For example, `$1.00` can establish the serif hero hierarchy above a small sans-serif `REMAINING TODAY` label. This is a typography example, not live data. Use serif selectively for hierarchy and identity, not every label. Prefer native/system typography APIs without unnecessary font dependencies; keep amounts stable and align ledger figures consistently.

**Reduce nested rounded rectangles.** Avoid settings-group boxes, large content capsules, unnecessary icon tiles, and generic dashboard widgets. Compact navigation controls may still be capsules. Relate their curves to the window edge and inset; do not give every nested shape the same radius.

## Component baselines

### Authority

Use a flat editorial surface: left-aligned hero, large serif shared remaining balance, thin blue Authority Line, Grant / Per transaction as specifications, Payments / Execution as flat ledger-style rows, and merchant-driven Latest Activity. Use minimal containers.

The **Authority Line** is a signature element: thin, restrained blue, representing remaining authority/budget state. It should read as a policy/ledger boundary rather than a conventional progress widget. Keep its meaning accessible with accompanying values/labels; it is not payment or delivery progress.

Grant editors and destructive revoke actions retain their scope and clear confirmation behavior. Latest Activity uses actual merchant/provider and resource facts when available and leads to Activity or purchase detail; do not place Connection controls inside it.

### Connection

Use the same top selector and bottom navigation, a flat body, small uppercase `CONNECTION`, a serif `Connected` / `Not Connected` headline when those facts are supported, and a minimal **Connection Bridge**:

```text
Agent node ─────────── 2049 node
```

Present quiet infrastructure metadata: Agent, Transport, Backend, Network. Use a quiet Connect / Disconnect action. Distinguish connection enablement, observed host activity, and actual connectivity; neither `enabled` nor an old `lastSeen` proves a live connection. Until real connectivity evidence is available, use truthful enablement/reconnect-required text. Missing metadata stays unavailable rather than being invented. Disconnection/revocation does not erase purchase history or reverse submitted payments; make any grant-revocation consequence clear.

Keep the bridge small and blue emphasis restrained. No giant glowing rings, spinners, oversized success checkmarks, sci-fi effects, or oversized status graphics. Transition mechanics belong in the motion skill.

### Activity

Use a flat transaction ledger for Agent purchase history. Prioritize each row's **merchant/provider → Agent + resource context → time → amount → compact status**, while keeping amounts aligned and payment/delivery states legible.

Illustrative patterns: `OpenAI — Research Agent · API credits`, `Vercel — Dev Agent · Hosting & build minutes`, `GitHub — Dev Agent · Copilot seats`. These are design examples, not supported integrations or fabricated records. Use richer real metadata instead of generic `Purchase / 0.2 USDC` when available; otherwise fall back honestly to known resource/purchase information.

Allow vertical scrolling, retain the narrow window, and open purchase detail within the card. Static rows stay flat; hover/selection uses a quiet tint or focus outline without blur or icon tiles.

## Liquid Glass boundary

**Static content stays flat. Interactive/navigation surfaces may use Liquid Glass.** Material serves interaction or hierarchy; content stays visually primary.

| Eligible, selective glass | Normally flat |
| --- | --- |
| Top Agent selector; bottom navigation; popovers/sheets; transient focus/hover on controls; selective Connection interaction | Hero balance; Grant / Per transaction; Payments and Execution content; Activity ledger rows; static policy summaries and core content surfaces |

A native switch or temporary editor inside a flat area may have its own material; that does not make the whole row or section glass. Use restrained translucency, stable contrast across wallpapers/appearances, and an opaque readable fallback for Reduce Transparency or unsupported materials. Do not reveal readable wallpaper through core content, blur financial figures, or add glow/reflections as decoration. Do not glassify the window.

## Native controls and reference use

Prefer native macOS behavior for Toggle, Menu, Picker, Popover, focus, accessibility, keyboard interaction, and system material. Native behavior does not require accepting every default visual appearance: integrate controls into 2049 through supported SwiftUI styling without rebuilding working system behavior. Explain a concrete native API gap before choosing a custom control; never trade accessibility for novelty.

Use references by responsibility:

- **Hermes:** editorial hierarchy, whitespace, calm cool palette, typographic restraint, and signal-blue philosophy; not its actual layout or branding.
- **Apple:** native control behavior, Liquid Glass hierarchy, and content-first material intent. The project's palette and component exclusions are our rules, not Apple's claims.
- **Rauno:** spatial continuity, interruption, transform origin, follow-through, and restrained physical motion; mechanics live in the motion skill.
- **Phantom:** tactile responsiveness and interaction continuity only; never copy its layout, navigation, colors, icons, or visual identity.

## Verification and current design checklist

For implementation, run relevant CLI checks under repository instructions. A build does not establish visual acceptance. Do not automatically launch the app or use Computer Use after every change; reserve it for an explicit request or a GUI-only issue. Final visual acceptance remains manual.

- Does the whole window still feel like one card/object with a narrow vertical silhouette?
- Is typography doing more work than containers? Are rounded rectangles or icon tiles unnecessary?
- Is Liquid Glass serving interaction rather than decoration, with content still primary?
- Is blue a signal rather than paint, and is text readable in all supported appearances?
- Does this feel like infrastructure software rather than a settings page or dashboard?
- Is daily authority clearly shared, with the selected member's grant distinguished?
- Are Reserved / Paid / Remaining distinct, and are payment/delivery/unknown states explicit?
- Are the top selector and bottom navigation preserved unless redesign was requested?
- Do native controls retain keyboard focus, accessibility, and platform behavior?
- Does every visual element earn its space?
