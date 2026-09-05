import { z } from "zod";

import {
  MarketSnapshotInputSchema,
  type ResourceMetadata,
} from "./resource-schema";

export const ResourceDiscoveryQuerySchema = z
  .object({
    capability: z.literal("crypto.market.snapshot"),
    asset: z.string().trim().regex(/^[A-Z0-9]{2,10}$/),
  })
  .strict();

export const AgentVisibleResourceSchema = z
  .object({
    resource_id: z.string(),
    name: z.string(),
    description: z.string(),
    capability: z.literal("crypto.market.snapshot"),
    provider_id: z.string(),
    input_schema: z.literal("MarketSnapshotInput"),
    output_schema: z.literal("MarketSnapshotOutput"),
    expected_price_minor: z.number().int().positive(),
    currency: z.literal("USDC"),
    network: z.string(),
    payment_scheme: z.literal("exact"),
  })
  .strict();

export const ResourceDiscoveryResultSchema = z
  .object({
    status: z.enum(["found", "not_found", "configuration_error"]),
    resource: AgentVisibleResourceSchema.nullable(),
    reason: z.string().trim().min(1).max(240).nullable(),
  })
  .strict()
  .superRefine((result, context) => {
    if (result.status === "found" && (!result.resource || result.reason !== null)) {
      context.addIssue({
        code: "custom",
        message: "Found results require a resource and no error reason",
      });
    }

    if (result.status !== "found" && (result.resource !== null || !result.reason)) {
      context.addIssue({
        code: "custom",
        message: "Non-found results require a reason and no resource",
      });
    }
  });

export type ResourceDiscoveryQuery = z.infer<typeof ResourceDiscoveryQuerySchema>;
export type AgentVisibleResource = z.infer<typeof AgentVisibleResourceSchema>;
export type ResourceDiscoveryResult = z.infer<typeof ResourceDiscoveryResultSchema>;

function toAgentVisibleResource(resource: ResourceMetadata): AgentVisibleResource {
  return AgentVisibleResourceSchema.parse({
    resource_id: resource.resource_id,
    name: resource.name,
    description: resource.description,
    capability: resource.capability,
    provider_id: resource.provider_id,
    input_schema: resource.input_schema,
    output_schema: resource.output_schema,
    expected_price_minor: resource.expected_price_minor,
    currency: resource.currency,
    network: resource.network,
    payment_scheme: resource.payment_scheme,
  });
}

export function discoverResource(
  resources: readonly ResourceMetadata[],
  rawQuery: ResourceDiscoveryQuery,
): ResourceDiscoveryResult {
  const query = ResourceDiscoveryQuerySchema.parse(rawQuery);
  const matches = resources.filter(
    (resource) =>
      resource.enabled &&
      resource.capability === query.capability &&
      MarketSnapshotInputSchema.safeParse({ asset: query.asset }).success,
  );

  if (matches.length === 0) {
    return ResourceDiscoveryResultSchema.parse({
      status: "not_found",
      resource: null,
      reason: `No enabled resource supports ${query.capability} for ${query.asset}.`,
    });
  }

  if (matches.length > 1) {
    return ResourceDiscoveryResultSchema.parse({
      status: "configuration_error",
      resource: null,
      reason: `Registry returned multiple resources for ${query.capability} and ${query.asset}.`,
    });
  }

  return ResourceDiscoveryResultSchema.parse({
    status: "found",
    resource: toAgentVisibleResource(matches[0]),
    reason: null,
  });
}
