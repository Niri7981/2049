import SwiftUI

/// Native management confirmation. The backend independently binds the returned hash.
struct PostRequestApprovalView: View {
    let review: PostRequestReview
    let grantSummary: String?
    let onApprove: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(grantSummary == nil ? "Send this discovery POST?" : "Authorize this POST resource?")
                .font(.title2)
                .accessibilityAddTraits(.isHeader)
            Text("This request may change the merchant’s data even without payment.")
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text("\(review.request.method) \(review.request.url)")
                    ForEach(review.request.headers.keys.sorted(), id: \.self) { key in
                        Text("\(key): \(review.request.headers[key] ?? "")")
                    }
                    Text(review.request.body ?? "No body")
                    if let grantSummary {
                        Text(grantSummary)
                        Text("The Grant also permits future POST requests that satisfy this resource’s fixed fields and input policy:")
                        Text(review.policyDescription ?? "Fixed request only")
                    }
                }
                .font(.callout)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            Text(grantSummary == nil
                ? "This confirms one discovery request. It does not authorize payment."
                : "The sample quote is unpaid. Future payments still require this Grant, Daily Authority and all payment checks.")
                .font(.callout)
            HStack {
                Button("Cancel", role: .cancel, action: onCancel).keyboardShortcut(.cancelAction)
                Spacer()
                Button(grantSummary == nil ? "Send POST" : "Approve POST and create Grant", action: onApprove)
                    .keyboardShortcut(.defaultAction)
                    .accessibilityIdentifier("resource.post.approve")
            }
        }
        .padding(24)
        .frame(width: 360, height: 480)
    }
}
