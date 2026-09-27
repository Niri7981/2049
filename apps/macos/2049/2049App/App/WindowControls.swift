import AppKit
import SwiftUI

struct WindowControls: View {
    var body: some View {
        HStack(spacing: 8) {
            WindowControlButton(color: Color(nsColor: .systemRed), symbol: "xmark", label: "Hide 2049") {
                NSApp.hide(nil)
            }
            WindowControlButton(color: Color(nsColor: .systemYellow), symbol: "minus", label: "Minimize 2049") {
                NSApp.keyWindow?.miniaturize(nil)
            }
            WindowControlButton(color: Color(nsColor: .systemGreen), symbol: "arrow.up.left.and.arrow.down.right", label: "Toggle Full Screen") {
                NSApp.keyWindow?.toggleFullScreen(nil)
            }
        }
    }
}

private struct WindowControlButton: View {
    let color: Color
    let symbol: String
    let label: String
    let action: () -> Void

    @State private var isHovering = false

    var body: some View {
        Button(action: action) {
            Circle()
                .fill(color)
                .overlay {
                    Circle().strokeBorder(.black.opacity(0.12), lineWidth: 0.5)
                }
                .overlay {
                    if isHovering {
                        Image(systemName: symbol)
                            .font(.system(size: 6, weight: .bold))
                            .foregroundStyle(.black.opacity(0.55))
                    }
                }
                .frame(width: 12, height: 12)
                .frame(width: 14, height: 16)
        }
        .buttonStyle(.plain)
        .onHover { isHovering = $0 }
        .accessibilityLabel(label)
    }
}
