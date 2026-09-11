import { describe, expect, it } from "vitest";

import { runDiscovery } from "../../src/modules/agent/discovery-runtime";
import { localCapabilityPlanner } from "../../src/modules/agent/local-capability-planner";
import { createDiscoveryFixtureRegistry } from "../../src/modules/resources/discovery-fixture-registry";

describe("Capability discovery flow", () => {
  it("turns the standard task into a capability plan and finds the SOL Resource", async () => {
    const result = await runDiscovery({
      task: "使用专业市场数据分析一下 SOL 当前的市场情况。",
      planner: localCapabilityPlanner,
      plannerMode: "local_demo",
      resources: createDiscoveryFixtureRegistry(),
    });

    expect(result.capability_plan).toMatchObject({
      needs_external_capability: true,
      capability: "crypto.market.snapshot",
      asset: "SOL",
    });
    expect(result.discovery).toMatchObject({
      status: "found",
      resource: { resource_id: "premium-sol-market-snapshot" },
    });
    expect(result.events.map((event) => event.sequence)).toEqual([1, 2, 3]);
    expect(result.events.map((event) => event.type)).toEqual([
      "task.received",
      "capability.planned",
      "resource.found",
    ]);
  });

  it("recognizes a BTC market requirement but does not select the SOL Resource", async () => {
    const result = await runDiscovery({
      task: "分析 BTC 当前市场行情。",
      planner: localCapabilityPlanner,
      plannerMode: "local_demo",
      resources: createDiscoveryFixtureRegistry(),
    });

    expect(result.capability_plan.asset).toBe("BTC");
    expect(result.discovery).toMatchObject({ status: "not_found", resource: null });
    expect(result.events.at(-1)?.type).toBe("resource.not_found");
  });

  it("skips Registry lookup for a task that needs no external capability", async () => {
    const result = await runDiscovery({
      task: "解释一下 Solana 是什么。",
      planner: localCapabilityPlanner,
      plannerMode: "local_demo",
      resources: createDiscoveryFixtureRegistry(),
    });

    expect(result.discovery).toBeNull();
    expect(result.events.at(-1)?.type).toBe("resource.not_requested");
  });
});
