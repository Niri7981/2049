import Foundation

/// Read-only projection of GET /api/app/overview. Payment decisions stay in the backend.
struct AppOverview: Decodable {
    let service: Service
    let wallet: Wallet
    let budget: Budget
    let grant: Grant?
    let connection: Connection
    let purchases: [Purchase]

    /// Shared controls come from the card overview; member facts come only from that member's endpoint.
    init(shared: AppOverview, member: CardMemberSnapshot) {
        service = shared.service
        wallet = shared.wallet
        budget = shared.budget
        grant = member.grant
        connection = member.connection
        purchases = member.purchases
    }

    struct Service: Decodable {
        let status: Status
        let purchaseMode: PurchaseMode
        let network: String

        enum Status: String, Decodable {
            case running, stopping
        }

        enum PurchaseMode: String, Decodable {
            case simulated, liveDevnet = "live_devnet"
        }
    }

    struct Wallet: Decodable {
        let address: String
    }

    struct Budget: Decodable {
        let dailyLimit: MinorUnits?
        let dailyLimitDisplay: String
        let paid: MinorUnits
        let reserved: MinorUnits
        let remaining: MinorUnits?
        let remainingDisplay: String
        let paused: Bool

        private enum CodingKeys: String, CodingKey {
            case dailyLimit, dailyLimitDisplay, paid, reserved, remaining, remainingDisplay, paused
        }

        init(from decoder: Decoder) throws {
            let values = try decoder.container(keyedBy: CodingKeys.self)
            dailyLimit = try values.decodeIfPresent(MinorUnits.self, forKey: .dailyLimit)
            dailyLimitDisplay = try values.decode(String.self, forKey: .dailyLimitDisplay)
            paid = try values.decode(MinorUnits.self, forKey: .paid)
            reserved = try values.decode(MinorUnits.self, forKey: .reserved)
            remaining = try values.decodeIfPresent(MinorUnits.self, forKey: .remaining)
            remainingDisplay = try values.decode(String.self, forKey: .remainingDisplay)
            paused = try values.decode(Bool.self, forKey: .paused)
            guard (dailyLimit == nil) == (remaining == nil) else {
                throw DecodingError.dataCorruptedError(forKey: .remaining, in: values, debugDescription: "Daily limit and remaining must both be set or absent")
            }
        }
    }

    struct Grant: Decodable {
        let id: String
        let status: Status
        let totalLimit: MinorUnits
        let remaining: MinorUnits
        let singleLimit: MinorUnits
        let assetDecimals: Int
        let expiresAt: Int64

        enum Status: String, Decodable {
            case active = "ACTIVE", revoked = "REVOKED", expired = "EXPIRED"
        }
    }

    struct Connection: Decodable {
        let enabled: Bool
        let lastSeen: Int64?
        let access: Access

        enum Access: String, Decodable {
            case purchaseIntent = "purchase_intent"
            case readOnly = "read_only"
        }
    }

    struct Purchase: Decodable {
        let purchaseId: String
        let status: String
        let deliveryStatus: String
        let amount: MinorUnits
        let createdAt: Int64
        let offerId: String?
        let reason: String?
        let decisionReason: String?
        let transaction: String?
        let executionMode: ExecutionMode
        let network: String?
        let currency: String?
        let assetId: String?
        let assetDecimals: Int?
        let grantId: String?

        enum ExecutionMode: String, Decodable {
            case simulated, liveDevnet = "live_devnet", unknown = "UNKNOWN"
        }
    }
}

struct MinorUnits: Decodable, Equatable {
    let value: Int64

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        let raw = try container.decode(String.self)
        guard !raw.isEmpty, raw.utf8.allSatisfy({ $0 >= 48 && $0 <= 57 }),
              let value = Int64(raw), value >= 0 else {
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Invalid nonnegative minor-unit amount")
        }
        self.value = value
    }
}

struct AppBalance: Decodable {
    let amount: String?
    let display: String
    let available: Bool
}

/// Backend-owned member state. The budget is shared; grant, connection and purchases belong to one member.
struct CardMemberSnapshot: Decodable {
    let member: Member
    let connection: AppOverview.Connection
    let grant: AppOverview.Grant?
    let purchases: [AppOverview.Purchase]
    let budget: Budget

    struct Member: Decodable, Identifiable {
        let id: UUID
        let label: String
        let status: Status
        let isDefault: Bool
        let createdAt: Int64
        let updatedAt: Int64

        enum Status: String, Decodable {
            case active = "ACTIVE", revoked = "REVOKED"
        }
    }

    struct Budget: Decodable {
        let dailyLimit: MinorUnits?
        let paid: MinorUnits
        let reserved: MinorUnits
        let remaining: MinorUnits?
        let paused: Bool
    }
}

struct CardMemberSummary: Decodable {
    let member: CardMemberSnapshot.Member
    let connection: AppOverview.Connection
    let grant: AppOverview.Grant?

    init(snapshot: CardMemberSnapshot) {
        member = snapshot.member
        connection = snapshot.connection
        grant = snapshot.grant
    }
}
