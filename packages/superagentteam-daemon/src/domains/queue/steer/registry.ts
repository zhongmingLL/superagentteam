// F053: process-local live-turn steering registry.

export interface SteerBinding {
	threadId: string;
	agentId: string;
	turnExecutionId: string;
	attempt: number;
	steer(message: string): Promise<{ disposition: string }>;
}

export class SteerRegistry {
	private readonly bindings = new Map<string, SteerBinding>();

	private key(threadId: string, agentId: string): string {
		return `${threadId}\u0000${agentId}`;
	}

	attach(binding: SteerBinding): () => void {
		const key = this.key(binding.threadId, binding.agentId);
		this.bindings.set(key, binding);
		return () => {
			if (this.bindings.get(key) === binding) this.bindings.delete(key);
		};
	}

	get(threadId: string, agentId: string): SteerBinding | undefined {
		return this.bindings.get(this.key(threadId, agentId));
	}

	clear(threadId: string, agentId: string): void {
		this.bindings.delete(this.key(threadId, agentId));
	}

	get size(): number {
		return this.bindings.size;
	}
}
