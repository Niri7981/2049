import Foundation

// The isolated CLI test compiles the transport without starting the app service.
enum ServiceRuntimeError: Error {
    case unavailable, configuration, requestTimedOut, responseTooLarge, authenticationFailed
}

private let defaultID = "00000000-0000-4000-8000-000000000001"
private let researchID = "00000000-0000-4000-8000-000000000002"
private let buyerID = "00000000-0000-4000-8000-000000000003"

private func decode<T: Decodable>(_ type: T.Type, _ value: [String: Any]) throws -> T {
    try JSONDecoder().decode(type, from: JSONSerialization.data(withJSONObject: value))
}

private func member(_ id: String, _ label: String, status: String = "ACTIVE", isDefault: Bool = false, createdAt: Int64 = 2) -> [String: Any] {
    ["id": id, "label": label, "status": status, "isDefault": isDefault,
     "createdAt": createdAt, "updatedAt": createdAt]
}

private func connection(_ enabled: Bool) -> [String: Any] {
    ["enabled": enabled, "lastSeen": NSNull(), "access": "purchase_intent"]
}

private func grant(_ id: String) -> [String: Any] {
    ["id": id, "status": "ACTIVE", "totalLimit": "200000", "remaining": "150000",
     "singleLimit": "100000", "assetDecimals": 6, "expiresAt": 2_000_000_000_000 as Int64]
}

private func purchase(_ id: String) -> [String: Any] {
    ["purchaseId": id, "status": "PAID", "deliveryStatus": "COMPLETE",
     "amount": "10000", "createdAt": 1_000 as Int64, "executionMode": "simulated"]
}

private func summary(_ info: [String: Any]) throws -> CardMemberSummary {
    try decode(CardMemberSummary.self, ["member": info, "connection": connection(true), "grant": NSNull()])
}

private func snapshot(_ info: [String: Any], enabled: Bool, grantValue: Any, purchases: [[String: Any]]) throws -> CardMemberSnapshot {
    try decode(CardMemberSnapshot.self, [
        "member": info, "connection": connection(enabled), "grant": grantValue, "purchases": purchases,
        // This deliberately differs from the card overview: the UI must keep the global budget source.
        "budget": ["dailyLimit": "999", "paid": "0", "reserved": "0", "remaining": "999", "paused": false],
    ])
}

private func check(_ condition: @autoclosure () -> Bool, _ message: String) {
    precondition(condition(), message)
}

let defaultMember = member(defaultID, "Codex", isDefault: true, createdAt: 1)
let researchMember = member(researchID, "Research")
let buyerMember = member(buyerID, "Buyer", createdAt: 3)
let defaultSummary = try summary(defaultMember)
let researchSummary = try summary(researchMember)
let buyerSummary = try summary(buyerMember)
let id = { (value: String) in UUID(uuidString: value)! }

// The backend default wins even if a response lists it second. An explicit switch stays selected.
check(CardMemberSelection.choose(current: nil, from: [researchSummary, defaultSummary]) == id(defaultID), "initial default")
check(CardMemberSelection.choose(current: id(researchID), from: [defaultSummary, researchSummary]) == id(researchID), "switch persists")
check(CardMemberSelection.choose(current: id(researchID), from: [defaultSummary, researchSummary, buyerSummary]) == id(researchID), "create preserves selection")
let revokedResearch = try summary(member(researchID, "Research", status: "REVOKED"))
check(CardMemberSelection.choose(current: id(researchID), from: [revokedResearch, defaultSummary, buyerSummary]) == id(defaultID), "revoke fallback")
check(CardMemberSelection.choose(current: id(researchID), from: [revokedResearch]) == nil, "empty active state")
check(CardMemberSelection.choose(current: nil, from: [buyerSummary, researchSummary]) == id(researchID), "stable first active fallback")

let overviewPayload: [String: Any] = [
    "service": ["status": "running", "recoveryStatus": "complete", "testEnvironment": true,
                "purchaseMode": "simulated", "network": "Solana Devnet"],
    "wallet": ["address": "PublicWalletAddress", "reused": true],
    "budget": ["dailyLimit": "1000000", "dailyLimitDisplay": "1 test USDC", "paid": "10000", "reserved": "0",
               "remaining": "990000", "remainingDisplay": "0.99 test USDC", "paused": false],
    "grant": grant("default-grant"), "connection": connection(false), "purchases": [purchase("default-purchase")],
]
let shared = try decode(AppOverview.self, overviewPayload)
check(shared.service.status == .running && shared.service.purchaseMode == .simulated &&
      shared.service.network == "Solana Devnet", "backend overview service decodes without member-only isDefault")
let research = try snapshot(researchMember, enabled: true, grantValue: grant("research-grant"), purchases: [purchase("research-purchase")])
let selectedResearch = AppOverview(shared: shared, member: research)
check(selectedResearch.budget.dailyLimit?.value == 1_000_000, "daily budget stays shared")
check(selectedResearch.grant?.id == "research-grant", "grant is selected member's")
check(selectedResearch.connection.enabled, "connection is selected member's")
check(selectedResearch.purchases.map(\.purchaseId) == ["research-purchase"], "activity is selected member's")

let buyer = try snapshot(buyerMember, enabled: false, grantValue: NSNull(), purchases: [])
let selectedBuyer = AppOverview(shared: shared, member: buyer)
check(selectedBuyer.budget.remaining?.value == selectedResearch.budget.remaining?.value, "switch keeps shared remaining")
check(selectedBuyer.grant == nil && !selectedBuyer.connection.enabled && selectedBuyer.purchases.isEmpty, "switch clears member facts")

