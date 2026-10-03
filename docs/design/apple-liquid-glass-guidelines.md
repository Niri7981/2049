# 2049 — Apple Liquid Glass Design Notes

Design reference for the native macOS app; no implementation changes are implied. Section 1 records Apple's statements. Sections 2–6 are **2049-specific interpretations and internal rules**, not Apple requirements.

## 1. What Apple is actually saying

Source: [Apple introduces a delightful and elegant new software design](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/), Apple Newsroom, June 9, 2025. The relevant principles are:

- **Functional material:** Liquid Glass combines translucency, reflection and refraction; Apple applies it to interactive elements and navigation.
- **Layer above content:** Controls, toolbars and navigation form a distinct functional layer above the app.
- **Content remains primary:** Controls give way to content; thoughtful grouping helps users find what they need.
- **Context response:** Surrounding content informs the material's color; it adapts between light and dark environments.
- **Rounded geometry:** Controls relate concentrically to rounded hardware and window corners.
- **Dynamic transformation:** Material reacts to movement; controls morph as options or destinations change.
- **Navigation behavior:** In iOS 26, tab bars shrink on downward scrolling and expand on upward scrolling. iPadOS/macOS sidebars preserve context through surrounding content and wallpaper.
- **Platform familiarity:** A shared design preserves familiar experiences and each platform's distinct qualities; visionOS supplies material inspiration.

**Attribution boundary:** The article does not prescribe 2049's palette, component exclusions, opacity values, spring settings or animation timings. Selective use and restraint below are our decisions.

## 2. What this means for 2049

2049 is a narrow vertical native macOS app. The whole app surface is conceptually **the card**. Use cool white / pale blue-gray, Hermes-inspired editorial typography and spacing, and restrained blue as a system signal. Static content stays mostly flat and editorial.

This current direction takes precedence here over the earlier warm/orange palette and navigation restrictions in the [2049 UI skill](../../.codex/skills/2049-ui/SKILL.md). Retain its one-card identity, native controls and explicit status hierarchy.

| Principle | Internal application |
| --- | --- |
| Functional material | Give glass a named interaction purpose: selecting an Agent, navigating, presenting a temporary control or acknowledging connection input. |
| Layer above content | Keep top and bottom controls distinct from the reading surface. Avoid nested glass panels within the card. |
| Content primacy | Make balances, authority values and purchase states easier to notice than material highlights. Establish hierarchy with type, alignment and spacing first. |
| Context response | Allow subtle environmental tint on eligible controls; keep text contrast stable across wallpapers and appearances. Do not reveal readable wallpaper through core content. |
| Concentric geometry | Relate control curves to the card edge and their inset. Check contours together; do not assign every nested shape the same radius or turn every section into a capsule. |
| Dynamic transformation | Preserve the card shell while selection, focus or control state changes. Let the initiating control explain where the result came from. |
| Navigation behavior | Keep bottom navigation compact and accessible within the card. Do not copy iOS scroll collapse automatically or add a sidebar to this narrow layout. |
| Platform familiarity | Prefer native macOS controls, keyboard focus and presentation. Express the editorial direction through typography and whitespace; avoid a spatial-computing scene. |

**Glass candidates:** top Agent selector, bottom navigation, popovers/sheets, transient focus/hover on controls, and connection interaction/state.

**Keep flat:** hero balance; Grant, Per transaction and Execution content; Payments text/content; Activity ledger rows; core content surfaces. A control inside these areas may use material without making its entire section glass.

## 3. 2049 Liquid Glass rules

### DO

- Use glass selectively for navigation and interactive control surfaces.
- Let content dominate; preserve readable labels, amounts and hierarchy in every state.
- Use restrained translucency and minimal edge emphasis.
- Use material changes to reinforce interaction or state, accompanied by explicit text/control state.
- Prefer native controls and supported system materials; keep a readable flat fallback when needed.
- Tie motion to user input or meaningful state transitions.

### DON'T

