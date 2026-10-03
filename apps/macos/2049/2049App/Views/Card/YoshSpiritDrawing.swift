import SwiftUI

/// The approved vector drawing, separate from the gesture scheduler.
struct YoshSpiritDrawing: View {
    let protection: CGFloat
    let focused: Bool
    let motion: YoshIdleGesture.Values
    let reduceMotion: Bool

    private var pose: YoshIdleGesture.Values { reduceMotion ? .rest : motion }

    var body: some View {
        let eyeClosure = pose.eyeClosure(focused: focused)
        let glance = focused ? 0 : pose.glance
        let leftEyeMotion = cloth(.silhouette).motionOffset(at: CGPoint(x: 174, y: 68))
        let rightEyeMotion = cloth(.silhouette).motionOffset(at: CGPoint(x: 207, y: 63))

        ZStack(alignment: .top) {
            Ellipse()
                .fill(.black.opacity(0.14))
                .frame(width: 136, height: 18)
                .blur(radius: 11)
                .offset(x: 17, y: 356)

            ZStack(alignment: .topLeading) {
                cloth(.silhouette)
                    .fill(Color(red: 1, green: 0.996, blue: 0.984))
                    .shadow(color: Color(white: 0.2).opacity(0.16), radius: 12, x: -2, y: 6)
                cloth(.leftFold)
                    .fill(.black.opacity(0.065))
                cloth(.rearFold)
                    .fill(.white.opacity(0.45))
                cloth(.rightFold)
                    .fill(LinearGradient(colors: [.black.opacity(0.065), .white.opacity(0.7)],
                        startPoint: .topLeading, endPoint: .bottomTrailing))
                cloth(.frontFold)
                    .fill(LinearGradient(colors: [.white.opacity(0), .white.opacity(0.55)],
                        startPoint: .topLeading, endPoint: .bottomTrailing))

                YoshEyeShape(closure: eyeClosure)
                    .stroke(Color(white: 0.055), style: StrokeStyle(lineWidth: 4.6, lineCap: .round))
                    .frame(width: 18, height: 20)
                    .offset(x: 174 - protection * 0.7 + glance + leftEyeMotion.width,
                        y: 68 + protection * 2 + leftEyeMotion.height * 350 / 360)
                    .animation(reduceMotion ? nil : .interactiveSpring(
                        response: YoshIdleGesture.Timing.focusResponse,
                        dampingFraction: YoshIdleGesture.Timing.focusDamping), value: focused)
                YoshEyeShape(closure: eyeClosure)
                    .stroke(Color(white: 0.055), style: StrokeStyle(lineWidth: 4.6, lineCap: .round))
                    .frame(width: 16, height: 19)
                    .offset(x: 207 - protection * 2.5 + glance + rightEyeMotion.width,
                        y: 63 + protection * 2 + rightEyeMotion.height * 350 / 360)
                    .animation(reduceMotion ? nil : .interactiveSpring(
                        response: YoshIdleGesture.Timing.focusResponse,
                        dampingFraction: YoshIdleGesture.Timing.focusDamping), value: focused)
            }
            .frame(width: 244, height: 350)
            .rotationEffect(.degrees(Double(pose.lean)))
            .offset(x: pose.horizontal, y: pose.vertical + (reduceMotion ? 0 : protection * 2))
        }
        .frame(width: 260, height: 374)
        .transaction { $0.animation = nil }
    }

    private func cloth(_ layer: YoshClothShape.Layer) -> YoshClothShape {
        YoshClothShape(protection: protection, sway: pose.clothSway, tailLift: pose.clothLift,
            squash: pose.squash, hoodLift: pose.hoodLift, bodyLean: pose.bodyLean,
            sideTip: pose.sideTip, layer: layer)
    }
}
