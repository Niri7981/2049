---
name: 2049-motion
description: Product-specific motion system for 2049 Agent Card interactions. Use when designing, implementing, or reviewing press feedback, hover, card flips, focused-detail navigation, Agent switching, or other 2049 transitions. Defines how 2049 interactions should feel; delegate generic animation APIs and SwiftUI techniques to relevant external skills.
---

# 2049 Motion

This skill defines how 2049 interactions should feel. Apply it to 2049 UI motion by default; it is the canonical home for product-specific motion rules. Pair it with `$2049-ui` for the product surface and information architecture. For generic SwiftUI implementation techniques use `$swiftui-pro` and `$swiftui-ui-patterns`.

Use `$apple-motion-feel` for Apple-native spring, gesture,
momentum, and interruption behavior.

## Responsibility and priority

`$2049-motion` is the source of truth for how motion should feel in 2049.

When multiple skills are used:

1. The user's current explicit request
2. `$2049-ui` product constraints
3. `$2049-motion` interaction character
4. Native macOS behavior and accessibility
5. `$apple-motion-feel`, `$ui-animation`, and SwiftUI implementation skills

External motion skills may help implement or analyze motion, but they must not override 2049's product-specific motion character.

## Reference handling

When the user provides a motion reference, extract interaction mechanics, not visual identity. Treat the reference as evidence for interaction behavior, not authority over 2049's product identity.

Analyze:

- persistent objects
- trigger location
- movement direction
- geometry changes
- timing order
- spring / easing character
- interruptibility
- velocity behavior
- settle behavior

Do not copy branding, layout, colors, iconography, or decorative styling.

## Motion references

Rauno Freiberg's [Craft work](https://rauno.me/craft) is a reference for interaction mechanics and spatial continuity, not visual styling. Borrow the interaction principle, not the visual design. For broader principles about interruption, momentum, spatial consistency, and motion frequency, see [Invisible Details of Interaction Design](https://rauno.me/craft/interaction-design).

When studying a Rauno Craft reference, pay particular attention to persistent object identity, trigger-origin motion, shared surfaces, geometry morphing, spring character, interruption and retargeting, velocity behavior, choreography, and settling.

Examples:

- [**Exclusion Tabs**](https://rauno.me/craft/exclusion-tabs) → a shared selection surface.
- **Spatial Tooltip** → a shared, anchored floating surface.
- [**Wheel Input**](https://rauno.me/craft/wheel-input) → continuous inertial selection with spring settling.

If `$ui-animation` is available, use it to analyze or reconstruct the supplied reference. Rauno references must not override `$2049-ui` product identity or Apple-native presentation.

## Motion character

2049 motion should feel fast, physical, responsive, continuous, and controlled. Motion connects an input to its result; it is never decoration or a substitute for clear state.

Phantom is a reference for tactile response and navigation continuity only. Do not copy its layout, navigation bar, colors, icons, or other visual identity.

## One motion system

Use these principles together as 2049 Craft Motion:

1. **Acknowledge contact immediately.** On pointer-down or equivalent input, provide subtle compression, material response, a small positional change, or a highlight. Do not wait for navigation to finish before the control responds.
2. **Connect the input to the state change.** On release, the control's recovery and the destination transition begin as one continuous response. The destination should feel selected by the input, not like a later page change.
3. **Preserve object identity.** Prefer one surface, card, indicator, or control moving, resizing, or morphing into its next state. Avoid replacing it with an unrelated object that simply fades in.
4. **Originate from the trigger.** A selected row, button, icon, or control should visually lead into the resulting state when the relationship is clear. Avoid defaulting to generic center-screen transitions.
5. **Preserve spatial continuity.** Make it clear where the new state came from and how to return. Continuity matters more than spectacle.
6. **Settle with restraint.** Use a short, interruptible spring character for release and settling, with little or no visible rebound. Avoid bounce-heavy, game-like motion and large scale changes.
7. **Retarget without a reset.** If the user changes direction or selects another state mid-transition, respond immediately from the current presentation state. Preserve velocity where the interaction is continuous; never make the user wait for an animation to finish.
8. **Choreograph by cause.** Use this order when multiple elements need to respond: trigger → container/surface → primary content → secondary content → settle. Keep any stagger small and only use it when it clarifies hierarchy.
9. **Keep frequent interactions quiet.** Hover, row press, back, and toggle are fast and restrained. Rare transformations, such as a card flip, can have more visible choreography.
10. **Respect Reduce Motion.** Preserve the state hierarchy and causal relationship using a lower-amplitude, non-3D alternative where needed.

## Interaction guidance

### Press and release

The press-in begins immediately; the selected state/content transition begins with release and the control's recovery. Use small compression only when it helps communicate contact. A highlight, opacity shift, subtle material change, or tiny positional response may be clearer than scaling. Never sequence a completed press animation before navigation starts.

### Hover

Hover is fast and subtle: a soft row tint, slight material lift, a chevron response, or restrained control emphasis. Keep cursor response attached to the hovered item. Avoid large scaling, bounce, neon glow, and cursor trails.

### Card front/back flip

The front and back are two states of the same physical Agent Card. Keep the card shell and size consistent; use a restrained Y-axis flip and briefly reveal only a thin edge near the midpoint. Keep perspective subtle. The transition should be interruptible where practical and should not make the card appear thick or permanently angled.

### Overview → focused detail → back

Keep the card shell fixed while its content moves into a focused detail state. Let the selected row or control establish the transition's origin and preserve the source/destination relationship. Provide immediate reversal to the overview. Avoid separate large pages, modal proliferation, arbitrary delays, or unrelated fade swaps.

### Agent switching

Switch the Agent in place while preserving the card shell and window. Prefer a quick, subtle content crossfade or matched transition. Do not make the entire card disappear, reload the app, or use a lengthy cinematic transition. Keep each Agent's identity apparent throughout the change.

### Controls and status

Apply the same immediate, connected response to Authority rows, Activity and Purchase rows, Connection, back controls, execution-mode selection, and Payments. Motion may reinforce a state change, but the actual status must remain clear without relying on animation. Do not shake or dramatize denied states.

## Starting motion ranges

These are product-specific starting points, not fixed constants. Judge the rendered feel and keep the response appropriate to the control.

| Interaction | Starting character |
| --- | --- |
| Press feedback | Begins on contact; press-in generally settles over about 60–90 ms. If compression helps, keep it around 0.98–0.985 scale; less may be enough. |
| Hover | About 100–160 ms perceived response; favor tint, opacity, or 1–2 pt movement over scale. |
| Shared indicator or tooltip | About 150–230 ms; light and interruptible. |
| Focused-detail navigation | About 220–300 ms; spatially connected and reversible. |
| Card flip / major card transformation | About 450–520 ms; controlled, with a restrained sense of physicality. |
| Choreography stagger | About 20–35 ms, only when it improves clarity. |

Ranges may be shortened for reduced-motion settings or high-frequency controls. Avoid layering delays to reach a target duration.

## Reduce Motion

When Reduce Motion is enabled, replace the 3D flip and large spatial/morphing motion with a low-amplitude content transition. Preserve the same card identity, current selection, state hierarchy, and clear back path. Do not remove the interaction's acknowledgement or leave state changes ambiguous.

## Motion QA

Review each changed interaction against these questions:

- Does the control acknowledge contact before the destination change completes?
- Do input, surface, and content feel like one causally connected response?
- Does the transition preserve the identity of the card or selected object?
- Does a focused detail appear related to its source, and can it be reversed immediately?
- Can a new input interrupt or retarget the transition without waiting or an obvious velocity reset?
- Are hover and frequent actions quiet, while larger choreography is reserved for meaningful transformations?
- Does the card stay thin and spatially continuous through a flip?
- Does Agent switching preserve the card shell and keep the Agent identity clear?
- Is the interaction understandable with Reduce Motion?

Motion QA is a product-design and code-review checklist. Do not automatically launch the app or use Computer Use to inspect every change. Use CLI validation when available; final UI and motion acceptance is performed manually by the user. Computer Use is reserved for explicit user requests or GUI-only issues that cannot reasonably be diagnosed otherwise.
