import SwiftUI

struct YoshSpiritView: View {
    enum Posture: Hashable {
        case idle, protective

        var eyeClosure: CGFloat { self == .protective ? 1 : 0 }
    }

    let posture: Posture

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var playback: Playback?

    var body: some View {
        Drawing(protection: posture.eyeClosure, focused: posture == .protective,
            playback: playback, reduceMotion: reduceMotion)
            .animation(reduceMotion ? nil : .interactiveSpring(
                response: YoshIdleGesture.Timing.focusResponse,
                dampingFraction: YoshIdleGesture.Timing.focusDamping), value: posture)
            .accessibilityHidden(true)
            // Eye focus changes presentation, never the body's ongoing gesture or pause.
            .task(id: reduceMotion) { await performGestures() }
    }

    private struct Playback {
        let timeline: KeyframeTimeline<YoshIdleGesture.Values>
        let startedAt: Date

        func values(at date: Date) -> YoshIdleGesture.Values {
            timeline.value(time: min(timeline.duration, max(0, date.timeIntervalSince(startedAt))))
        }
    }

    private func performGestures() async {
        guard !Task.isCancelled else { return }
        guard !reduceMotion else { playback = nil; return }
        var random = SystemRandomNumberGenerator()
        var previous: YoshIdleGesture.Kind?

        while !Task.isCancelled {
            let pause = YoshIdleGesture.pause(using: &random)
            guard await wait(pause) else { return }
            let gesture = YoshIdleGesture.choose(after: previous, using: &random)
            previous = gesture.kind
            let timeline = gesture.timeline
            playback = Playback(timeline: timeline, startedAt: .now)
            guard await wait(timeline.duration) else { return }
            playback = nil // Real rest: the rendering clock pauses until the next gesture.
        }
    }

    private func wait(_ seconds: Double) async -> Bool {
        do {
            try await Task.sleep(for: .seconds(seconds))
            return !Task.isCancelled
        } catch { return false }
    }

    /// Animate only posture progress. Timeline ticks cannot cancel or restart its spring.
    private struct Drawing: View, Animatable {
        var protection: CGFloat
        let focused: Bool
        let playback: Playback?
        let reduceMotion: Bool

        nonisolated var animatableData: CGFloat {
            get { protection }
            set { protection = newValue }
        }

        var body: some View {
            TimelineView(.animation(minimumInterval: 1.0 / 60, paused: reduceMotion || playback == nil)) { timeline in
                let sample = reduceMotion ? YoshIdleGesture.Values.rest : playback?.values(at: timeline.date) ?? .rest
                YoshSpiritDrawing(protection: protection, focused: focused,
                    motion: sample, reduceMotion: reduceMotion)
            }
        }
    }
}

#Preview("Yosh — eyes open") {
    YoshSpiritView(posture: .idle).background(Color(white: 0.93))
}

#Preview("Yosh — password focused") {
    YoshSpiritView(posture: .protective).background(Color(white: 0.93))
}
