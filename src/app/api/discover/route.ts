import { NextResponse } from "next/server";

import { DiscoveryTaskSchema, runDiscovery } from "@/modules/agent/discovery-runtime";
import { localCapabilityPlanner } from "@/modules/agent/local-capability-planner";
import { openAICapabilityPlanner } from "@/modules/agent/openai-capability-planner";
import { createDiscoveryFixtureRegistry } from "@/modules/resources/discovery-fixture-registry";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let input;

  try {
    input = DiscoveryTaskSchema.parse(await request.json());
  } catch {
    return NextResponse.json(
      { error: "请输入 1 到 1000 个字符的任务。" },
      { status: 400 },
    );
  }

  try {
    const useOpenAIAgent = Boolean(process.env.OPENAI_API_KEY);
    const result = await runDiscovery({
      task: input.task,
      planner: useOpenAIAgent ? openAICapabilityPlanner : localCapabilityPlanner,
      plannerMode: useOpenAIAgent ? "openai_agent" : "local_demo",
      resources: createDiscoveryFixtureRegistry(),
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Discovery discovery failed", error);
    return NextResponse.json(
      { error: "Agent 暂时无法完成 Resource Discovery，请重试。" },
      { status: 502 },
    );
  }
}
