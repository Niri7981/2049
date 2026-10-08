import SwiftUI

struct RegisteredAPIsView: View {
    let client: OverviewClient
    let isActive: Bool
    let onBack: () -> Void
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var navigation = YoshDetailNavigation<Route>()
    @State private var resources: [RegisteredAPI] = []
    @State private var error: String?
    @State private var saving = false
    @State private var removal: String?
    private enum Route: Hashable { case add, inspect(String) }

    var body: some View {
        YoshDetailStack(navigation: navigation, reduceMotion: reduceMotion) {
            page("Registered APIs", back: "Settings", action: onBack) {
                Button("Add API", systemImage: "plus") { navigation.show(.add) }
                    .accessibilityIdentifier("settings.resources.add")
                Text("Registration makes an API available for a Spend Grant. It does not authorize spending.")
                    .font(.system(size: 12)).foregroundStyle(YoshShellPalette.secondaryInk)
                ForEach(resources.filter { $0.state != "REMOVED" }) { resource in
                    SettingsRow(title: resource.name, value: resource.state == "ACTIVE" ? resource.sourceLabel : "Disabled", showsChevron: true,
                        action: { navigation.show(.inspect(resource.id)) })
                    Divider()
                }
            }
        } destination: { route in
            switch route {
            case .add:
                AddRegisteredAPIView(client: client, onBack: { navigation.show(nil) }, onAdded: {
                    Task { await reload(); navigation.show(nil) }
                })
            case .inspect(let id):
                page("API details", back: "Registered APIs", action: { navigation.show(nil) }) {
                    if let resource = resources.first(where: { $0.id == id }) {
                        detail(resource)
                    }
                }
            }
        }
        .task(id: isActive) {
            guard isActive else { return }
            await reload()
            while !Task.isCancelled {
                do { try await Task.sleep(for: .seconds(3)) } catch { return }
                if !saving { await reload() }
            }
        }
        .confirmationDialog("Remove this registered API?", isPresented: Binding(get: { removal != nil }, set: { if !$0 { removal = nil } })) {
            if let id = removal { Button("Remove API", role: .destructive) { Task { await change(id, state: "REMOVED") } } }
        } message: {
            Text("It will no longer be available for new spending. Existing purchase and grant records are kept.")
        }
    }

    private func page<Content: View>(_ title: String, back: String, action: @escaping () -> Void, @ViewBuilder content: () -> Content) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Button(back, systemImage: "chevron.left", action: action).buttonStyle(.plain).disabled(saving)
                Text(title).font(.system(size: 34, weight: .regular, design: .serif))
                content()
                if let error { Text(error).font(.system(size: 12)).foregroundStyle(.red) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 26).padding(.top, 24).padding(.bottom, 20)
        }
    }

    @ViewBuilder private func detail(_ resource: RegisteredAPI) -> some View {
        Text(resource.name).font(.headline)
        fact("Resource ID", resource.resourceId)
        fact("Provider", resource.providerId)
        fact("Source", resource.sourceLabel)
        if let submission = resource.submission {
            fact("Submitted by Agent", submission.cardMemberId)
            Text("Review this resource before creating a Spend Grant. Registration grants no spending authority.")
                .font(.system(size: 12)).foregroundStyle(YoshShellPalette.secondaryInk)
            fact("Sample query", submission.sample.queryText.isEmpty ? "None" : submission.sample.queryText)
            fact("Sample JSON body", submission.sample.bodyText.isEmpty ? "None" : submission.sample.bodyText)
            fact("Documentation supplied by Agent", submission.documentation.urls.isEmpty ? "Not supplied" : submission.documentation.urls.joined(separator: "\n"))
            if !submission.documentation.uncertainties.isEmpty {
                fact("Unconfirmed", submission.documentation.uncertainties.joined(separator: "\n"))
            }
        }
        if let inputs = resource.definition.requestInputs?.description { fact("Dynamic input policy", inputs) }
        if let request = resource.definition.request {
            if let body = request.body { fact("Fixed JSON body", body) }
            if !request.headers.isEmpty { fact("Request headers", request.headers.keys.sorted().map { "\($0): \(request.headers[$0] ?? "")" }.joined(separator: "\n")) }
        }
        if let delivery = resource.definition.deliveryPolicy {
            fact("Delivery", "\(delivery.format) · \(delivery.mimeTypes.joined(separator: ", ")) · up to \(delivery.maxBytes) bytes")
        }
        fact("Endpoint", resource.url)
        fact("Method", resource.method)
        fact("Network", "Solana Mainnet")
        fact("Asset", "Native USDC · 6 decimals")
        fact("Mint", resource.assetId)
        fact("Base price", resource.basePriceDisplay ?? "Not specified")
        fact("Maximum price", resource.maximumPriceDisplay ?? "Not specified")
        fact("Recovery", resource.definition.deliveryRecovery?.details ?? "Not declared")
        fact("Status", resource.state)
        Text("Recipient and payment requirements are checked from the live challenge when creating a Grant and purchasing.")
            .font(.system(size: 12)).foregroundStyle(YoshShellPalette.secondaryInk)
        if resource.isUserAdded && resource.state != "REMOVED" {
            if resource.state == "ACTIVE" {
                Button("Disable API") { Task { await change(resource.id, state: "DISABLED") } }.disabled(saving)
            }
            Button("Remove API", role: .destructive) { removal = resource.id }.disabled(saving)
        } else if !resource.isUserAdded {
            Text("Built-in API · read-only").font(.system(size: 12)).foregroundStyle(YoshShellPalette.secondaryInk)
        }
    }

    private func fact(_ title: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 11)).foregroundStyle(YoshShellPalette.secondaryInk)
            Text(value).font(.system(size: 13)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
        }
    }

    @MainActor private func reload() async {
        do { resources = try await client.loadRegisteredAPIs(); error = nil }
        catch is CancellationError { return }
        catch { self.error = (error as? OverviewLoadError)?.message ?? "Registered APIs unavailable" }
    }

    @MainActor private func change(_ id: String, state: String) async {
        saving = true
        defer { saving = false }
        do {
            _ = try await client.setResourceState(id, state: state)
            await reload()
            if state == "REMOVED" { navigation.show(nil) }
        } catch { self.error = (error as? OverviewLoadError)?.message ?? "API change could not be confirmed" }
    }
}

