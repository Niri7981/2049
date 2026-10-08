import SwiftUI

/// Small labels sit above a shared title line; financial values retain their numeric scale.
struct CardPageHeader: View {
    enum Style {
        case hero(eyebrow: String, isAmount: Bool = false)
        case collection(subtitle: String)
    }

    enum Layout {
        static let contentInset: CGFloat = 26
        static let topSpacing: CGFloat = 44
        static let titleTopOffset: CGFloat = 20
        static let firstSectionSpacing: CGFloat = 24
        static let titleHeight: CGFloat = 66
    }

    let title: String
    let style: Style

    private let secondaryInk = YoshShellPalette.secondaryInk

    private var isAmount: Bool {
        if case .hero(_, let isAmount) = style { return isAmount }
        return false
    }

    private var smallTitle: String {
        switch style {
        case .hero(let eyebrow, _): eyebrow
        case .collection(let subtitle): subtitle
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(smallTitle)
                .font(.system(size: 10, weight: .medium))
                .tracking(2.6)
                .foregroundStyle(secondaryInk)
                .frame(height: Layout.titleTopOffset, alignment: .topLeading)

            Text(title)
                .font(.system(size: isAmount ? 74 : 56, weight: .regular, design: .serif))
                .tracking(isAmount ? -2 : -1.8)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(isAmount ? 0.5 : 0.65)
                .frame(height: isAmount ? 80 : Layout.titleHeight, alignment: .leading)
                .accessibilityAddTraits(.isHeader)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
