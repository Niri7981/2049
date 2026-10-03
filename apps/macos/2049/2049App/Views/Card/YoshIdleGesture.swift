import SwiftUI

/// Short, finite gestures. Each native keyframe timeline ends at the unchanged resting shape.
struct YoshIdleGesture {
    enum Kind: CaseIterable, Hashable { case rise, lean, breathe, glance, blink }

    struct Values: Equatable {
        var horizontal: CGFloat = 0
        var vertical: CGFloat = 0
        var lean: CGFloat = 0
        var squash: CGFloat = 0
        var hoodLift: CGFloat = 0
        var bodyLean: CGFloat = 0
        var sideTip: CGFloat = 0
        var clothSway: CGFloat = 0
        var clothLift: CGFloat = 0
        var blink: CGFloat = 0
        var glance: CGFloat = 0

        static let rest = Self()

        func eyeClosure(focused: Bool) -> CGFloat { focused ? 1 : blink }
    }

    enum Timing {
        static let idleGestureDuration = 0.58...0.86
        // Share the cadence in both eye states; focus must not introduce another wait.
        static let idlePause = 0.45...1.0
        static let clothDelay = 0.11
        static let sideDelay = 0.065
        static let focusResponse = 0.35
        static let focusDamping = 0.96
    }

    static let idleIntensity: CGFloat = 1.5

    let kind: Kind
    let duration: Double
    let intensity: CGFloat
    let direction: CGFloat

    static func choose(after previous: Kind?,
                       using random: inout some RandomNumberGenerator) -> Self {
        let choices = Kind.allCases.filter { $0 != previous }
        let kind = choices[Int.random(in: 0..<choices.count, using: &random)]
        return Self(kind: kind, duration: Double.random(in: Timing.idleGestureDuration, using: &random),
            intensity: CGFloat.random(in: 0.85...1.05, using: &random)
                * idleIntensity,
            direction: Bool.random(using: &random) ? 1 : -1)
    }

    static func pause(using random: inout some RandomNumberGenerator) -> Double {
        Double.random(in: Timing.idlePause, using: &random)
    }

    var target: Values {
        var value = Values.rest
        switch kind {
        case .rise:
            value.vertical = -3 * intensity
            value.hoodLift = 8.5 * intensity
            value.squash = 0.014 * intensity
            value.clothLift = 7 * intensity
            value.sideTip = 4.5 * intensity
        case .lean:
            value.horizontal = 3.8 * direction * intensity
            value.lean = 1.5 * direction * intensity
            value.bodyLean = 6 * direction * intensity
            value.squash = -0.012 * intensity
            value.clothSway = -2.8 * direction * intensity
            value.sideTip = 3.5 * direction * intensity
        case .breathe:
            value.vertical = 0.6 * intensity
            value.squash = -0.030 * intensity
            value.clothLift = 4 * intensity
            value.sideTip = 2.5 * intensity
        case .glance:
            value.horizontal = 1.5 * direction * intensity
            value.bodyLean = 4 * direction * intensity
            value.hoodLift = 2 * intensity
            value.squash = -0.01 * intensity
            value.glance = 4 * direction * intensity
            value.clothSway = -0.7 * direction * intensity
        case .blink:
            value.vertical = 0.75 * intensity
            value.squash = -0.016 * intensity
            value.clothLift = 2.5 * intensity
            value.sideTip = 1.2 * intensity
            value.blink = 1
        }
        return value
    }

    var timeline: KeyframeTimeline<Values> {
        KeyframeTimeline(initialValue: Values.rest) {
            KeyframeTrack(\.horizontal) { bodyTrack(target.horizontal) }
            KeyframeTrack(\.vertical) { bodyTrack(target.vertical) }
            KeyframeTrack(\.lean) { bodyTrack(target.lean) }
            KeyframeTrack(\.squash) { bodyTrack(target.squash) }
            KeyframeTrack(\.bodyLean) { bodyTrack(target.bodyLean) }
            KeyframeTrack(\.hoodLift) {
                CubicKeyframe(target.hoodLift, duration: duration * 0.18, startVelocity: 0, endVelocity: 0)
                SpringKeyframe(0, duration: duration * 0.44,
                    spring: Spring(duration: duration * 0.4, bounce: 0.02))
                CubicKeyframe(0, duration: duration * 0.06, endVelocity: 0)
            }
            KeyframeTrack(\.glance) { bodyTrack(target.glance) }
            KeyframeTrack(\.sideTip) { clothTrack(target.sideTip, delay: Timing.sideDelay) }
            KeyframeTrack(\.clothSway) { clothTrack(target.clothSway) }
            KeyframeTrack(\.clothLift) { clothTrack(target.clothLift) }
            KeyframeTrack(\.blink) {
                LinearKeyframe(0, duration: 0.06)
                CubicKeyframe(target.blink, duration: 0.07, startVelocity: 0, endVelocity: 0)
                CubicKeyframe(0, duration: 0.12, startVelocity: 0, endVelocity: 0)
            }
        }
    }

    @KeyframeTrackContentBuilder<CGFloat>
    private func bodyTrack(_ target: CGFloat) -> some KeyframeTrackContent<CGFloat> {
        CubicKeyframe(target, duration: duration * 0.22, startVelocity: 0, endVelocity: 0)
        SpringKeyframe(0, duration: duration * 0.50,
            spring: Spring(duration: duration * 0.46, bounce: 0.02))
        CubicKeyframe(0, duration: duration * 0.06, endVelocity: 0)
    }

    @KeyframeTrackContentBuilder<CGFloat>
    private func clothTrack(_ target: CGFloat, delay: Double = Timing.clothDelay) -> some KeyframeTrackContent<CGFloat> {
        LinearKeyframe(0, duration: delay)
        CubicKeyframe(target, duration: duration * 0.22, startVelocity: 0, endVelocity: 0)
        SpringKeyframe(0, duration: duration * 0.72 - delay,
            spring: Spring(duration: duration * 0.64, bounce: 0.04))
        // A spring approaches zero; this short tail reaches it with zero final velocity.
        CubicKeyframe(0, duration: duration * 0.06, endVelocity: 0)
    }
}
