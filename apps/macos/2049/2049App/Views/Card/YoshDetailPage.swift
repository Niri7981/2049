import SwiftUI

struct YoshDetailPage<Content: View>: View {
    let isActive: Bool
    let isAncestor: Bool
    let isRoot: Bool
    let entering: Bool
    let animated: Bool
    let reduceMotion: Bool
    @ViewBuilder let content: () -> Content

    @State private var appeared = false

    private struct Pose: Equatable {
        let scale: CGFloat
        let translation: CGFloat
        let angle: Double
        let opacity: Double
    }

    private var atRest: Bool { isActive && (isRoot || appeared) }
    private var visible: Bool { atRest || isAncestor }
    private var widthScale: CGFloat {
        reduceMotion || atRest ? 1 : isAncestor
            ? YoshTabMotion.Detail.parentWidthScale : YoshTabMotion.Detail.forwardWidthScale
    }
    private var travel: CGFloat {
        reduceMotion || atRest ? 0 : isAncestor
            ? YoshTabMotion.Detail.parentTravel : YoshTabMotion.Detail.forwardTravel
    }
    private var turn: Double {
        reduceMotion || atRest ? 0 : isAncestor
            ? YoshTabMotion.Detail.parentTurn : YoshTabMotion.Detail.forwardTurn
    }

    var body: some View {
        let pose = Pose(scale: widthScale, translation: travel, angle: turn,
            opacity: reduceMotion ? (atRest ? 1 : 0) : (visible ? 1 : 0))
        return content()
            // Cancel only the navigation transaction at the content boundary. Fields,
            // refreshes and labels keep their original transactions on other updates.
            .transaction(value: pose) { $0.animation = nil }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            // Opaque flat content separates the two surfaces without another card/material.
            .background {
                if !isRoot {
                    LinearGradient(colors: [Color(red: 0.985, green: 0.982, blue: 0.978),
                        Color(red: 0.963, green: 0.962, blue: 0.964)],
                        startPoint: .topLeading, endPoint: .bottomTrailing)
                        // Turn the flat backing only. Embedded AppKit controls remain
                        // in an affine plane with live focus and scroll geometry.
                        .rotation3DEffect(.degrees(pose.angle), axis: (x: 0, y: 1, z: 0),
                            anchor: .leading, perspective: YoshTabMotion.Detail.perspective)
                }
            }
            // Retained lazy ledgers must not choose a new scroll anchor as planes move.
            .transaction { $0.scrollContentOffsetAdjustmentBehavior = .disabled }
            // Keep height fixed: native scroll views must not resize during the turn.
            .scaleEffect(x: pose.scale, y: 1, anchor: .leading)
            .offset(x: pose.translation)
            .opacity(pose.opacity)
            .animation(animated ? YoshTabMotion.Detail.animation(entering: entering,
                reduceMotion: reduceMotion) : nil, value: pose)
            // Logical selection gates interaction before the render animation can settle.
            .disabled(!isActive)
            .allowsHitTesting(isActive)
            .accessibilityHidden(!isActive)
            .onAppear { appeared = true }
    }
}
