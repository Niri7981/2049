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

        // Trace the canonical 1254px icon directly. Fit it uniformly inside the
        // existing drawing bounds so its wider, buoyant proportions are preserved.
        func iconPoint(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            let scale: CGFloat = 244 / 670
            return point((x - 280) * scale, 42 + (y - 266) * scale * 360 / 350)
        }

        var path = Path()
        switch layer {
        case .silhouette:
            path.move(to: iconPoint(829, 266))
            path.addCurve(to: iconPoint(949, 437), control1: iconPoint(915, 263), control2: iconPoint(948, 333))
            path.addCurve(to: iconPoint(914, 633), control1: iconPoint(953, 502), control2: iconPoint(930, 572))
            path.addCurve(to: iconPoint(878, 831), control1: iconPoint(899, 702), control2: iconPoint(899, 770))
            path.addCurve(to: iconPoint(669, 1003), control1: iconPoint(847, 918), control2: iconPoint(761, 978))
            path.addCurve(to: iconPoint(657, 994), control1: iconPoint(658, 1007), control2: iconPoint(652, 1007))
            path.addCurve(to: iconPoint(686, 900), control1: iconPoint(671, 966), control2: iconPoint(678, 937))
            path.addCurve(to: iconPoint(420, 998), control1: iconPoint(626, 955), control2: iconPoint(489, 998))
            path.addCurve(to: iconPoint(410, 989), control1: iconPoint(407, 999), control2: iconPoint(404, 996))
            path.addCurve(to: iconPoint(520, 742), control1: iconPoint(496, 912), control2: iconPoint(503, 845))
            path.addCurve(to: iconPoint(296, 813), control1: iconPoint(474, 780), control2: iconPoint(356, 815))
            path.addCurve(to: iconPoint(284, 804), control1: iconPoint(280, 814), control2: iconPoint(277, 810))
            path.addCurve(to: iconPoint(445, 562), control1: iconPoint(338, 763), control2: iconPoint(392, 640))
            path.addCurve(to: iconPoint(613, 355), control1: iconPoint(499, 482), control2: iconPoint(544, 408))
            path.addCurve(to: iconPoint(829, 266), control1: iconPoint(684, 300), control2: iconPoint(759, 266))
        case .leftFold:
            path.move(to: iconPoint(296, 813))
            path.addCurve(to: iconPoint(520, 742), control1: iconPoint(356, 815), control2: iconPoint(474, 780))
            path.addCurve(to: iconPoint(514, 761), control1: iconPoint(518, 748), control2: iconPoint(516, 755))
            path.addCurve(to: iconPoint(296, 813), control1: iconPoint(459, 792), control2: iconPoint(351, 815))
        case .rearFold:
            path.move(to: iconPoint(520, 742))
            path.addCurve(to: iconPoint(410, 989), control1: iconPoint(503, 845), control2: iconPoint(496, 912))
            path.addCurve(to: iconPoint(420, 998), control1: iconPoint(404, 996), control2: iconPoint(407, 999))
            path.addCurve(to: iconPoint(686, 900), control1: iconPoint(489, 998), control2: iconPoint(626, 955))
            path.addCurve(to: iconPoint(520, 742), control1: iconPoint(641, 873), control2: iconPoint(562, 785))
        case .rightFold:
            path.move(to: iconPoint(914, 633))
            path.addCurve(to: iconPoint(878, 831), control1: iconPoint(899, 702), control2: iconPoint(899, 770))
            path.addCurve(to: iconPoint(669, 1003), control1: iconPoint(847, 918), control2: iconPoint(761, 978))
            path.addCurve(to: iconPoint(853, 823), control1: iconPoint(764, 962), control2: iconPoint(827, 901))
            path.addCurve(to: iconPoint(914, 633), control1: iconPoint(877, 754), control2: iconPoint(894, 686))
        case .frontFold:
            path.move(to: iconPoint(802, 297))
            path.addCurve(to: iconPoint(686, 900), control1: iconPoint(717, 443), control2: iconPoint(724, 727))
            path.addCurve(to: iconPoint(657, 994), control1: iconPoint(678, 937), control2: iconPoint(671, 966))
            path.addCurve(to: iconPoint(669, 1003), control1: iconPoint(652, 1007), control2: iconPoint(658, 1007))
            path.addCurve(to: iconPoint(878, 831), control1: iconPoint(761, 978), control2: iconPoint(847, 918))
            path.addCurve(to: iconPoint(923, 449), control1: iconPoint(909, 750), control2: iconPoint(938, 539))
            path.addCurve(to: iconPoint(802, 297), control1: iconPoint(922, 341), control2: iconPoint(875, 293))
        }
        path.closeSubpath()
        return path
    }
}
