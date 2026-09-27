---
name: 2049-ui
description: Product-specific identity and visual design rules for the 2049 native macOS app. Use when shaping or reviewing its Agent Card, window, information architecture, multi-Agent experience, visual language, or product-level UI decisions. Use 2049-motion for interaction motion and the relevant SwiftUI skills for implementation techniques.
---

# 2049 UI

2049 is an economic control layer for AI agents.

> Give your agent a card, not your wallet.

This skill defines what the 2049 product should be. Keep it specific to 2049; do not generalize it into unrelated projects. For interaction motion, use `$2049-motion`. For general SwiftUI architecture and API guidance, use `$swiftui-pro` and `$swiftui-ui-patterns`; use `$swiftui-liquid-glass` for Liquid Glass implementation details.

## Product model

The product revolves around one object: the **Agent Card**. The current Agent Card is always the primary visual object. An account can contain multiple Agents, each with its own identity and control state.

Product concepts appear in the UI as follows:

- Agent / CardMember: identity
- SpendGrant: delegated authority
- Shared Budget / Daily Authority: global daily control
- Per-transaction limit: local transaction constraint
- Purchase: one intent, policy decision, and payment result
- Payments: pause/resume control
- Execution mode: `live_devnet` or `simulated`
- Activity: purchase and event history
- Connection: MCP, Agent, and wallet-boundary information

## Product principles

### One Agent Card, not a dashboard

At rest, the app should reduce visually to one Agent Card. Do not turn it into a SaaS or crypto dashboard, banking admin panel, sidebar control center, metric-card grid, or generic settings app. Do not add persistent navigation chrome unless the product direction changes.

### Front means identity; back means control

The front establishes the Agent's identity and presence. Keep it quiet: `2049`, the current Agent name, a small secondary identifier, and one subtle control affordance are enough. Keep authority, limits, activity, charts, badges, and action rows off the front by default. Negative space is intentional.

The back is the compact control surface, like a native macOS inspector integrated into the same card. It is not a separate page behind the card. Keep its top area quiet; the selected Agent is already contextual.

### Card and window model

The primary experience should feel like an Agent Card on the desktop, not an ordinary app window containing a card. Prefer a frameless or visually frameless floating card window, with no generic title bar or large opaque app background. Keep window bounds close to visible interactive content and avoid oversized invisible hit regions. At rest, the card faces forward and has no permanent cinematic angle or continuous tilt.

### Apple-native presentation

Use a visual language at home in macOS: Apple System Settings, Apple Music, Apple Wallet, and Apple Card. Prefer familiar native presentation and controls at the product level. Do not imitate Android Material Design or turn the card into a crypto landing page.

### Material intent

The card should feel like **warm precision material with restrained Liquid Glass**: premium and lightly physical, while remaining readable over any desktop wallpaper. The surface reads primarily as warm white or a light neutral, with only subtle environmental color influence; background content must not be readable through it.

Use material to support surface hierarchy and depth, not as decoration everywhere. Keep the card visually thin, with almost invisible depth at rest. Avoid generic glassmorphism, obvious wallpaper bleed, large bloom halos, neon outlines, rainbow holographic surfaces, constant iridescence, and thick hardware-like depth. Delegate API choice, availability handling, and material implementation to `$swiftui-liquid-glass`.

## Visual system

### Color

- Primary surface: warm white or light neutral, with a slight environmental tint.
- Primary text: semantic near-black or graphite.
- Secondary and tertiary information: native label hierarchy.
- Accent: muted warm orange, used functionally for progress, selected/focused state, an enabled Payments state, brief feedback, or small state confirmation.

Do not outline the whole card in orange, use neon orange, color every icon orange, or apply large orange fills without a functional reason. Critical state must remain explicit in text or control state; material alone must not communicate it.

### Typography

Use the system typeface and native Apple text hierarchy. Build hierarchy with weight, size, semantic foreground style, and spacing. Avoid futuristic display fonts for ordinary controls and excessive tracking. Restrained letter spacing is appropriate only for small technical labels when it improves hierarchy.

## Information architecture

### Front

Keep the front sparse. A preferred arrangement is `2049` near the upper-left, one subtle flip/control affordance near the upper-right, and the Agent name with a small identifier near the lower-left. Do not add controls merely to fill space.

