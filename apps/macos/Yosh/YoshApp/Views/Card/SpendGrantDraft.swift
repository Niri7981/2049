import Foundation

/// Editor values only. The backend independently validates and authorizes every write.
struct SpendGrantDraft {
    var total: String
    var perTransaction: String
    var expiration: Date

    init(grant: AppOverview.Grant?, now: Date = .now) {
        total = grant.map { Self.decimal($0.totalLimit.value, decimals: $0.assetDecimals) } ?? ""
        perTransaction = grant.map { Self.decimal($0.singleLimit.value, decimals: $0.assetDecimals) } ?? ""
        let saved = grant.map { Date(timeIntervalSince1970: TimeInterval($0.expiresAt) / 1_000) }
        expiration = saved.flatMap { $0 > now.addingTimeInterval(60) ? $0 : nil }
            ?? now.addingTimeInterval(8 * 60 * 60)
    }

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

    static func decimal(_ amount: Int64, decimals: Int) -> String {
        guard amount >= 0, (0...18).contains(decimals) else { return "—" }
        let digits = String(amount)
        if decimals == 0 { return digits }
        let padded = String(repeating: "0", count: max(0, decimals + 1 - digits.count)) + digits
        let whole = String(padded.dropLast(decimals))
        let fraction = String(padded.suffix(decimals)).replacingOccurrences(of: "0+$", with: "", options: .regularExpression)
        return whole + "." + fraction.padding(toLength: max(2, fraction.count), withPad: "0", startingAt: 0)
    }
}
