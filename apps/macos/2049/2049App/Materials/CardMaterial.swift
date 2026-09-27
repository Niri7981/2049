import SwiftUI

struct CardMaterial: View {
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.colorSchemeContrast) private var contrast

    private let shape = RoundedRectangle(cornerRadius: 30, style: .continuous)

    var body: some View {
        shape
            .fill(.regularMaterial)
            .overlay {
                shape.fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.985, green: 0.982, blue: 0.978).opacity(reduceTransparency ? 1 : 0.96),
                            Color(red: 0.963, green: 0.962, blue: 0.964).opacity(reduceTransparency ? 1 : 0.94)
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            }
            .overlay {
                shape.strokeBorder(.white.opacity(0.8), lineWidth: 1)
            }
            .overlay {
                shape.strokeBorder(.black.opacity(contrast == .increased ? 0.3 : 0.16), lineWidth: 1)
            }
    }
}
