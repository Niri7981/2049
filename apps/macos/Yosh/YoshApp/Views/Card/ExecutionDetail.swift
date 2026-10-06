import SwiftUI

struct ExecutionDetail: View {
    let environment: ExecutionEnvironment?
    let isSaving: Bool
    let message: String?
    let messageFailed: Bool
    let onBack: () -> Void
    let onSelect: (AppOverview.Service.PurchaseMode) async -> Void

    private let ink = Color(red: 0.07, green: 0.10, blue: 0.15)
    private let secondaryInk = Color(red: 0.42, green: 0.48, blue: 0.57)
    private let rule = Color(red: 0.73, green: 0.79, blue: 0.87).opacity(0.5)

    var body: some View {
        ScrollView(.vertical) {
            VStack(alignment: .leading, spacing: 0) {
                Button(action: onBack) {
                    Label("Authority", systemImage: "chevron.left")
                        .font(.system(size: 13))
                        .frame(minHeight: 24, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .foregroundStyle(secondaryInk)
                .disabled(isSaving)
                .accessibilityLabel("Back to Authority")

                Text("Execution")
                    .font(.system(size: 44, weight: .regular, design: .serif))
                    .tracking(-1.2)
                    .accessibilityAddTraits(.isHeader)
                    .padding(.top, 12)
                Text("Choose how Yosh executes approved purchases.")
                    .font(.system(size: 13))
                    .foregroundStyle(secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 8)
                    .padding(.bottom, 24)

                ForEach(AppOverview.Service.PurchaseMode.allCases, id: \.self) { mode in
                    hairline
                    Button {
                        guard environment?.mode != mode else { return }
                        Task { await onSelect(mode) }
                    } label: {
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            VStack(alignment: .leading, spacing: 6) {
                                Text(mode.title).font(.system(size: 15, weight: .medium))
                                Text(description(mode))
                                    .font(.system(size: 12))
                                    .foregroundStyle(secondaryInk)
                                if mode == .liveMainnet, let status = environment?.mainnetStatus {
                                    Text(status)
                                        .font(.system(size: 11))
                                        .foregroundStyle(secondaryInk)
                                        .fixedSize(horizontal: false, vertical: true)
                                        .padding(.top, 3)
                                }
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "checkmark")
                                .font(.system(size: 12, weight: .medium))
                                .opacity(environment?.mode == mode ? 1 : 0)
                                .accessibilityHidden(true)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.vertical, 17)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(isSaving || environment == nil)
                    .accessibilityAddTraits(environment?.mode == mode ? .isSelected : [])
                    .accessibilityLabel(mode.title)
                    .accessibilityValue(environment?.mode == mode ? "Selected" : "Not selected")
                    .accessibilityHint(description(mode))
                }
                hairline
                if let environment {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("\(environment.cluster) · \(environment.network)")
                        Text("\(environment.asset.displayLabel) · \(environment.asset.decimals) decimals")
                        Text(environment.asset.mint).textSelection(.enabled)
                    }
                    .font(.system(size: 10))
                    .foregroundStyle(secondaryInk)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.top, 18)
                }
                if isSaving {
                    Text("Saving…").font(.system(size: 12)).foregroundStyle(secondaryInk).padding(.top, 14)
                } else if let message {
                    Text(message).font(.system(size: 12))
                        .foregroundStyle(messageFailed ? .red : secondaryInk)
                        .padding(.top, 14)
                } else if environment == nil {
                    Text("Execution environment unavailable")
                        .font(.system(size: 12)).foregroundStyle(secondaryInk).padding(.top, 14)
                }
            }
            .padding(.horizontal, 26)
            .padding(.vertical, 24)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .foregroundStyle(ink)
    }

    private var hairline: some View {
        Rectangle().fill(rule).frame(height: 1).accessibilityHidden(true)
    }

    private func description(_ mode: AppOverview.Service.PurchaseMode) -> String {
        switch mode {
        case .simulated: "No transaction is submitted."
        case .liveDevnet: "Uses Solana Devnet and test USDC."
        case .liveMainnet: "Uses Solana Mainnet and real USDC."
        }
    }
}
