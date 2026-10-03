import SwiftUI

/// Only top-level navigation uses these values; page internals keep their own transactions.
enum YoshTabMotion {
    static let travel: CGFloat = 18
    static let recededScale: CGFloat = 0.988
    static let indicatorResponse = 0.30
    static let indicatorDamping = 0.88
    static let entryResponse = 0.30
    static let exitResponse = 0.22
    static let pageDamping = 1.0
    static let entryOpacityDuration = 0.10
    static let exitOpacityDuration = 0.08
    static let reducedDuration = 0.12

    static var indicatorSpring: Animation {
        .interactiveSpring(response: indicatorResponse, dampingFraction: indicatorDamping)
    }

    static func pageSpring(isActive: Bool) -> Animation {
        .interactiveSpring(response: isActive ? entryResponse : exitResponse,
            dampingFraction: pageDamping)
    }

    static func opacityAnimation(isActive: Bool, reduceMotion: Bool) -> Animation {
        .easeOut(duration: reduceMotion ? reducedDuration
            : isActive ? entryOpacityDuration : exitOpacityDuration)
    }

    static func side(of page: BackSection, relativeTo selection: BackSection) -> CGFloat {
        page == selection ? 0 : page.rawValue < selection.rawValue ? -1 : 1
    }
}
