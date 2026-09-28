import CFNetwork
import Foundation

enum ServiceEndpoint {
    case health
    case overview
    case balance
    case setPaused(Bool)
    case setDailyLimit(String)
    case createGrant(totalLimit: String, singleLimit: String, expiresAt: Int64)
    case revokeGrant
    case setConnection(Bool)
    case members
    case member(UUID)
    case createMember(String)
    case renameMember(UUID, String)
    case revokeMember(UUID)
    case setMemberConnection(UUID, Bool)
    case createMemberGrant(UUID, totalLimit: String, singleLimit: String, expiresAt: Int64)
    case revokeMemberGrant(UUID)
    case prepareQuit

    var path: String {
        switch self {
        case .health: "/api/app/health"
        case .overview: "/api/app/overview"
        case .balance: "/api/app/balance"
        case .setPaused, .setDailyLimit: "/api/app/settings"
        case .createGrant, .revokeGrant: "/api/app/grant"
        case .setConnection: "/api/app/connection"
        case .members, .createMember: "/api/app/members"
        case .member(let id), .renameMember(let id, _), .revokeMember(let id): "/api/app/members/\(id.uuidString.lowercased())"
        case .setMemberConnection(let id, _): "/api/app/members/\(id.uuidString.lowercased())/connection"
        case .createMemberGrant(let id, _, _, _), .revokeMemberGrant(let id): "/api/app/members/\(id.uuidString.lowercased())/grant"
        case .prepareQuit: "/api/app/lifecycle"
        }
    }

    var isMutation: Bool {
        switch self {
        case .health, .overview, .balance, .members, .member: false
        case .setPaused, .setDailyLimit, .createGrant, .revokeGrant, .setConnection, .createMember,
             .renameMember, .revokeMember, .setMemberConnection, .createMemberGrant, .revokeMemberGrant, .prepareQuit: true
        }
    }

    var method: String {
        switch self {
        case .setPaused, .setDailyLimit, .createGrant, .revokeGrant, .setConnection,
             .renameMember, .setMemberConnection, .createMemberGrant, .revokeMemberGrant: "PUT"
        case .createMember: "POST"
        case .revokeMember: "DELETE"
        case .prepareQuit: "POST"
        case .health, .overview, .balance, .members, .member: "GET"
        }
    }

    func body() throws -> Data? {
        switch self {
        case .setPaused(let paused):
            try JSONEncoder().encode(["paused": paused])
        case .setDailyLimit(let limit):
            try JSONEncoder().encode(["dailyLimit": limit])
        case .createGrant(let totalLimit, let singleLimit, let expiresAt):
            try JSONEncoder().encode(GrantCreateRequest(totalLimit: totalLimit, singleLimit: singleLimit, expiresAt: expiresAt))
        case .revokeGrant:
            Data(#"{"action":"revoke"}"#.utf8)
        case .setConnection(let enabled):
            try JSONEncoder().encode(["enabled": enabled])
        case .createMember(let label), .renameMember(_, let label):
            try JSONEncoder().encode(["label": label])
        case .setMemberConnection(_, let enabled):
            try JSONEncoder().encode(["enabled": enabled])
        case .createMemberGrant(_, let totalLimit, let singleLimit, let expiresAt):
            try JSONEncoder().encode(GrantCreateRequest(totalLimit: totalLimit, singleLimit: singleLimit, expiresAt: expiresAt))
        case .revokeMemberGrant:
            Data(#"{"action":"revoke"}"#.utf8)
        case .prepareQuit:
            Data(#"{"action":"prepareQuit"}"#.utf8)
        case .health, .overview, .balance, .members, .member, .revokeMember:
            nil
        }
    }
}

private struct GrantCreateRequest: Encodable {
    let action = "create"
    let totalLimit: String
    let singleLimit: String
    let expiresAt: Int64
}

private final class NoServiceRedirects: NSObject, URLSessionTaskDelegate, @unchecked Sendable {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        completionHandler(nil)
    }
}

struct ServiceConfiguration: Sendable {
    let baseURL: URL
    private let managementToken: String

    init(baseURL: URL, managementToken: String) {
        self.baseURL = baseURL
        self.managementToken = managementToken
    }

    private static let session: URLSession = {
        let settings = URLSessionConfiguration.ephemeral
        settings.httpShouldSetCookies = false
        // Management credentials must go directly to loopback, never through a system proxy.
        settings.connectionProxyDictionary = [
            kCFNetworkProxiesHTTPEnable as NSString: 0,
            kCFNetworkProxiesHTTPSEnable as NSString: 0,
            kCFNetworkProxiesSOCKSEnable as NSString: 0,
            kCFNetworkProxiesProxyAutoConfigEnable as NSString: 0,
        ]
        return URLSession(configuration: settings, delegate: NoServiceRedirects(), delegateQueue: nil)
    }()

    func request(_ endpoint: ServiceEndpoint, timeout: TimeInterval = 12) async throws -> (Data, HTTPURLResponse) {
        var request = URLRequest(url: baseURL.appending(path: endpoint.path), cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        request.setValue("Bearer \(managementToken)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if endpoint.isMutation {
            request.httpMethod = endpoint.method
            request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try endpoint.body()
        }
        do {
            let (data, response) = try await Self.session.data(for: request)
            guard let response = response as? HTTPURLResponse else { throw ServiceRuntimeError.unavailable }
            return (data, response)
        } catch {
            if Task.isCancelled { throw CancellationError() }
            throw ServiceRuntimeError.unavailable
        }
    }
}
