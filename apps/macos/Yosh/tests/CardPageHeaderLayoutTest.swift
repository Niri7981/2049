import AppKit
import SwiftUI

/// Native header fixtures only; no live app, management requests, or payments.
@main
struct CardPageHeaderLayoutTest {
    @MainActor
    static func main() {
        NSApplication.shared.setActivationPolicy(.prohibited)
        let headers: [(String, CardPageHeader.Style)] = [
            ("$20.00", .hero(eyebrow: "REMAINING TODAY", isAmount: true)),
            ("Connected", .hero(eyebrow: "CONNECTION")),
            ("Waiting for Codex", .hero(eyebrow: "CONNECTION")),
            ("Connection Issue", .hero(eyebrow: "CONNECTION")),
            ("Agents", .collection(subtitle: "Agents share one Daily Authority.")),
            ("Settings", .collection(subtitle: "Manage Yosh on this Mac.")),
            ("Activity", .hero(eyebrow: "ACTIVITY")),
            ("$123,456,789.00", .hero(eyebrow: "REMAINING TODAY", isAmount: true)),
        ]
        var frames: [CGRect] = []
        for (title, style) in headers {
            var headerFrame = CGRect.zero
            let view = VStack(alignment: .leading, spacing: 0) {
                CardPageHeader(title: title, style: style)
                    .onGeometryChange(for: CGRect.self) { geometry in
                        geometry.frame(in: .named("page"))
                    } action: { headerFrame = $0 }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, CardPageHeader.Layout.contentInset)
            .padding(.top, CardPageHeader.Layout.topSpacing)
            .frame(width: 420, height: 526)
            .coordinateSpace(name: "page")
            let host = NSHostingView(rootView: view)
            let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 420, height: 526),
                styleMask: .borderless, backing: .buffered, defer: false)
            window.contentView = host
            window.alphaValue = 0
            window.orderFront(nil)
            host.layoutSubtreeIfNeeded()
            RunLoop.current.run(until: .now.addingTimeInterval(0.1))
            precondition(host.frame.size == NSSize(width: 420, height: 526))
            precondition(abs(headerFrame.minX - 26) < 0.5 && abs(headerFrame.minY - 44) < 0.5,
                "\(title) must begin on the shared content grid")
            precondition(abs(headerFrame.width - 368) < 0.5, "Headers must fit the current card width")
            frames.append(headerFrame)
            window.close()
        }
        precondition(frames[1].height == frames[2].height && frames[1].height == frames[3].height
            && frames[1].height == frames[6].height, "Status and Activity titles must share line-height behavior")
        precondition(frames[4].height == frames[5].height, "Collection title/subtitle blocks must match")
        precondition(frames[4].height == frames[1].height
            && frames[1].height == CardPageHeader.Layout.titleTopOffset + CardPageHeader.Layout.titleHeight,
            "Members, Settings, Connection, and Activity must put the large title on the same line")
        precondition(frames[0].height == frames[7].height, "Long amounts must scale within the same numeric header")
        precondition(abs(frames[0].height - frames[1].height - 14) < 0.5,
            "Authority must retain its 80-point amount line, versus the shared 66-point title line")
        print("Header layout: small labels above aligned title lines, long-title/amount fit, and fixed viewport passed")
    }
}
