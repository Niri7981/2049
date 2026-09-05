import { tool } from "@openai/agents";

import type { ResourceMetadata } from "./resource-schema";
import {
  discoverResource,
  ResourceDiscoveryQuerySchema,
  ResourceDiscoveryResultSchema,
} from "./resource-discovery";

export function createResourceDiscoveryTool(resources: readonly ResourceMetadata[]) {
  return tool({
    name: "discover_resource",
    description:
      "Find the single enabled V0 resource matching an exact capability and asset. This tool cannot pay or call the resource endpoint.",
    parameters: ResourceDiscoveryQuerySchema,
    outputSchema: ResourceDiscoveryResultSchema,
    async execute(query) {
      return discoverResource(resources, query);
    },
  });
}
