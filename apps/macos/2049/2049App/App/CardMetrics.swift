import CoreGraphics

enum CardMetrics {
    static let cardSize = CGSize(width: 420, height: 684)
    static let windowInset: CGFloat = 12

    static var windowSize: CGSize {
        CGSize(
            width: cardSize.width + windowInset * 2,
            height: cardSize.height + windowInset * 2
        )
    }
}
