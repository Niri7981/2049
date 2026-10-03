import SwiftUI

/// All folds share the reference's 244 × 360 coordinate space, so they deform together.
struct YoshClothShape: Shape {
    enum Layer { case silhouette, leftFold, rearFold, rightFold, frontFold }

    static let gatherFraction: CGFloat = 0.035
    static let swayAmplitude: CGFloat = 2.2
    static let hoodInset: CGFloat = 3
    static let hemLift: CGFloat = 5

    var protection: CGFloat = 0
    var sway: CGFloat = 0
    var tailLift: CGFloat = 0
    var squash: CGFloat = 0
    var hoodLift: CGFloat = 0
    var bodyLean: CGFloat = 0
    var sideTip: CGFloat = 0
    var layer: Layer = .silhouette

    typealias AnimatableData = AnimatablePair<AnimatablePair<CGFloat, CGFloat>,
        AnimatablePair<AnimatablePair<CGFloat, CGFloat>,
            AnimatablePair<CGFloat, AnimatablePair<CGFloat, CGFloat>>>>

    var animatableData: AnimatableData {
        get { AnimatablePair(AnimatablePair(protection, squash),
            AnimatablePair(AnimatablePair(sway, tailLift), AnimatablePair(hoodLift, AnimatablePair(bodyLean, sideTip)))) }
        set {
            protection = newValue.first.first
            squash = newValue.first.second
            sway = newValue.second.first.first
            tailLift = newValue.second.first.second
            hoodLift = newValue.second.second.first
            bodyLean = newValue.second.second.second.first
            sideTip = newValue.second.second.second.second
        }
    }

    /// Shared by cloth and eyes. The hood leads; the side tip and hem respond locally.
    /// Zero gesture values leave every approved Bézier coordinate unchanged.
    func motionOffset(at point: CGPoint) -> CGSize {
        let lower = point.y / 360
        let upper = 1 - lower
        let side = max(0, 1 - point.x / 100) * max(0, 1 - abs(point.y - 190) / 95)
        return CGSize(
            width: bodyLean * upper * upper + sway * lower * lower * Self.swayAmplitude
                - (point.x - 164) * squash * 0.55,
            height: -hoodLift * upper * upper + (point.y - 220) * squash
                + tailLift * lower * lower * lower + sideTip * side
        )
    }

    func path(in rect: CGRect) -> Path {
        // Deform the cloth, rather than scaling the whole mascot. The hood barely moves;
        // the lower folds settle inward while the original tall footprint stays intact.
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            let lowerCloth = y / 360
            let inward = (164 - x) * Self.gatherFraction * protection
            let motion = motionOffset(at: CGPoint(x: x, y: y))
            return CGPoint(
                x: rect.minX + (x + inward + motion.width) / 244 * rect.width,
                y: rect.minY + (y + protection * (Self.hoodInset - lowerCloth * Self.hemLift)
                    + motion.height) / 360 * rect.height
            )
        }

        var path = Path()
        switch layer {
        case .silhouette:
            path.move(to: point(188, 2))
            path.addCurve(to: point(237, 64), control1: point(227, -3), control2: point(238, 28))
            path.addCurve(to: point(234, 180), control1: point(247, 100), control2: point(232, 144))
            path.addCurve(to: point(242, 260), control1: point(234, 211), control2: point(248, 237))
            path.addCurve(to: point(204, 323), control1: point(243, 292), control2: point(229, 314))
            path.addCurve(to: point(198, 278), control1: point(204, 310), control2: point(204, 293))
            path.addCurve(to: point(64, 358), control1: point(168, 328), control2: point(102, 358))
            path.addCurve(to: point(123, 237), control1: point(105, 333), control2: point(121, 284))
            path.addCurve(to: point(13, 288), control1: point(91, 267), control2: point(42, 292))
            path.addCurve(to: point(95, 123), control1: point(58, 235), control2: point(79, 188))
            path.addCurve(to: point(0, 190), control1: point(61, 138), control2: point(28, 165))
            path.addCurve(to: point(188, 2), control1: point(67, 121), control2: point(113, 11))
        case .leftFold:
            path.move(to: point(0, 190))
            path.addCurve(to: point(95, 123), control1: point(31, 157), control2: point(66, 135))
            path.addCurve(to: point(49, 173), control1: point(87, 146), control2: point(72, 162))
            path.addCurve(to: point(0, 190), control1: point(29, 177), control2: point(14, 185))
        case .rearFold:
            path.move(to: point(95, 123))
            path.addCurve(to: point(43, 305), control1: point(77, 183), control2: point(78, 243))
            path.addCurve(to: point(132, 232), control1: point(78, 275), control2: point(111, 253))
            path.addCurve(to: point(95, 123), control1: point(133, 183), control2: point(110, 149))
        case .rightFold:
            path.move(to: point(221, 166))
            path.addCurve(to: point(242, 260), control1: point(225, 207), control2: point(246, 230))
            path.addCurve(to: point(204, 323), control1: point(243, 292), control2: point(229, 314))
            path.addCurve(to: point(199, 278), control1: point(203, 308), control2: point(204, 290))
            path.addCurve(to: point(221, 166), control1: point(218, 242), control2: point(221, 206))
        case .frontFold:
            path.move(to: point(173, 31))
            path.addCurve(to: point(123, 237), control1: point(127, 94), control2: point(119, 173))
            path.addCurve(to: point(64, 358), control1: point(121, 289), control2: point(103, 334))
            path.addCurve(to: point(215, 221), control1: point(144, 354), control2: point(205, 296))
            path.addCurve(to: point(225, 101), control1: point(224, 178), control2: point(216, 138))
            path.addCurve(to: point(173, 31), control1: point(228, 40), control2: point(201, 15))
        }
        path.closeSubpath()
        return path
    }
}