### Back overview

Do not repeat a large Agent name/ID header on the back. Prefer a back/flip affordance on the left and a compact `Agents` selector on the right. Group information with Apple-like spacing, without nested “card inside card” surfaces or an icon on every row.

Organize the overview into:

- **AUTHORITY**: Daily authority (value and thin progress), Spend grant (value and disclosure), Per transaction (value and disclosure)
- **CONTROLS**: Payments, Execution mode (current value and disclosure)
- **MORE**: Activity and Connection (disclosures)

### Focused detail

The back overview drills into a focused control or information view inside the same card. Keep a clear route back to the overview and retain the relationship to the selected row.

- **Daily Authority**: remaining amount, daily limit, an appropriate value editor, and optional budget alerts.
- **Spend Grant**: remaining amount, grant limit, editable amount, and revoke action. Use clear destructive treatment and confirmation when appropriate.
- **Per Transaction**: current limit, suitable amount control, and brief explanatory text when needed.
- **Execution Mode**: Live (Devnet) or Simulated, with a compact native selection presentation.
- **Activity**: chronological purchase/event list, not a dashboard table. Prioritize resource or purchase name, amount, approval/denial/unknown state, and time. A selected row has a Purchase detail view within the card.
- **Connection**: relevant MCP status, Agent/CardMember identity, wallet/signing boundary, and connection state. Never expose private keys.

### Multi-Agent experience

Each Agent owns its identity, Daily Authority, SpendGrant, transaction limit, payment state, execution mode, Activity, and Connection state. Never hard-code the experience around NIRI; it is a mock/default Agent, not the product architecture.

Use a compact native macOS account selector, not a project dashboard or grid of cards. Example mock entries may include NIRI — Active, Research — Simulated, and Buyer — Paused. Selecting an Agent updates the Agent Card in place and preserves the card shell/window. The interaction's motion behavior belongs in `$2049-motion`.

### Product-level control preference

Prefer familiar system controls over custom-drawn replacements. Payments should read as a native macOS switch, amount adjustment should use a familiar system control, and compact choices should use native-feeling menus, pickers, or popovers. Custom controls need a concrete product reason and must remain recognizably at home on macOS. Generic API and component implementation guidance belongs in the SwiftUI skills.

## Status expression

Text and control state carry status; material can reinforce it subtly.

- **ACTIVE**: normal material and restrained active accent.
- **PAYMENTS PAUSED**: quieter emphasis and switch off.
- **GRANT REVOKED**: reduced emphasis and explicit text where relevant.
- **PAYMENT_UNKNOWN**: restrained amber/orange pending state.
- **LIVE_DEVNET**: small secondary label where useful.
- **SIMULATED**: quieter secondary state.

Do not use loud red card surfaces or shaking to express a denied purchase.

## Design failure modes

Reject or revise designs that introduce:

- dashboard layouts, persistent sidebars, tab-bar app shells, or crypto-dashboard styling
- Android/Material controls or generic web glassmorphism
- highly transparent surfaces or visible wallpaper content through the card
- thick 3D hardware appearance or permanent perspective tilt
- neon/cyberpunk styling or blue-purple crypto gradients
- icons on every settings row, oversized back-side hero numbers, or excessive badges
- custom controls that are less familiar than native controls without a concrete reason
- a separate modal/window for every row or an Agent selector presented as a dashboard/grid

Motion-specific failure modes are defined in `$2049-motion`.

## Visual QA principles

Review product intent against these questions:

- Is one Agent Card still the primary object, rather than an app shell or dashboard?
- Is the front quieter than the back, with identity on the front and controls on the back?
- Does the back feel native to macOS?
- Is the material restrained and the text stable over different wallpaper?
- Is orange functional rather than decorative?
- Can the user understand status without relying on material alone?
- Does switching Agents preserve the card/window model?
- Does any detail, modal, or navigation choice weaken the focused-card information architecture?

## Verification policy

For implementation work, use available CLI build, typecheck, and test commands as appropriate. Do not automatically launch the app or visually inspect it after every change. **Computer Use is not a default verification step**: use it only if the user explicitly requests it or a GUI-only issue cannot reasonably be diagnosed otherwise. Final UI and visual acceptance is performed manually by the user. Do not treat a build result as visual acceptance.