private struct AddRegisteredAPIView: View {
    let client: OverviewClient
    let onBack: () -> Void
    let onAdded: () -> Void
    @State private var name = ""
    @State private var provider = ""
    @State private var resourceID = ""
    @State private var url = ""
    @State private var method = "GET"
    @State private var maximum = ""
    @State private var base = ""
    @State private var recovery = "none"
    @State private var fixedBody = ""
    @State private var queryFields = ""
    @State private var bodyFields = ""
    @State private var sampleQuery = ""
    @State private var sampleBody = ""
    @State private var deliveryFormat = "json"
    @State private var deliveryMIME = "application/json"
    @State private var deliveryMaxBytes = "32768"
    @State private var postReview: PostRequestReview?
    @State private var pendingDiscovery: ResourceDiscoveryRequest?
    @State private var discovery: ResourceDiscovery?
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Button("Registered APIs", systemImage: "chevron.left", action: onBack).buttonStyle(.plain).disabled(busy)
                Text("Add API").font(.system(size: 34, weight: .regular, design: .serif))
                Text("Solana Mainnet · Native USDC").font(.system(size: 12)).foregroundStyle(YoshShellPalette.secondaryInk)
                field("Display name", text: $name)
                field("Provider", text: $provider)
                field("Stable resource ID", text: $resourceID)
                field("Exact HTTPS endpoint", text: $url)
                Picker("HTTP method", selection: $method) {
                    ForEach(["GET", "POST"], id: \.self) { Text($0).tag($0) }
                }
                field("Query input policy (JSON object)", text: $queryFields)
                Text("Example: {\"prompt\":{\"type\":\"string\",\"required\":true,\"maxLength\":300}}")
                    .font(.caption).textSelection(.enabled)
                if method == "POST" {
                    field("Body input policy (JSON object)", text: $bodyFields)
                    field("Fixed JSON body (optional)", text: $fixedBody)
                    field("Sample JSON body object", text: $sampleBody)
                }
                field("Sample query JSON object", text: $sampleQuery)
                Button("Discover price · no payment") { Task { await discover() } }
                    .disabled(busy || url.isEmpty)
                if let discovery {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Discovered: \(discovery.basePriceDisplay ?? "Unavailable")").font(.headline)
                        Text("Mainnet USDC · \(discovery.method) · \(discovery.url)")
                        Text("Recipient: \(discovery.payTo)")
                        Text("Fee payer: \(discovery.feePayer)")
                        Text("Validity: \(discovery.maxTimeoutSeconds) seconds")
                        Text(discovery.notice)
                    }.font(.system(size: 11)).textSelection(.enabled)
                }
                field("Maximum price (USDC)", text: $maximum)
                field("Base price (USDC, optional)", text: $base)
                Picker("Delivery recovery", selection: $recovery) {
                    Text("Not supported").tag("none")
                    Text("Provider supports idempotent replay").tag("idempotent_replay")
                }
                Picker("Delivery format", selection: $deliveryFormat) {
                    Text("JSON").tag("json")
                    Text("Text").tag("text")
                }
                field("Delivery MIME type", text: $deliveryMIME)
                field("Maximum delivery bytes (1–262144)", text: $deliveryMaxBytes)
                Text("Only select replay if the provider documents it. The resource ID and policy cannot be edited after registration.")
                    .font(.system(size: 11)).foregroundStyle(YoshShellPalette.secondaryInk)
                Button(busy ? "Working…" : "Register API") { Task { await register() } }
                    .disabled(busy).accessibilityIdentifier("settings.resources.register")
                Text("You approve registration only. A Spend Grant must be created separately.")
                    .font(.system(size: 12)).foregroundStyle(YoshShellPalette.secondaryInk)
                if let error { Text(error).font(.system(size: 12)).foregroundStyle(.red) }
            }
            .disabled(busy)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 26).padding(.top, 24).padding(.bottom, 20)
        }
        .sheet(item: $postReview) { review in
            PostRequestApprovalView(review: review, grantSummary: nil, onApprove: {
                guard var input = pendingDiscovery else { return }
                input.postApprovalHash = review.requestHash
                pendingDiscovery = nil; postReview = nil
                Task { await sendDiscovery(input) }
            }, onCancel: { pendingDiscovery = nil; postReview = nil })
        }
        .onChange(of: url) { _, _ in discovery = nil }
        .onChange(of: method) { _, _ in discovery = nil }
        .onChange(of: deliveryFormat) { _, newValue in
            deliveryMIME = newValue == "text" ? "text/plain" : "application/json"
        }
    }

    private func field(_ title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.system(size: 11)).foregroundStyle(YoshShellPalette.secondaryInk)
            TextField(title, text: text).labelsHidden().textFieldStyle(.roundedBorder)
        }
    }

    @MainActor private func discover() async {
        busy = true; error = nil; discovery = nil
        defer { busy = false }
        do {
            let sample = try ResourceRequestSample.parse(queryText: sampleQuery, bodyText: sampleBody)
            let inputs = try requestInputs()
            let input = ResourceDiscoveryRequest(url: url, method: method,
                headers: headers, body: fixedBody.isEmpty ? nil : fixedBody,
                requestInputs: inputs, sample: sample)
            if method == "POST" {
                let review = try await client.prepareDiscovery(input)
                pendingDiscovery = input
                postReview = review
            } else { discovery = try await client.discoverAPI(input) }
        }
        catch { self.error = (error as? OverviewLoadError)?.message ?? "Price discovery unavailable" }
    }

    private var headers: [String: String] {
        method == "POST" ? ["accept": "application/json", "content-type": "application/json"] : ["accept": "application/json"]
    }

    private func requestInputs() throws -> RegisterAPIRequest.Inputs? {
        func policy(_ text: String) throws -> ResourceInputPolicy? {
            guard !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return .fields(try JSONDecoder().decode([String: ResourceInputField].self, from: Data(text.utf8)))
        }
        let query = try policy(queryFields); let body = try policy(bodyFields)
        return query == nil && body == nil ? nil : .init(query: query, jsonBody: body)
    }

    @MainActor private func sendDiscovery(_ input: ResourceDiscoveryRequest) async {
        busy = true; error = nil
        defer { busy = false }
        do { discovery = try await client.discoverAPI(input) }
        catch { self.error = (error as? OverviewLoadError)?.message ?? "Price discovery unavailable" }
    }

    @MainActor private func register() async {
        guard let maxAmount = DailyAuthorityPresentation.minorUnits(maximum), maxAmount != "0",
              let maxDelivery = Int(deliveryMaxBytes), (1...262_144).contains(maxDelivery),
              base.isEmpty || DailyAuthorityPresentation.minorUnits(base) != nil else {
            error = "Enter valid USDC prices and a delivery byte limit."; return
        }
        busy = true; error = nil
        defer { busy = false }
        do {
            if !fixedBody.isEmpty { _ = try JSONDecoder().decode([String: ResourceJSONValue].self, from: Data(fixedBody.utf8)) }
            _ = try await client.registerAPI(RegisterAPIRequest(resourceId: resourceID, providerId: provider, displayName: name,
                request: .init(url: url, method: method, headers: headers, body: fixedBody.isEmpty ? nil : fixedBody),
                baseAmount: base.isEmpty ? nil : DailyAuthorityPresentation.minorUnits(base),
                maximumAmount: maxAmount, deliveryRecovery: .init(kind: recovery),
                deliveryPolicy: .init(format: deliveryFormat, mimeTypes: [deliveryMIME.lowercased()], maxBytes: maxDelivery),
                requestInputs: try requestInputs()))
            onAdded()
        } catch { self.error = (error as? OverviewLoadError)?.message ?? "API registration could not be confirmed" }
    }
}
