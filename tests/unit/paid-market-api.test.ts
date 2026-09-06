import { describe, expect, it } from "vitest";
import { paidMarketSnapshotResponse, PAYMENT_REQUIRED_HEADER } from "../../src/modules/paid-market-api/paid-market-api";

describe("demo paid market API", () => {
  it("returns a machine-readable 402 quote before payment", async () => {
    const response = paidMarketSnapshotResponse({ asset: "SOL" });
    expect(response.status).toBe(402);
    expect(response.headers.get(PAYMENT_REQUIRED_HEADER)).toBeTruthy();
  });

  it("returns validated JSON after the demo payment marker", async () => {
    const response = paidMarketSnapshotResponse({ asset: "SOL" }, "demo-valid-payment");
    expect(response.status).toBe(200);
    expect((await response.json()).asset).toBe("SOL");
  });

  it("rejects unsupported assets", () => {
    expect(paidMarketSnapshotResponse({ asset: "BTC" }).status).toBe(400);
  });
});
