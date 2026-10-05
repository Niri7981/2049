import SwiftUI

struct BackFlipButton: View {
    let action: () -> Void

    var body: some View {
        Button("Flip Agent Card", systemImage: "arrow.left.arrow.right", action: action)
            .labelStyle(.iconOnly)
            .font(.system(size: 23, weight: .light))
            .frame(width: 34, height: 34)
            .buttonStyle(CardIconButtonStyle())
    }
}
