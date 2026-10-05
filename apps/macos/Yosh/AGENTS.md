## Apple-native-first

Yosh is a native macOS application.

Before implementing any UI control, material, navigation element,
popover, menu, toggle, slider, picker, tab/segmented control,
window behavior, or visual effect:

1. Check whether SwiftUI or AppKit already provides an official Apple API
   or native control that satisfies the requirement.

2. Prefer the native Apple implementation before writing a custom one.

3. Do not recreate Apple platform behavior using custom drawing,
   blur stacks, fake glass, manually animated replicas, or custom
   hit-testing unless the native API is genuinely insufficient.

4. For Liquid Glass, prefer official Apple Liquid Glass APIs and native
   controls when supported by the deployment target.

5. Prefer native:

   - Toggle
   - Slider
   - Picker / Menu
   - Popover
   - SF Symbols
   - semantic colors
   - native window behavior
   - native accessibility behavior

6. If a custom implementation is chosen instead of an available native
   Apple API, explain why the native solution is insufficient before
   implementing it.

7. Product-specific visual constraints still come from $yosh-ui.

8. Product-specific motion character comes from $yosh-motion.

9. Use $swiftui-pro for SwiftUI implementation quality.

10. Do not hand-roll Apple behavior by default.