let settings = CardSettingsPresentation(shared)
check(settings.serviceStatus == "Running", "Settings reads backend service status")
check(settings.walletAddress == "PublicWalletAddress", "Settings reads the public wallet address")
check(settings.shortWalletAddress == "PublicWa…ress", "Settings shortens the public address without changing the copy value")
check(settings.dataDirectory == nil, "Settings does not invent a storage path")
var livePayload = overviewPayload
livePayload["service"] = ["status": "stopping", "recoveryStatus": "pending", "testEnvironment": true,
                          "purchaseMode": "live_devnet", "network": "Solana Devnet"]
let liveSettings = CardSettingsPresentation(try decode(AppOverview.self, livePayload))
check(liveSettings.serviceStatus == "Stopping", "Settings reflects changed service state")

let health: [String: Any] = ["ready": true, "service": "Yosh", "pid": 123,
    "dataDirectory": "/tmp/yosh-settings-fixture/resolved"]
let healthData = try JSONSerialization.data(withJSONObject: health)
let directory = CardSettingsPresentation.dataDirectory(from: healthData)
check(directory?.path == "/tmp/yosh-settings-fixture/resolved", "Settings uses the backend-resolved storage path")
for change: [String: Any] in [["ready": false], ["service": "other"], ["dataDirectory": "relative/path"],
                              ["dataDirectory": NSNull()], ["dataDirectory": "/tmp/a\u{0}b"]] {
    let invalid = health.merging(change) { _, new in new }
    let invalidData = try JSONSerialization.data(withJSONObject: invalid)
    check(CardSettingsPresentation.dataDirectory(from: invalidData) == nil,
        "Invalid health metadata cannot enable Open data folder")
}
check(CardSettingsPresentation.dataDirectory(from: Data(repeating: 32, count: 4097)) == nil, "Oversized health response is rejected")
check(CardSettingsPresentation.repositoryURL.absoluteString == "https://github.com/Niri7981/2049", "Settings links to the actual project")

let memberUUID = id(researchID)
let memberPath = "/api/app/members/\(researchID.lowercased())"
check(ServiceEndpoint.members.path == "/api/app/members" && ServiceEndpoint.members.method == "GET", "member list endpoint")
check(ServiceEndpoint.member(memberUUID).path == memberPath && ServiceEndpoint.member(memberUUID).method == "GET", "member detail endpoint")
check(ServiceEndpoint.createMember("Research").method == "POST", "member create method")
check(ServiceEndpoint.renameMember(memberUUID, "Buyer").path == memberPath, "member rename path")
check(ServiceEndpoint.revokeMember(memberUUID).method == "DELETE", "member revoke method")
check(ServiceEndpoint.setMemberConnection(memberUUID, true).path == "\(memberPath)/connection", "selected connection path")
check(ServiceEndpoint.createMemberGrant(memberUUID, totalLimit: "200000", singleLimit: "100000", expiresAt: 2_000_000_000_000).path == "\(memberPath)/grant", "selected grant path")
check(ServiceEndpoint.revokeMemberGrant(memberUUID).path == "\(memberPath)/grant", "selected grant revoke path")
let renameBody = (try JSONSerialization.jsonObject(with: ServiceEndpoint.renameMember(memberUUID, "Buyer").body()!)) as? [String: String]
check(renameBody?["label"] == "Buyer", "member rename body")
print("Native member and settings tests passed")

var mainnetPayload = overviewPayload
mainnetPayload["service"] = ["status": "running", "purchaseMode": "live_mainnet", "network": "Solana Mainnet", "paymentEnabled": false,
    "registeredResources": [["resourceId": "production-data", "providerId": "provider", "url": "https://provider.example/data", "recipient": "recipient",
        "network": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", "assetId": "mainnet-mint", "assetDecimals": 6]]]
var mainnetPurchase = purchase("mainnet-fixture")
mainnetPurchase["executionMode"] = "live_mainnet"
mainnetPurchase["network"] = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
mainnetPurchase["assetDecimals"] = 6
mainnetPurchase["currency"] = "USDC"
mainnetPayload["purchases"] = [mainnetPurchase]
let mainnetOverview = try decode(AppOverview.self, mainnetPayload)
check(mainnetOverview.service.purchaseMode == .liveMainnet && mainnetOverview.service.paymentEnabled == false, "Mainnet disabled state decodes")
check(mainnetOverview.service.registeredResources?.first?.resourceId == "production-data", "Native grant scope comes from backend registration")
check(PurchasePresentation(mainnetOverview.purchases[0]).mode == "Live · Mainnet", "Mainnet purchase is not shown as a Devnet payment")
check(ActivityPurchasePresentation(mainnetOverview.purchases[0]).section == .paid, "Mainnet paid history remains readable")
check(AuthorityOverviewPresentation(mainnetOverview).execution == "Live · Mainnet", "Selection is separate from production enablement")
let scopedGrant = ServiceEndpoint.createMemberGrant(memberUUID, totalLimit: "200000", singleLimit: "100000", expiresAt: 2_000_000_000_000, resourceId: "production-data")
let scopedBody = try JSONSerialization.jsonObject(with: scopedGrant.body()!) as? [String: Any]
check(scopedBody?["resourceId"] as? String == "production-data", "Native management request carries only registered scope ID")
check(scopedBody?["network"] == nil && scopedBody?["recipient"] == nil && scopedBody?["wallet"] == nil, "Backend owns all payment facts")
print("Native Mainnet projections and scoped management transport passed")
