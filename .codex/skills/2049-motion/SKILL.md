---
name: 2049-motion
description: Product-specific motion rules for the 2049 native macOS app. Use when designing, implementing, or reviewing Connection Bridge, Payments, Authority Line, purchase-state feedback, Agent switching, or detail transitions. Owns timing, continuity, physics, and interruptibility; use 2049-ui for visual language and product semantics.
---

# 2049 Motion

**Motion connects input to result. Motion is never decoration.**

This guide owns transition mechanics, timing, physics, and interruptibility. [2049 UI](../2049-ui/SKILL.md) owns visual hierarchy, components, product semantics, and material boundaries. The narrow vertical window is the card; preserve it while content changes.

## Scope and references

- Follow current user direction and project rules. [plan.md](../../../plan.md) defines shared-budget/backend semantics; [Liquid Glass design notes](../../../docs/design/apple-liquid-glass-guidelines.md) defines material intent. These motion choices are 2049 rules, not Apple timings.
- Preserve native macOS interaction, focus, accessibility, and presentation. Use `$swiftui-pro`, `$swiftui-ui-patterns`, and `$swiftui-liquid-glass` for implementation; verify APIs against the actual macOS deployment target.
- Borrow continuity, interruption, transform origin, follow-through, and restrained physics from [Rauno's Craft work](https://rauno.me/craft), including [Exclusion Tabs](https://rauno.me/craft/exclusion-tabs) for shared indicators and [Wheel Input](https://rauno.me/craft/wheel-input) for inertial settling. Phantom informs tactile response and continuity only. Copy neither reference's visual identity.
- `$apple-motion-feel` and `$ui-animation` are optional references only when available and relevant, never required dependencies or authority over project rules.

## Core mechanics

1. **Acknowledge input immediately.** Pointer-down or equivalent keyboard input gets local feedback. On release, recovery and the resulting transition begin together; never finish a press animation before starting the action.
2. **Keep the object continuous.** Preserve the card shell, top Agent selector, and compact bottom navigation. Prefer a persistent indicator or anchored surface over unrelated replacements.
3. **Originate from the trigger.** A selected row/control leads into detail. Keep follow-through small and make the source/destination relationship clear.
4. **Prefer transform and opacity.** Use small translation, compression, or opacity changes without reflowing the ledger. Morph geometry only for a shared surface or expansion; keep text legible.
5. **Use springs for continuity.** Press recovery, shared indicators, or anchored expansion may settle with little or no rebound. Ordinary labels need no spring; financial values never bounce or overshoot.
6. **Interrupt and retarget.** Respond from the current presentation state; preserve continuous velocity. Back or changed selection reverses presentation immediately. This never undoes committed backend actions or bypasses restrictions on conflicting writes.
7. **Exit faster where appropriate.** Clear temporary surfaces promptly; enter slightly more slowly for readability. Respect native presentation and add no artificial delay.
8. **Choreograph by cause.** Trigger → surface → primary content → secondary content → settle is a useful ordering, not a mandate. Keep stagger small and frequent actions quiet.

## Canonical interactions

### Press, hover, and navigation

Use local tint, highlight, chevron response, or small compression. Never scale/glow the window. Keep keyboard focus clear without hover; Activity row feedback stays flat and blur-free.

Bottom navigation changes content inside the card; a shared indicator may move continuously. Do not animate the window away or replay entrances on refresh. Popovers/sheets retain native anchoring, focus, and dismissal.

### Connection Bridge

The bridge is `Agent node ─────────── 2049 node`. Use one quiet sequence per connection transition; polling or reopening does not replay a handshake:

- **Connect:** left Agent node acknowledges input → line grows toward the right → one small blue pulse crosses → right 2049 node activates → settle.
- **Disconnect:** reverse the direction and activation sequence with a shorter exit than the connecting entrance.
- Input feedback may precede a response; final node state and `Connected` require a verified connection fact. Enabled access, saved credentials, animation completion, or historical last-seen alone cannot prove current connection.
- Keep pending, failed, unknown, and confirmed results explicit. Stop/retarget when the authoritative result changes; never finish success after failure/disconnect or delay known results for choreography.
- Do not use looping pulses, spinners, giant glowing rings, oversized checkmarks, or sci-fi effects. The bridge is feedback, not a connectivity test.

### Payments

Keep the native switch response. Distinguish requested, saving, confirmed enabled/paused, and failed states; thumb motion cannot confirm pause. No bounce or polling replay. Pause blocks new payments; submitted payments may continue reconciliation or delivery recovery.

### Authority Line and budget changes

Move the thin Authority Line continuously toward a confirmed backend target. No chart-like sweep, count-up, overshoot, or flourish. Financial labels stay exact; interpolation is presentation only.

The daily budget is shared across Agents/CardMembers. Agent switching changes scoped identity/grant content, never resets/refills that budget line. Keep Reserved, Paid, and Remaining distinct; reservation is not payment success. Unknown payment reservations remain until backend facts resolve them.

### Purchase lifecycle feedback

Subtly acknowledge newly observed facts without inventing intermediate steps. Policy, reservation, payment, delivery, and grant/connection revocation are separate:

| Fact | Motion constraint |
| --- | --- |
| Approved | Acknowledge the policy result; do not imply money moved. |
| Reserved | Reinforce the budget reservation without a paid/success effect. |
| Paid | Acknowledge confirmed payment; do not imply delivery is complete. |
| Complete | Express confirmed delivery in its own context. |
| Revoked | Quietly withdraw the relevant grant/connection emphasis; do not imply a refund or reversal of a submitted payment. |
| Denied | Keep the reason readable; no shake, dramatic red surface, or punishment motion. |

These labels are not an inevitable state chain. Keep pending, unknown, failed, and simulated results truthful. Never replay success on refresh/restart/duplicate snapshots or delay showing failure.

### Agent switching

Switch in place with a quick crossfade or matched transition. Preserve the window, selector, navigation, and shared-budget context. Make new identity clear; previous Agent content must not appear current while loading. Retarget immediately on another selection.

### Activity and focused detail

Preserve record identity, source position, scroll context, and route back. Expand/transition within the card from the row/control where meaningful. Reverse on Back without arbitrary center-screen motion, large pages, or modal proliferation. Restore context without replaying the ledger entrance.

### Optional legacy card flip

A front/back flip is optional legacy behavior, not default navigation or a decorative credit card. If retained, preserve window/card size with restrained Y-axis rotation, subtle perspective, and a thin midpoint edge. Keep it interruptible; no permanent angle, idle tilt, or thick depth.

## Starting motion ranges

These are debugging starting points, not laws or delays to enforce. Judge rendered behavior, interaction frequency, and native controls before tuning.

| Interaction | Starting character |
| --- | --- |
| Press | Immediate contact feedback; about 60–90 ms to settle. If useful, compression around 0.98–0.985 scale; less may suffice. |
| Hover | About 100–160 ms; prefer tint/opacity or 1–2 pt movement over scale. |
| Shared indicator / anchored tooltip | About 150–230 ms; light and interruptible. |
| Detail entrance | About 220–300 ms; connected to the trigger, with a faster exit where appropriate. |
| Optional card flip | About 450–520 ms; controlled and thin. |
| Small choreography stagger | About 20–35 ms, only when it clarifies hierarchy. |

Do not stretch a fast backend result to fit these ranges or stack delays to reach them. A Connection Bridge's duration never acts as a request timeout or success condition.

## Reduce Motion

Retain immediate feedback, explicit state, selection, and Back. Replace 3D flips, traveling pulses, large transforms, and spring rebound with direct changes or short low-amplitude opacity transitions. The static bridge must still communicate reported connection state. All interactions remain understandable without animation.

## Motion review checklist

- What user input or newly observed state caused this motion?
- What result or relationship does it explain?
- Can it be interrupted or retargeted without waiting or resetting visibly?
- Can it reverse naturally where meaningful, without implying a backend undo?
- Is the exit faster than the entrance where appropriate?
- Are the same card, selector, navigation, and source/detail context preserved?
- Are shared budget, Reserved, Paid, delivery, and connection facts still distinct?
- Is the result understandable with Reduce Motion and with animation disabled?
- Are frequent actions quiet and all decorative motion removed?

For implementation, run the relevant project checks. Do not automatically launch the app or use Computer Use after every change; reserve that for explicit requests or GUI-only issues. A build does not establish visual or motion acceptance; final acceptance is manual.
