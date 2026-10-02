import Foundation

struct DailyAuthorityPresentation {
    let currency: String?

    init(network: String) {
        currency = switch network.lowercased() {
        case "solana devnet", "devnet": "test USDC"
        case "solana mainnet", "solana mainnet-beta", "mainnet", "mainnet-beta": "USDC"
        default: nil
        }
    }

    /// Keep the backend's displayed numeric precision; only the network-dependent unit changes.
    func balanceDisplay(_ balance: AppBalance) -> String? {
        guard balance.available, let currency,
              balance.display.range(of: #"^[0-9]+(?:\.[0-9]+)? (?:test )?USDC$"#, options: .regularExpression) != nil,
              let amount = balance.display.split(separator: " ").first else { return nil }
        return "\(amount) \(currency)"
    }

    // Editor conversion only. The existing management API independently validates the shared limit.
    static func minorUnits(_ input: String) -> String? {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: #"^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$"#, options: .regularExpression) != nil else { return nil }
        let parts = value.split(separator: ".", omittingEmptySubsequences: false)
        let fraction = parts.count == 2 ? String(parts[1]) : ""
        let raw = String(parts[0]) + fraction.padding(toLength: 6, withPad: "0", startingAt: 0)
        let normalized = String(raw.drop(while: { $0 == "0" }))
        let amount = normalized.isEmpty ? "0" : normalized
        return amount.count <= 15 ? amount : nil
    }

    static func editableLimit(_ amount: Int64?) -> String {
        guard let amount else { return "" }
        let padded = String(repeating: "0", count: max(0, 7 - String(amount).count)) + String(amount)
        let whole = String(padded.dropLast(6))
        let fraction = String(padded.suffix(6)).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
        return "\(whole).\(fraction.padding(toLength: max(2, fraction.count), withPad: "0", startingAt: 0))"
    }
}
