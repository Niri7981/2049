import { z } from "zod";

const eventDetailValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

export const ExecutionEventSchema = z
  .object({
    sequence: z.number().int().positive(),
    timestamp: z.string().datetime({ offset: true }),
    actor: z.enum(["User", "Agent", "Discovery"]),
    type: z.enum([
      "task.received",
      "capability.planned",
      "resource.found",
      "resource.not_found",
      "resource.not_requested",
      "resource.configuration_error",
    ]),
    message: z.string().trim().min(1).max(300),
    details: z.record(z.string(), eventDetailValueSchema),
  })
  .strict();

export type ExecutionEvent = z.infer<typeof ExecutionEventSchema>;

type NewExecutionEvent = Omit<ExecutionEvent, "sequence" | "timestamp">;

export function createExecutionEvent(
  sequence: number,
  event: NewExecutionEvent,
): ExecutionEvent {
  return ExecutionEventSchema.parse({
    ...event,
    sequence,
    timestamp: new Date().toISOString(),
  });
}
