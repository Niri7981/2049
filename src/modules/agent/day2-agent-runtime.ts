import { z } from "zod";

import {
  createExecutionEvent,
  ExecutionEventSchema,
  type ExecutionEvent,
} from "../execution-trace/execution-event";
import {
  ResourceDiscoveryResultSchema,
  discoverResource,
} from "../resources/resource-discovery";
import type { ResourceMetadata } from "../resources/resource-schema";
import {
  CapabilityPlanSchema,
  type CapabilityPlanner,
} from "./capability-plan";

export const Day2TaskSchema = z
  .object({
    task: z.string().trim().min(1).max(1_000),
  })
  .strict();

export const Day2DiscoveryRunSchema = z
  .object({
    task: z.string(),
    planner_mode: z.enum(["openai_agent", "local_demo"]),
    capability_plan: CapabilityPlanSchema,
    discovery: ResourceDiscoveryResultSchema.nullable(),
    events: z.array(ExecutionEventSchema).min(3),
  })
  .strict();

export type PlannerMode = "openai_agent" | "local_demo";
export type Day2DiscoveryRun = z.infer<typeof Day2DiscoveryRunSchema>;

type RunDay2DiscoveryOptions = {
  task: string;
  planner: CapabilityPlanner;
  plannerMode: PlannerMode;
  resources: readonly ResourceMetadata[];
};

export async function runDay2Discovery({
  task: rawTask,
  planner,
  plannerMode,
  resources,
}: RunDay2DiscoveryOptions): Promise<Day2DiscoveryRun> {
  const { task } = Day2TaskSchema.parse({ task: rawTask });
  const events: ExecutionEvent[] = [];
  const appendEvent = (event: Omit<ExecutionEvent, "sequence" | "timestamp">) => {
    events.push(createExecutionEvent(events.length + 1, event));
  };

  appendEvent({
    actor: "User",
    type: "task.received",
    message: task,
    details: {},
  });

  const capabilityPlan = CapabilityPlanSchema.parse(await planner.plan(task));
  appendEvent({
    actor: "Agent",
    type: "capability.planned",
    message: capabilityPlan.reason,
    details: {
      needs_external_capability: capabilityPlan.needs_external_capability,
      capability: capabilityPlan.capability,
      asset: capabilityPlan.asset,
      planner_mode: plannerMode,
    },
  });

  if (
    !capabilityPlan.needs_external_capability ||
    !capabilityPlan.capability ||
    !capabilityPlan.asset
  ) {
    appendEvent({
      actor: "Discovery",
      type: "resource.not_requested",
      message: "当前任务不需要查询付费 Resource。",
      details: {},
    });

    return Day2DiscoveryRunSchema.parse({
      task,
      planner_mode: plannerMode,
      capability_plan: capabilityPlan,
      discovery: null,
      events,
    });
  }

  const discovery = discoverResource(resources, {
    capability: capabilityPlan.capability,
    asset: capabilityPlan.asset,
  });

  if (discovery.status === "found") {
    appendEvent({
      actor: "Discovery",
      type: "resource.found",
      message: `Found ${discovery.resource?.name}.`,
      details: {
        resource_id: discovery.resource?.resource_id ?? null,
        expected_price_minor: discovery.resource?.expected_price_minor ?? null,
        currency: discovery.resource?.currency ?? null,
        network: discovery.resource?.network ?? null,
      },
    });
  } else {
    appendEvent({
      actor: "Discovery",
      type:
        discovery.status === "configuration_error"
          ? "resource.configuration_error"
          : "resource.not_found",
      message: discovery.reason ?? "Resource discovery failed.",
      details: {
        capability: capabilityPlan.capability,
        asset: capabilityPlan.asset,
      },
    });
  }

  return Day2DiscoveryRunSchema.parse({
    task,
    planner_mode: plannerMode,
    capability_plan: capabilityPlan,
    discovery,
    events,
  });
}
