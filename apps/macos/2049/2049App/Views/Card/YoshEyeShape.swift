import SwiftUI

/// A single continuous stroke morphs from the reference's short eye to its closed U arc.
struct YoshEyeShape: Shape {
    var closure: CGFloat

    var animatableData: CGFloat {
        get { closure }
        set { closure = newValue }
    }

    func path(in rect: CGRect) -> Path {
        let amount = min(1, max(0, closure))
        func point(_ open: CGPoint, _ closed: CGPoint) -> CGPoint {
            CGPoint(
                x: rect.minX + (open.x + (closed.x - open.x) * amount) * rect.width,
                y: rect.minY + (open.y + (closed.y - open.y) * amount) * rect.height
            )
        }
        var path = Path()
        path.move(to: point(CGPoint(x: 0.47, y: 0.12), CGPoint(x: 0.08, y: 0.44)))
        path.addCurve(
            to: point(CGPoint(x: 0.53, y: 0.88), CGPoint(x: 0.92, y: 0.44)),
            control1: point(CGPoint(x: 0.49, y: 0.36), CGPoint(x: 0.12, y: 0.96)),
            control2: point(CGPoint(x: 0.51, y: 0.64), CGPoint(x: 0.88, y: 0.96))
        )
        return path
    }
}
