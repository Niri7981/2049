import Foundation

/// Calendar and lifecycle fixtures only; no backend, credentials, or payment.
@main
struct ActivityLedgerPresentationTest {
    static func purchase(_ id: String, at date: Date, changes: [String: Any] = [:]) throws -> AppOverview.Purchase {
        var fields: [String: Any] = [
            "purchaseId": id, "createdAt": Int64(date.timeIntervalSince1970 * 1_000),
            "status": "APPROVED", "deliveryStatus": "NOT_PAID", "amount": "200000",
            "resourceId": "market-snapshot", "reason": "  Live devnet acceptance test  ",
            "executionMode": "live_devnet", "monetaryEnvironment": "live_devnet",
            "network": "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
            "currency": "USDC", "assetDecimals": 6,
        ]
        fields.merge(changes) { _, value in value }
        return try JSONDecoder().decode(AppOverview.Purchase.self,
            from: JSONSerialization.data(withJSONObject: fields))
    }

    static func main() throws {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "Asia/Shanghai")!
        let today = calendar.date(from: DateComponents(year: 2026, month: 10, day: 1))!
        let now = today.addingTimeInterval(12 * 3_600)
        let yesterday = calendar.date(byAdding: .day, value: -1, to: today)!
        let older = calendar.date(byAdding: .day, value: -2, to: today)!
        let purchases = try [
            purchase("yesterday", at: today.addingTimeInterval(-1)),
            purchase("older", at: older),
            purchase("a", at: today.addingTimeInterval(1)),
            purchase("b", at: today.addingTimeInterval(1)),
            purchase("latest", at: now),
        ]
        let ledger = ActivityLedgerPresentation(purchases, agentName: "Research", now: now, calendar: calendar)
        precondition(ledger.days.map(\.id) == [today, yesterday, older])
        precondition(ledger.days[0].title == "Today" && ledger.days[1].title == "Yesterday")
        precondition(ledger.days[2].title != "Yesterday" && !ledger.days[2].title.isEmpty)
        precondition(ledger.days[0].rows.map(\.id) == ["latest", "a", "b"])
        let row = ledger.days[0].rows[0]
        precondition(row.item.title == "Market Snapshot" && row.item.amount == "0.20 Test USDC")
        precondition(row.context == "Research · Devnet · Developer · Solana" && row.purpose == "Live devnet acceptance test")
        precondition(row.item.status == "Approved" && row.tone == .positive)

        func status(_ changes: [String: Any]) throws -> ActivityLedgerPresentation.Row {
            ActivityLedgerPresentation.Row(try purchase("status", at: now, changes: changes), agentName: "Codex")
        }
        let paid = try status(["status": "PAID", "deliveryStatus": "PENDING"])
        let delivered = try status(["status": "PAID", "deliveryStatus": "COMPLETE"])
        let simulated = try status(["status": "PAID", "deliveryStatus": "COMPLETE", "executionMode": "simulated"])
        let unverified = try status(["status": "PAID", "deliveryStatus": "COMPLETE", "executionMode": "UNKNOWN"])
        let unknown = try status(["status": "PAYMENT_UNKNOWN"])
        precondition(paid.item.status == "Paid · delivery pending" && paid.item.delivery == "Pending")
        precondition(paid.item.supportingStatus == "Paid")
        precondition(delivered.item.status == "Delivered" && delivered.tone == .positive)
        precondition(simulated.item.status == "Simulated" && simulated.tone == .neutral)
        precondition(unverified.item.status == "Payment unverified" && unverified.tone == .neutral)
        precondition(unknown.item.status == "Payment unknown" && unknown.tone == .pending)
        let exhausted = try status(["status": "PAID", "deliveryStatus": "EXHAUSTED"])
        precondition(exhausted.item.status == "Paid · delivery exhausted" && exhausted.tone == .positive)
        let mainnet = try status(["monetaryEnvironment": "live_mainnet", "executionMode": "live_mainnet",
            "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"])
        precondition(mainnet.item.amount == "0.20 USDC" && mainnet.context == "Codex · Mainnet · Solana")
        let sol = try status(["currency": "SOL", "assetDecimals": 9, "amount": "200000000"])
        precondition(sol.item.amount == "0.20 Test SOL")
        let usdt = try status(["currency": "USDT"])
        precondition(usdt.item.amount == "0.20 Test USDT")
        let mainnetSol = try status(["currency": "SOL", "assetDecimals": 9, "amount": "200000000",
            "monetaryEnvironment": "live_mainnet", "executionMode": "live_mainnet",
            "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"])
        precondition(mainnetSol.item.amount == "0.20 SOL")
        let unscoped = try status(["monetaryEnvironment": NSNull(), "executionMode": "live_mainnet",
            "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"])
        precondition(unscoped.item.amount == "0.20 Test USDC" && unscoped.item.mode == "Network unavailable")
        let denied = try status(["status": "DENIED", "reason": " ", "decisionReason": "DAILY_BUDGET_EXCEEDED"])
        precondition(denied.item.status == "Denied" && denied.tone == .negative
            && denied.purpose == "Daily authority exceeded")
        let expired = try status(["status": "EXPIRED"])
        let unrecognized = try status(["status": "NEW_UNKNOWN_STATE"])
        let resource = try status(["resourceId": "actual-resource-id"])
        precondition(expired.tone == .neutral && unrecognized.tone == .neutral)
        precondition(resource.item.title == "actual-resource-id")
        precondition(resource.item.icon == .symbol("chevron.left.forwardslash.chevron.right"))
        let marketIcon = try status(["resourceId": "market-snapshot"])
        let openAIIcon = try status(["resourceId": "openai-api", "providerId": "openai"])
        let vercelIcon = try status(["resourceId": "build-minutes", "providerId": "vercel"])
        precondition(marketIcon.item.icon == .symbol("waveform.path"))
        precondition(openAIIcon.item.icon == .asset("ProviderOpenAI"))
        precondition(vercelIcon.item.icon == .symbol("server.rack"))
        precondition(ActivityLedgerPresentation([], agentName: "Codex", now: now, calendar: calendar).days.isEmpty)

        // Yesterday must follow the calendar, including a 23-hour daylight-saving day.
        calendar.timeZone = TimeZone(identifier: "America/Los_Angeles")!
        let dstToday = calendar.date(from: DateComponents(year: 2026, month: 3, day: 9))!
        let dstYesterday = calendar.date(byAdding: .day, value: -1, to: dstToday)!
        precondition(dstToday.timeIntervalSince(dstYesterday) == 23 * 3_600)
        let dst = ActivityLedgerPresentation([try purchase("dst", at: dstYesterday)],
            agentName: "Codex", now: dstToday, calendar: calendar)
        precondition(dst.days[0].title == "Yesterday")
        print("Activity ledger: local dates, DST, stable ordering, real context, and lifecycle distinctions passed")
    }
}
