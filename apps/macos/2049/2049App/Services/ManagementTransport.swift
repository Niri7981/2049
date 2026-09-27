import CFNetwork
import Foundation

enum ServiceEndpoint {
    case health
    case overview
    case prepareQuit

    var path: String {
        switch self {
        case .health: "/api/app/health"
        case .overview: "/api/app/overview"
        case .prepareQuit: "/api/app/lifecycle"
        }
    }

    var isMutation: Bool { self == .prepareQuit }
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
            request.httpMethod = "POST"
            request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = Data(#"{"action":"prepareQuit"}"#.utf8)
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
