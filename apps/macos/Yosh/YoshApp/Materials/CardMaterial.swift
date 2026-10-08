import SwiftUI

enum YoshShellPalette {
    static let shape = RoundedRectangle(cornerRadius: 30, style: .continuous)
    static let surface = Color(red: 0.961, green: 0.973, blue: 0.980)
    static let secondaryInk = Color(red: 0.37, green: 0.45, blue: 0.54)
    static let activeInk = Color(red: 0.30, green: 0.44, blue: 0.65)
    static let boundary = Color(red: 0.53, green: 0.63, blue: 0.73).opacity(0.22)
}

struct CardMaterial: View {

    var body: some View {
        YoshShellPalette.shape
            .fill(YoshShellPalette.surface)
            .overlay {
                YoshShellPalette.shape.strokeBorder(YoshShellPalette.boundary, lineWidth: 0.75)
            }
    }
}
