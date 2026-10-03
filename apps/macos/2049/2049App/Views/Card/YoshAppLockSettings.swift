import SwiftUI

struct YoshAppLockSettings: View {
    let appLock: YoshAppLock

    @State private var showsPINChange = false

    private var canManageLock: Bool {
        appLock.state == .unlocked && appLock.pinConfigured && !appLock.isBusy
    }

    // The model remains authoritative while the Keychain update is in progress.
    private var enabledBinding: Binding<Bool> {
        Binding(
            get: { appLock.enabled },
            set: { enabled in Task { await appLock.setEnabled(enabled) } }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("App Lock")
                    .foregroundStyle(Color(red: 0.07, green: 0.10, blue: 0.15))
                Spacer(minLength: 4)
                Text(appLock.enabled ? "On" : "Off")
                    .font(.system(size: 11))
                    .foregroundStyle(Color(red: 0.42, green: 0.48, blue: 0.57))
                Toggle("App Lock", isOn: enabledBinding)
                    .labelsHidden()
                    .toggleStyle(.switch)
                    .controlSize(.mini)
                    .disabled(!canManageLock)
                    .accessibilityIdentifier("yosh.lock.enabled")
                    .accessibilityHint("Require your Yosh PIN when the app opens.")
            }
            .font(.system(size: 13))
            .frame(minHeight: 38)

            Rectangle()
                .fill(Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.5))
                .frame(height: 1)
                .accessibilityHidden(true)

            // Stay inside the card: a system sheet adds a separate appearance,
            // window shadow and dimming layer to this narrow settings surface.
            DisclosureGroup(isExpanded: $showsPINChange) {
                if showsPINChange {
                    YoshPINChangeEditor(appLock: appLock, onDismiss: { showsPINChange = false })
                        .padding(.vertical, 12)
                }
            } label: {
                Button { showsPINChange.toggle() } label: {
                    Text("Change PIN")
                        .font(.system(size: 13))
                        .foregroundStyle(Color(red: 0.07, green: 0.10, blue: 0.15))
                        .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            .disabled(!canManageLock)
            .tint(Color(red: 0.29, green: 0.45, blue: 0.66))
            .accessibilityIdentifier("yosh.lock.change")
            .onChange(of: showsPINChange) { _, expanded in
                if expanded { appLock.clearError() }
            }

            if let error = appLock.error, !showsPINChange {
                Text(error)
                    .font(.system(size: 11))
                    .foregroundStyle(Color(red: 0.58, green: 0.28, blue: 0.31))
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 4)
                    .accessibilityIdentifier("yosh.lock.settings.error")
            }
        }
    }
}
