import type { AgentStreamEvent } from "@superagentteam/shared/types";

export type ChangeTopic = "messages" | "queue" | "live" | "thread";

export interface ChangeEvent {
	threadId: string;
	topics: ChangeTopic[];
	at: number;
}

export type ChangeListener = (event: ChangeEvent) => void;

/** F028: ephemeral per-turn provider events. Never persisted; subscribers only. */
export interface StreamEvent {
	threadId: string;
	event: AgentStreamEvent;
}

export type StreamListener = (event: StreamEvent) => void;

/**
 * In-process invalidation bus. It carries no truth: listeners must refetch the
 * HTTP read model after receiving an event.
 */
export class ChangeBus {
	private readonly listeners = new Map<string, Set<ChangeListener>>();
	private readonly streamListeners = new Map<string, Set<StreamListener>>();

	subscribe(threadId: string, listener: ChangeListener): () => void {
		let listeners = this.listeners.get(threadId);
		if (!listeners) {
			listeners = new Set();
			this.listeners.set(threadId, listeners);
		}
		listeners.add(listener);
		return () => {
			const current = this.listeners.get(threadId);
			if (!current) return;
			current.delete(listener);
			if (current.size === 0) this.listeners.delete(threadId);
		};
	}

	publish(threadId: string, topics: readonly ChangeTopic[], at = Date.now()): void {
		const unique = [...new Set(topics)];
		if (unique.length === 0) return;
		const event: ChangeEvent = { threadId, topics: unique, at };
		for (const listener of [...(this.listeners.get(threadId) ?? [])]) {
			try {
				listener(event);
			} catch {
				// One broken stream must not hide changes from other subscribers.
			}
		}
	}

	subscribeStream(threadId: string, listener: StreamListener): () => void {
		let listeners = this.streamListeners.get(threadId);
		if (!listeners) {
			listeners = new Set();
			this.streamListeners.set(threadId, listeners);
		}
		listeners.add(listener);
		return () => {
			const current = this.streamListeners.get(threadId);
			if (!current) return;
			current.delete(listener);
			if (current.size === 0) this.streamListeners.delete(threadId);
		};
	}

	publishStream(threadId: string, event: AgentStreamEvent): void {
		const listeners = this.streamListeners.get(threadId);
		if (!listeners) return;
		const payload: StreamEvent = { threadId, event };
		for (const listener of [...listeners]) {
			try {
				listener(payload);
			} catch {
				// One broken stream must not hide events from other subscribers.
			}
		}
	}

	subscriberCount(threadId: string): number {
		return this.listeners.get(threadId)?.size ?? 0;
	}

	streamSubscriberCount(threadId: string): number {
		return this.streamListeners.get(threadId)?.size ?? 0;
	}
}
