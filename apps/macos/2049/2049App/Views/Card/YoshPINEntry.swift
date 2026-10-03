import SwiftUI

/// Presentation only: this PIN never leaves the front view or unlocks backend authority.
struct YoshPINEntry: View {
    @Binding var pin: String
    var isFocused: FocusState<Bool>.Binding
    var digitCount = 4

    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        VStack(spacing: 15) {
            Text("Enter your password")
                .font(.system(size: 16, weight: .regular))
                .tracking(1.5)
                .foregroundStyle(Color(nsColor: .labelColor).opacity(0.72))
                .accessibilityHidden(true)

            ZStack {
                // Native SecureField hits its editor bounds, not the whole capsule.
                // A plain button underneath transfers edge clicks to the same editor.
                Button(action: focusInput) {
                    Capsule()
                        .fill(.black.opacity(0.075))
                        .frame(width: 276, height: 54)
                }
                .buttonStyle(.plain)
                .focusable(false)
                .accessibilityHidden(true)

                // Keep native secure editing/paste/VoiceOver, with our own fixed dot display.
                SecureField("", text: $pin)
                    .textFieldStyle(.plain)
                    .foregroundStyle(.clear)
                    .tint(.clear)
                    .opacity(0.01)
                    .frame(width: 224)
                    .focused(isFocused)
                    .defaultFocus(isFocused, false)
                    .onChange(of: pin) { _, value in
                        let normalized = Self.normalizedPIN(value, digitCount: digitCount)
                        if normalized != value { pin = normalized }
                    }
                    .onSubmit { isFocused.wrappedValue = false }
                    .onExitCommand { isFocused.wrappedValue = false }
                    .accessibilityLabel("Enter your password")
                    .accessibilityHint("\(digitCount)-digit PIN")
                    .accessibilityIdentifier("YoshPINInput")

                HStack(spacing: digitCount == 6 ? 24 : 32) {
                    ForEach(0..<digitCount, id: \.self) { index in
                        Circle()
                            .fill(Color(nsColor: .labelColor).opacity(index < pin.count ? 0.84 : 0.38))
                            .frame(width: 16, height: 16)
                    }
                }
                .accessibilityHidden(true)
                .allowsHitTesting(false)

                Capsule()
                    .strokeBorder(
                        Color(nsColor: .labelColor).opacity(isFocused.wrappedValue ? 0.40 : 0.10),
                        lineWidth: contrast == .increased ? 2 : 1
                    )
                    .frame(width: 276, height: 54)
                    .allowsHitTesting(false)
            }
            .frame(width: 276, height: 54)
        }
    }

    private func focusInput() { isFocused.wrappedValue = true }

    static func normalizedPIN(_ value: String, digitCount: Int) -> String {
        precondition(digitCount == 4 || digitCount == 6, "Yosh supports a four- or six-digit PIN")
        return String(value.filter { $0 >= "0" && $0 <= "9" }.prefix(digitCount))
    }
}
