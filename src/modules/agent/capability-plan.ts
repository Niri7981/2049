import { z } from "zod";

export const CapabilityPlanSchema = z
  .object({
    needs_external_capability: z.boolean(),
    capability: z.literal("crypto.market.snapshot").nullable(),
    asset: z
      .string()
      .trim()
      .regex(/^[A-Z0-9]{2,10}$/)
      .nullable(),
    reason: z.string().trim().min(1).max(240),
  })
  .strict()
  .superRefine((plan, context) => {
    if (plan.needs_external_capability && (!plan.capability || !plan.asset)) {
      context.addIssue({
        code: "custom",
        message: "External capability plans require both capability and asset",
      });
    }

    if (!plan.needs_external_capability && (plan.capability !== null || plan.asset !== null)) {
      context.addIssue({
        code: "custom",
        message: "Non-external plans must not request a capability or asset",
      });
    }
  });

export type CapabilityPlan = z.infer<typeof CapabilityPlanSchema>;

export type CapabilityPlanner = {
  plan(task: string): Promise<CapabilityPlan>;
};
