import Foundation

@main
struct DailyAuthorityPresentationTest {
    static func main() {
        let devnet = DailyAuthorityPresentation(network: "Solana Devnet")
        let mainnet = DailyAuthorityPresentation(network: "Solana Mainnet")
        let balance = AppBalance(amount: "19000000", display: "19.00 test USDC", available: true)
        precondition(devnet.currency == "test USDC" && devnet.balanceDisplay(balance) == "19.00 test USDC")
        precondition(mainnet.currency == "USDC" && mainnet.balanceDisplay(balance) == "19.00 USDC")
        precondition(DailyAuthorityPresentation(network: "Solana Mainnet-Beta").currency == "USDC")
        let unknown = DailyAuthorityPresentation(network: "Unknown network")
        precondition(unknown.currency == nil && unknown.balanceDisplay(balance) == nil)
        precondition(devnet.balanceDisplay(AppBalance(amount: nil, display: "Balance unavailable", available: false)) == nil)
        precondition(mainnet.balanceDisplay(AppBalance(amount: "1", display: "0.000001 USDC", available: true)) == "0.000001 USDC")
        precondition(devnet.balanceDisplay(AppBalance(amount: "1", display: "Invalid currency", available: true)) == nil)

        let valid = ["0": "0", "0.00": "0", "1.00": "1000000", " 2.123456 \n": "2123456",
                     "0.000001": "1", "19.10": "19100000", "999999999.999999": "999999999999999"]
        for (input, expected) in valid { precondition(DailyAuthorityPresentation.minorUnits(input) == expected) }
        for invalid in ["", "-1", "+1", "01", "1.", ".1", "0.0000001", "1e2", "1,00", "1000000000",
                        "NaN", "Infinity", "１２", "1\n2"] {
            precondition(DailyAuthorityPresentation.minorUnits(invalid) == nil, "Invalid limit must not be sent: \(invalid)")
        }
        for (minor, editor) in [(Int64(0), "0.00"), (1, "0.000001"), (1_000_000, "1.00"),
                                (1_200_000, "1.20"), (2_123_456, "2.123456"), (999_999_999_999_999, "999999999.999999")] {
            precondition(DailyAuthorityPresentation.editableLimit(minor) == editor)
            precondition(DailyAuthorityPresentation.minorUnits(editor) == String(minor))
        }
        precondition(DailyAuthorityPresentation.editableLimit(nil).isEmpty, "Unset authority must remain unset")
        print("Daily Authority: network labels, backend balance precision, integer input boundaries, zero/unset limits, and exact six-decimal round trips passed")
    }
}
