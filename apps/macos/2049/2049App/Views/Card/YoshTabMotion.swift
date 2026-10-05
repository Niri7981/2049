import SwiftUI

/// Shared Yosh motion constants; each surface owns its animation transactions.
enum YoshTabMotion {
    static let travel: CGFloat = 18
    static let recededWidthScale: CGFloat = 0.988
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

    enum Expiry {
        static let reducedDuration = 0.10
        static var expansion: Animation { .smooth(duration: 0.20, extraBounce: 0) }
        static var selection: Animation { .smooth(duration: 0.16, extraBounce: 0) }
    }

    enum Detail {
        static let parentTravel: CGFloat = -10
        static let forwardTravel: CGFloat = 34
        static let parentWidthScale: CGFloat = 0.978
        // Grow toward the resting plane while keeping parked native viewports no wider
        // than their final layout.
        static let forwardWidthScale: CGFloat = 0.994
        static let parentTurn = -1.4
        static let forwardTurn = 1.8
        static let perspective: CGFloat = 0.25
        static let entryDuration = 0.28
        static let exitDuration = 0.20
        static let reducedDuration = 0.12

        static func animation(entering: Bool, reduceMotion: Bool) -> Animation {
            reduceMotion ? .easeOut(duration: reducedDuration)
                : .smooth(duration: entering ? entryDuration : exitDuration, extraBounce: 0)
        }
    }
}