- Glassify the entire window or place every section inside a glass card.
- Use blur as decoration, excessive glow, luminous borders or stacked reflections.
- Apply Liquid Glass to static ledger rows, amounts or explanatory copy.
- Refract or distort financial values during interaction.
- Make the app resemble a Vision Pro concept mockup with floating panels and theatrical depth.
- Sacrifice hierarchy, contrast or usability for visual effects.

## 4. Component-specific guidance

| Component | Practical rule |
| --- | --- |
| **Agent selector** | Use one compact glass control with a legible Agent name and disclosure. Open a native menu/popover. Switching updates content in place; preserve the card and make the new identity clear. |
| **Bottom tab bar** | Use one shared material surface with a quiet selection treatment. Keep labels, keyboard focus and full clickable areas clear. Reserve content space so it cannot obscure the last ledger row. Avoid a separate glass bubble for every tab. |
| **Connection page** | Keep identity, access and status facts flat. Use material on connect/reconnect controls and brief state feedback. Distinguish enabled access from an observed connection; a highlight must not imply a successful handshake. |
| **Authority page** | Keep hero balance, Grant, Per transaction, Execution and Payments copy editorial. Use spacing and thin separators for grouping. Glass may belong to an editor's temporary controls, never to every value or row. |
| **Activity page** | Keep the ledger flat, with stable amount alignment and explicit payment/delivery states. Row hover/selection uses a quiet tint or focus outline, without blur. Open purchase detail within the same card. |
| **Toggles / switches** | Prefer a native macOS switch. Material belongs to the control, not its label or surrounding row. Blue can reinforce an enabled state; show saving, failure and confirmed state explicitly. |
| **Sheets / popovers** | Prefer native presentation with a clear trigger relationship and dismissal path. Keep form text on a readable backing; avoid nested glass fields. Use temporary presentation for choices or confirmation, not every detail page. |
| **Hover / pressed / transitions** | Localize feedback to the target: a small tint, highlight or compression. Keep text stable and keyboard focus equally clear. Retarget immediately on new input; never lift or glow the whole window. |

## 5. Motion principles

For 2049, the dynamic material principle becomes causal feedback. The [2049 Motion skill](../../.codex/skills/2049-motion/SKILL.md) remains the motion reference; the rules below are our product choices.

- **Connect input to result.** Acknowledge pointer-down immediately; release, control recovery and the resulting transition form one response.
- **Stay interruptible.** New input or Back can reverse/retarget from the current presentation state. Never wait for an animation to finish.
- **Exit quickly, enter slightly more slowly.** Clear the outgoing temporary surface promptly and give the incoming state time to become legible. Add no artificial delay; respect native presentation behavior.
- **Use springs for continuity.** A shared selection indicator, anchored expansion or press recovery may settle physically. Keep rebound minimal; ordinary text changes need no spring.
- **Animate meaningful state once.** Connection, approve, reserve, paid and revoke may receive subtle acknowledgement only when supported by actual state. Approval/reservation must not look like payment success; paid must not imply delivery. Keep unknown, pending and failed states explicit.
- **Remove decoration.** No idle shimmer, breathing glow, cursor trails or celebratory bounce. Under Reduce Motion, retain immediate feedback and clear state with low-amplitude transitions; under Reduce Transparency, retain an opaque, readable hierarchy.

## 6. Review checklist

- [ ] Does every glass surface serve an identifiable interaction?
- [ ] Is content still visually primary, with hierarchy readable without glass?
- [ ] Are the hero, authority content and Activity rows flat?
- [ ] Are labels, amounts and focus readable across wallpapers and appearances?
- [ ] Do curves and insets belong to one card, without nested glass cards?
- [ ] Are blue, material and motion reinforcing explicit state rather than inventing success?
- [ ] Do state changes preserve identity and respond immediately to interruption?
- [ ] Are keyboard use, Reduce Motion and Reduce Transparency understandable?
- [ ] Does this feel native to macOS and restrained enough for daily use?
