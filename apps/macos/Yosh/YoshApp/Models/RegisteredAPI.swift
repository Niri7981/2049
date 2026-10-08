import Foundation

struct RegisteredAPI: Decodable, Identifiable {
    var id: String { resourceId }
    let resourceId: String
    let providerId: String
    let name: String
    let url: String
    let method: String
    let network: String
    let assetId: String
    let maximumPriceDisplay: String?
    let basePriceDisplay: String?
    let source: String
    let state: String
    let definition: Definition
    let submission: Submission?
    var isUserAdded: Bool { source == "user" || source == "agent" }
    var sourceLabel: String { source == "agent" ? "Agent-submitted" : (isUserAdded ? "Added" : "Built-in") }

    struct Submission: Decodable, Sendable {
        let cardMemberId: String
        let discoveryId: String
        let discoveredAt: Int64
        let sample: ResourceRequestSample
        let documentation: Documentation
    }
    struct Documentation: Decodable, Sendable {
        let urls: [String]
        let uncertainties: [String]
    }

    struct Definition: Decodable {
        let request: RegisterAPIRequest.HTTPRequest?
        let deliveryPolicy: RegisterAPIRequest.DeliveryPolicy?
        let deliveryRecovery: Recovery?
        let requestInputs: RegisterAPIRequest.Inputs?
    }
    struct Recovery: Codable {
        let kind: String
        var replayHeader: [String: String]? = nil
        var request: RegisterAPIRequest.HTTPRequest? = nil
        var identifier: String? = nil
        var location: String? = nil
        var name: String? = nil
        var details: String? {
            guard let data = try? JSONEncoder().encode(self) else { return nil }
            return String(data: data, encoding: .utf8)
        }
    }
    struct List: Decodable { let resources: [RegisteredAPI] }
}

struct RegisterAPIRequest: Encodable {
    let resourceId: String
    let providerId: String
    let displayName: String
    let request: HTTPRequest
    let network = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"
    let mint = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
    let decimals = 6
    let recipientSource = "live_challenge"
    let baseAmount: String?
    let maximumAmount: String
    let deliveryRecovery: RegisteredAPI.Recovery
    let deliveryPolicy: DeliveryPolicy
    let requestInputs: Inputs?

    struct DeliveryPolicy: Codable, Sendable {
        let format: String
        let mimeTypes: [String]
        let maxBytes: Int
    }

    struct Inputs: Codable, Sendable {
        let query: ResourceInputPolicy?
        let jsonBody: ResourceInputPolicy?
        var description: String? {
            guard let data = try? JSONEncoder().encode(self) else { return nil }
            return String(data: data, encoding: .utf8)
        }
    }
    struct HTTPRequest: Codable, Sendable {
        let url: String
        let method: String
        var access = "https"
        let headers: [String: String]
        let body: String?
    }
}

struct ResourceDiscovery: Decodable {
    let url: String
    let method: String
    let network: String
    let assetId: String
    let basePriceDisplay: String?
    let payTo: String
    let feePayer: String
    let maxTimeoutSeconds: Int
    let notice: String
    let paymentSent: Bool
}

extension Notification.Name {
    static let registeredAPIsChanged = Notification.Name("yosh.registeredAPIsChanged")
}

/// A bounded JSON sample is presentation input. The backend validates it again.
enum ResourceJSONValue: Codable, Sendable {
    case string(String), number(Decimal), bool(Bool), object([String: ResourceJSONValue]), array([ResourceJSONValue]), null
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if value.decodeNil() { self = .null }
        else if let item = try? value.decode(Bool.self) { self = .bool(item) }
        else if let item = try? value.decode(Decimal.self) { self = .number(item) }
        else if let item = try? value.decode(String.self) { self = .string(item) }
        else if let item = try? value.decode([String: ResourceJSONValue].self) { self = .object(item) }
        else { self = .array(try value.decode([ResourceJSONValue].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .string(let item): try value.encode(item)
        case .number(let item): try value.encode(item)
        case .bool(let item): try value.encode(item)
        case .object(let item): try value.encode(item)
        case .array(let item): try value.encode(item)
        case .null: try value.encodeNil()
        }
    }
}

struct ResourceRequestSample: Codable, Sendable {
    var query: [String: String]?
    var jsonBody: [String: ResourceJSONValue]?

    var queryText: String { Self.jsonText(query) }
    var bodyText: String { Self.jsonText(jsonBody) }
    private static func jsonText<T: Encodable>(_ value: T?) -> String {
        guard let value else { return "" }
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(value) else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }

    static func parse(queryText: String, bodyText: String) throws -> Self {
        let query = queryText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil
            : try JSONDecoder().decode([String: String].self, from: Data(queryText.utf8))
        let body = bodyText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil
            : try JSONDecoder().decode([String: ResourceJSONValue].self, from: Data(bodyText.utf8))
        return Self(query: query, jsonBody: body)
    }
}

struct ResourceDiscoveryRequest: Codable, Sendable {
    let url: String
    let method: String
    let headers: [String: String]
    let body: String?
    let requestInputs: RegisterAPIRequest.Inputs?
    let sample: ResourceRequestSample?
    var postApprovalHash: String? = nil
}

/// Legacy arrays remain readable; newly entered policies declare each field explicitly.
enum ResourceInputPolicy: Codable, Sendable, ExpressibleByArrayLiteral {
    case legacy([String]), fields([String: ResourceInputField])
    init(arrayLiteral elements: String...) { self = .legacy(elements) }
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer()
        if let keys = try? value.decode([String].self) { self = .legacy(keys) }
        else { self = .fields(try value.decode([String: ResourceInputField].self)) }
    }
    func encode(to encoder: Encoder) throws {
        var value = encoder.singleValueContainer()
        switch self {
        case .legacy(let keys): try value.encode(keys)
        case .fields(let fields): try value.encode(fields)
        }
    }
    var names: [String] {
        switch self { case .legacy(let keys): keys; case .fields(let fields): fields.keys.sorted() }
    }
}

struct ResourceInputField: Codable, Sendable {
    let type: String
    let required: Bool?
    let minLength: Int?
    let maxLength: Int?
    let `enum`: [String]?
    let minimum: Double?
    let maximum: Double?
    let minItems: Int?
    let maxItems: Int?
    let maxProperties: Int?
}

struct PostRequestReview: Decodable, Identifiable, Sendable {
    var id: String { requestHash }
    let request: RegisterAPIRequest.HTTPRequest
    let requestHash: String
    let requestInputs: RegisterAPIRequest.Inputs?
    let paymentSent: Bool
    var policyDescription: String? {
        requestInputs?.description
    }
}

struct ResourcePrepareRequest: Encodable {
    let kind: String
    var discovery: ResourceDiscoveryRequest? = nil
    var resourceId: String? = nil
    var sample: ResourceRequestSample? = nil
}
