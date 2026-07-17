import { describe, expect, it } from "vitest";
import { reliableEnvelopeSchema } from "@bot/shared";
import { buildAutomationEnvelope } from "../src/automations.js";

describe("Gateway automation delivery", () => {
  it("builds a durable, partitioned and correlated automation event", () => {
    const context = {
      event: { type: "message_create" as const, id: "event-1", depth: 0 as const },
      guild: { id: "991000000000000020", name: "Guild" },
      user: { id: "881000000000000020", name: "Alice", bot: false },
      channel: { id: "771000000000000020", name: "support" },
      message: { id: "661000000000000020", content: "help", webhook: false },
    };
    const envelope = buildAutomationEnvelope(context.guild.id, context, 1234);
    expect(reliableEnvelopeSchema.safeParse(envelope).success).toBe(true);
    expect(envelope.type).toBe("automation_event");
    expect(envelope.partitionKey).toBe(`g:${context.guild.id}`);
    expect(envelope.priority).toBe(0);
    expect(envelope.occurredAt).toBe(1234);
    if (envelope.type === "automation_event") {
      expect(envelope.payload.rootEventId).toBe(envelope.eventId);
      expect(envelope.payload.context.message?.content).toBe("help");
    }
  });
});
