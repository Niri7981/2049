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

    enum Connection {
        static let acknowledgementDuration = 0.06
        static let entryLead = 0.04
        static let entryTravel = 0.23
        static let exitLead = 0.03
        static let exitTravel = 0.16
        static let exitSettle = 0.07
        static let textDuration = 0.10
        static let reducedDuration = 0.10
        static let connectedDuration = 0.12
        static let waitingEndpoint: CGFloat = 0.5
        static let idleNodeOpacity = 0.55
        static let waitingNodeTint = 0.55
        static let pressOpacity = 0.68
        static let pressScale: CGFloat = 0.985

        static func physical(_ duration: Double) -> Animation {
            .smooth(duration: duration, extraBounce: 0)
        }
        static var text: Animation { .easeOut(duration: textDuration) }
        static var reduced: Animation { .easeOut(duration: reducedDuration) }
        static var connected: Animation { .easeOut(duration: connectedDuration) }
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
