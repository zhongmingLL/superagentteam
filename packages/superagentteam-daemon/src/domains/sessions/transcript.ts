import type {
	AgentSession,
	SessionDigestV1,
	SessionTranscriptEntry,
	StoredMessage,
} from "@superagentteam/shared/types";

export const MAX_TRANSCRIPT_MESSAGES = 400;
export const MAX_ENTRY_CHARS = 3_000;
export const MAX_EXCERPT_CHARS = 400;
export const MAX_RECENT_EXCERPT_CHARS = 200;

function clip(value: string, max: number): { value: string; truncated: boolean } {
	if (value.length <= max) return { value, truncated: false };
	return { value: `${value.slice(0, max)}…`, truncated: true };
}

function senderOf(message: StoredMessage): { kind: "user" | "agent" | "system"; id: string } {
	if (message.from.kind === "agent") return { kind: "agent", id: message.from.agentId };
	if (message.from.kind === "user") return { kind: "user", id: message.from.userId };
	return { kind: "system", id: message.from.service };
}

function lifecycleStatus(message: StoredMessage): SessionTranscriptEntry["lifecycleStatus"] {
	if (message.lifecycle?.kind === "response") return message.lifecycle.status;
	return undefined;
}

export function buildTranscriptEntry(message: StoredMessage): SessionTranscriptEntry {
	const content = clip(message.content, MAX_ENTRY_CHARS);
	const thinking = message.thinking ? clip(message.thinking, MAX_ENTRY_CHARS) : undefined;
	return {
		seq: message.seq,
		at: message.timestamp,
		from: senderOf(message),
		content: content.value,
		...(thinking ? { thinking: thinking.value } : {}),
		...(message.toolEvents
			? { toolEvents: message.toolEvents.map((event) => ({ name: event.name, status: event.status })) }
			: {}),
		...(message.lifecycle ? { lifecycleKind: message.lifecycle.kind } : {}),
		...(lifecycleStatus(message) ? { lifecycleStatus: lifecycleStatus(message) } : {}),
		...(content.truncated || thinking?.truncated ? { truncated: true } : {}),
	};
}

export interface TranscriptBuildResult {
	transcript: SessionTranscriptEntry[];
	messageCount: number;
	transcriptBytes: number;
	fromSeq: number;
	toSeq: number;
	truncated: boolean;
}

export function buildSessionTranscript(
	messages: readonly StoredMessage[],
	requestedFromSeq: number,
	truncated: boolean,
): TranscriptBuildResult {
	const transcript = messages.map(buildTranscriptEntry);
	const fromSeq = transcript[0]?.seq ?? requestedFromSeq;
	const toSeq = transcript.at(-1)?.seq ?? requestedFromSeq;
	return {
		transcript,
		messageCount: transcript.length,
		transcriptBytes: Buffer.byteLength(JSON.stringify(transcript), "utf8"),
		fromSeq,
		toSeq,
		truncated,
	};
}

function labelOf(entry: SessionTranscriptEntry): string {
	if (entry.from.kind === "user") return "operator";
	return entry.from.id;
}

function excerpt(value: string, max = MAX_EXCERPT_CHARS): string {
	return clip(value.replace(/\s+/g, " ").trim(), max).value;
}

export interface DigestBuildInput {
	session: AgentSession;
	entries: readonly SessionTranscriptEntry[];
	fromSeq: number;
	toSeq: number;
	sealedAt: number;
	sealReason: string;
	truncated: boolean;
}

export function buildSessionDigest(input: DigestBuildInput): SessionDigestV1 {
	const { session, entries } = input;
	const senders: SessionDigestV1["senders"] = { user: 0, agents: {}, system: 0 };
	const toolCounts = new Map<string, number>();
	const errorSamples: string[] = [];
	let errors = 0;

	for (const entry of entries) {
		if (entry.from.kind === "user") senders.user += 1;
		else if (entry.from.kind === "system") senders.system += 1;
		else senders.agents[entry.from.id] = (senders.agents[entry.from.id] ?? 0) + 1;

		for (const tool of entry.toolEvents ?? []) {
			toolCounts.set(tool.name, (toolCounts.get(tool.name) ?? 0) + 1);
		}
		const failed =
			entry.lifecycleKind === "delivery_failure" ||
			entry.lifecycleStatus === "failed" ||
			entry.lifecycleStatus === "interrupted" ||
			entry.lifecycleStatus === "canceled";
		if (failed) {
			errors += 1;
			if (errorSamples.length < 3) errorSamples.push(excerpt(entry.content, 160) || "(empty)");
		}
	}

	const tools = [...toolCounts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((left, right) => right.count - left.count || left.name.localeCompare(right.name));
	const firstUser = entries.find((entry) => entry.from.kind === "user");
	const lastUser = [...entries].reverse().find((entry) => entry.from.kind === "user");
	const lastAgent = [...entries].reverse().find((entry) => entry.from.kind === "agent");
	const recent = entries.slice(-8).map((entry) => ({
		role: entry.from.kind,
		label: labelOf(entry),
		content: excerpt(entry.content, MAX_RECENT_EXCERPT_CHARS),
		at: entry.at,
	}));

	return {
		v: 1,
		sessionId: session.id,
		threadId: session.threadId,
		agentId: session.agentId,
		seq: session.seq,
		createdAt: session.createdAt,
		sealedAt: input.sealedAt,
		sealReason: input.sealReason,
		window: {
			fromSeq: input.fromSeq,
			toSeq: input.toSeq,
			messageCount: entries.length,
			truncated: input.truncated,
		},
		senders,
		tools,
		errors: { count: errors, samples: errorSamples },
		...(firstUser ? { firstUserMessage: excerpt(firstUser.content) } : {}),
		...(lastUser ? { lastUserMessage: excerpt(lastUser.content) } : {}),
		...(lastAgent ? { lastAgentMessage: excerpt(lastAgent.content) } : {}),
		recent,
	};
}
