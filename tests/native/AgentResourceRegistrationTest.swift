import Foundation

/// Decode the shared registry projection and prefilled samples; no service or spending is started.
@main
struct AgentResourceRegistrationTest {
    static func main() throws {
        let payload = #"""
        {"resourceId":"generic-price","providerId":"example.com","name":"Generic price",
         "url":"https://example.com/price","method":"GET","network":"solana:mainnet",
         "assetId":"USDC-mint","source":"agent","state":"ACTIVE",
         "definition":{"request":{"url":"https://example.com/price","method":"GET","access":"https","headers":{"accept":"application/json"}},
           "requestInputs":{"query":{"coins":{"type":"string","required":true},"currency":{"type":"string","required":false}}},
           "deliveryRecovery":{"kind":"none"},"deliveryPolicy":{"format":"json","mimeTypes":["application/json"],"maxBytes":262144}},
         "submission":{"cardMemberId":"agent-id","discoveryId":"discovery-id","discoveredAt":1000,
           "sample":{"query":{"coins":"SOL","currency":"usd"}},
           "documentation":{"urls":["https://example.com/docs"],"uncertainties":["Recovery is unverified."]}}}
        """#
        let api = try JSONDecoder().decode(RegisteredAPI.self, from: Data(payload.utf8))
        precondition(api.isUserAdded && api.sourceLabel == "Agent-submitted")
        precondition(api.definition.requestInputs?.query?.names == ["coins", "currency"])
        precondition(api.submission?.sample.queryText == #"{"coins":"SOL","currency":"usd"}"#)
        precondition(api.submission?.sample.bodyText == "")
        precondition(api.submission?.documentation.uncertainties == ["Recovery is unverified."])
        precondition(api.definition.deliveryPolicy?.maxBytes == 262144)
        guard var legacy = try JSONSerialization.jsonObject(with: Data(payload.utf8)) as? [String: Any] else { preconditionFailure("Invalid fixture") }
        legacy.removeValue(forKey: "submission"); legacy["source"] = "user"
        let old = try JSONDecoder().decode(RegisteredAPI.self, from: JSONSerialization.data(withJSONObject: legacy))
        precondition(old.submission == nil && old.sourceLabel == "Added")
        print("Agent resource provenance, input descriptors, delivery limits and sample decoding passed; legacy user resources remain readable.")
    }
}
