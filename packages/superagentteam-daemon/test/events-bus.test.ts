import { describe, expect, it, vi } from "vitest";

import { ChangeBus } from "../src/infrastructure/events/bus.ts";

describe("ChangeBus", () => {
	it("publishes deduped topics to subscribers and unsubscribes cleanly", () => {
		const bus = new ChangeBus();
		const listener = vi.fn();
		const unsubscribe = bus.subscribe("thread:1", listener);

		bus.publish("thread:1", ["messages", "messages", "queue"], 42);

		expect(listener).toHaveBeenCalledWith({
			threadId: "thread:1",
			topics: ["messages", "queue"],
			at: 42,
		});
		expect(bus.subscriberCount("thread:1")).toBe(1);
		unsubscribe();
		expect(bus.subscriberCount("thread:1")).toBe(0);
		bus.publish("thread:1", ["live"], 43);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("isolates a throwing subscriber from the others", () => {
		const bus = new ChangeBus();
		const healthy = vi.fn();
		bus.subscribe("thread:1", () => {
			throw new Error("broken sink");
		});
		bus.subscribe("thread:1", healthy);

		expect(() => bus.publish("thread:1", ["live"])).not.toThrow();
		expect(healthy).toHaveBeenCalledTimes(1);
	});

	it("publishes ephemeral stream events only to the matching thread subscribers", () => {
		const bus = new ChangeBus();
		const listener = vi.fn();
		const unsubscribe = bus.subscribeStream("thread:1", listener);
		const event = {
			type: "thinking" as const,
			seq: 1,
			agentId: "a1",
			turnExecutionId: "turn:1",
			content: "hm",
			timestamp: 42,
		};

		bus.publishStream("thread:2", event);
		expect(listener).not.toHaveBeenCalled();
		bus.publishStream("thread:1", event);
		expect(listener).toHaveBeenCalledWith({ threadId: "thread:1", event });
		expect(bus.streamSubscriberCount("thread:1")).toBe(1);
		unsubscribe();
		expect(bus.streamSubscriberCount("thread:1")).toBe(0);
		bus.publishStream("thread:1", event);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it("isolates a throwing stream subscriber from the others", () => {
		const bus = new ChangeBus();
		const healthy = vi.fn();
		bus.subscribeStream("thread:1", () => {
			throw new Error("broken stream sink");
		});
		bus.subscribeStream("thread:1", healthy);

		expect(() =>
			bus.publishStream("thread:1", {
				type: "done",
				seq: 2,
				agentId: "a1",
				turnExecutionId: "turn:1",
				timestamp: 43,
			}),
		).not.toThrow();
		expect(healthy).toHaveBeenCalledTimes(1);
	});
});
