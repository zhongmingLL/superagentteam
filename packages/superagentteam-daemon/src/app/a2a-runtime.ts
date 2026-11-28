import type { DatabaseSync } from "node:sqlite";
import type { AgentStreamEvent } from "@superagentteam/shared/types";
import { OperatorMessageIngress } from "../domains/a2a/ingress/router.ts";
import { LoopGuardService } from "../domains/a2a/loop-guard.ts";
import { MultiMentionOrchestrator } from "../domains/a2a/multi-mention/orchestrator.ts";
import { MultiMentionStore } from "../domains/a2a/multi-mention/store.ts";
import { AgentRouter, createContextAssembler } from "../domains/a2a/routing/route.ts";
import { A2AControlServer } from "../domains/a2a/tools/control.ts";
import { ThreadContextService } from "../domains/a2a/tools/thread-context.ts";
import { A2AToolService } from "../domains/a2a/tools/tool-service.ts";
import type { AgentRegistry } from "../domains/agents/registry.ts";
import { HistoryAssembler } from "../domains/context/assembler.ts";
import { InvocationCredentialStore } from "../domains/credentials/store.ts";
import { InvokeSingleAgent } from "../domains/execution/invoke-single-agent.ts";
import { RunAgentTurn } from "../domains/execution/turn.ts";
import { InvocationAttemptStore, InvocationRecordStore, TurnExecutionStore } from "../domains/invocation/index.ts";
import {
	InvocationOwnerReaper,
	type RecoveryDeps,
	TurnExecutionStartupReconciler,
} from "../domains/invocation/recovery/index.ts";
import { ResponseRecoveryService, RouteResponseCommitter } from "../domains/invocation/settlement/index.ts";
import { AgentReadStateStore, MessageStore } from "../domains/messages/store.ts";
import { QueueLedgerStore } from "../domains/queue/ledger/store.ts";
import { QueueProcessor } from "../domains/queue/processor/index.ts";
import { SteerRegistry } from "../domains/queue/steer/registry.ts";
import { SteerService } from "../domains/queue/steer/service.ts";
import { InvocationTracker } from "../domains/queue/tracker/index.ts";
import { RichBlockService } from "../domains/rich-blocks/service.ts";
import { SessionArtifactStore } from "../domains/sessions/artifacts.ts";
import { SessionSealService } from "../domains/sessions/seal-service.ts";
import { AgentSessionStore } from "../domains/sessions/store.ts";
import { ResponseDraftStore } from "../domains/streaming/store.ts";
import { ThreadStore } from "../domains/threads/store.ts";
import { WorkerPool, type WorkerSpawnPort } from "../domains/workers/pool.ts";
import { WorkerBindingStore, WorkerStore } from "../domains/workers/store.ts";
import type { ChangeBus } from "../infrastructure/events/bus.ts";
import { disabledRuntimeTelemetry, type RuntimeTelemetry } from "../observability/runtime-telemetry.ts";
import type { A2ALog } from "../shared/a2a-log.ts";

// F018 R2-d composition root: one wiring point for the daemon (and the E2E
// suite) — ingress, processor, runAgentTurn, pool, reaper, startup
// reconciler, T4 recovery. Everything above the stores is constructed here.

export interface A2ARuntimeDeps {
	db: DatabaseSync;
	registry: AgentRegistry;
	spawn: WorkerSpawnPort;
	onStreamEvent?: (event: AgentStreamEvent, threadId: string) => void;
	changeBus?: ChangeBus;
	/** Structured A2A lifecycle log; daemon wires this to the JSONL store. */
	log?: A2ALog;
	clock?: () => number;
	processStartedAt?: number;
	promptTimeoutMs?: number;
	/** Enables the v1 worker A2A control channel when provided. */
	controlSocketPath?: string;
	/** F055: thread-first telemetry (best-effort). */
	telemetry?: RuntimeTelemetry;
}

export interface A2ARuntime {
	threads: ThreadStore;
	messages: MessageStore;
	readState: AgentReadStateStore;
	sessions: AgentSessionStore;
	sessionArtifacts: SessionArtifactStore;
	sessionSeal: SessionSealService;
	credentials: InvocationCredentialStore;
	drafts: ResponseDraftStore;
	multiMention: MultiMentionStore;
	a2aTools: A2AToolService;
	threadContext: ThreadContextService;
	multiMentionOrchestrator: MultiMentionOrchestrator;
	loopGuard: LoopGuardService;
	control: A2AControlServer | null;
	records: InvocationRecordStore;
	turns: TurnExecutionStore;
	attempts: InvocationAttemptStore;
	queue: QueueLedgerStore;
	tracker: InvocationTracker;
	telemetry: RuntimeTelemetry;
	steer: SteerService;
	steerRegistry: SteerRegistry;
	workerStore: WorkerStore;
	bindings: WorkerBindingStore;
	pool: WorkerPool;
	ingress: OperatorMessageIngress;
	processor: QueueProcessor;
	startup: TurnExecutionStartupReconciler;
	reaper: InvocationOwnerReaper;
	recovery: ResponseRecoveryService;
	/** F056: change invalidation bus (optional; tests may omit it). */
	changeBus?: ChangeBus;
}

export function buildA2ARuntime(deps: A2ARuntimeDeps): A2ARuntime {
	const clock = deps.clock ?? Date.now;
	const telemetry = deps.telemetry ?? disabledRuntimeTelemetry("a2a_runtime");
	const db = deps.db;
	const threads = new ThreadStore(db);
	const messages = new MessageStore(db);
	const readState = new AgentReadStateStore(db);
	const sessions = new AgentSessionStore(db);
	const sessionArtifacts = new SessionArtifactStore(db);
	const credentials = new InvocationCredentialStore(db);
	const drafts = new ResponseDraftStore(db);
	const multiMention = new MultiMentionStore(db);
	const records = new InvocationRecordStore(db);
	const turns = new TurnExecutionStore(db);
	const attempts = new InvocationAttemptStore(db);
	const queue = new QueueLedgerStore(db);
	const tracker = new InvocationTracker(clock);
	const steerRegistry = new SteerRegistry();
	const sessionSeal = new SessionSealService({
		db,
		threads,
		sessions,
		artifacts: sessionArtifacts,
		messages,
		readState,
		tracker,
		queue,
		telemetry,
		clock,
	});
	const workerStore = new WorkerStore(db);
	const bindingStore = new WorkerBindingStore(db);
	const pool = new WorkerPool({ workers: workerStore, bindings: bindingStore, spawn: deps.spawn, clock });
	const assembler = new HistoryAssembler({ messages, readState });
	const ingress = new OperatorMessageIngress({
		db,
		registry: deps.registry,
		threads,
		messages,
		queue,
		changeBus: deps.changeBus,
	});
	const loopGuard = new LoopGuardService({ turns, messages, drafts });
	const a2aTools = new A2AToolService({
		db,
		registry: deps.registry,
		threads,
		messages,
		queue,
		credentials,
		loopGuard,
		changeBus: deps.changeBus,
		clock,
	});
	const threadContext = new ThreadContextService({ threads, messages });
	const richBlocks = new RichBlockService({ drafts, clock });
	const multiMentionOrchestrator = new MultiMentionOrchestrator({
		db,
		registry: deps.registry,
		threads,
		messages,
		queue,
		credentials,
		attempts,
		turns,
		records,
		store: multiMention,
		loopGuard,
		clock,
	});
	const control = deps.controlSocketPath
		? new A2AControlServer({
				socketPath: deps.controlSocketPath,
				credentials,
				turns,
				workers: workerStore,
				bindings: bindingStore,
				a2aTools,
				multiMention: multiMentionOrchestrator,
				threadContext,
				richBlocks,
				telemetry,
				clock,
			})
		: null;
	const invokeSingleAgent = new InvokeSingleAgent({
		db,
		attempts,
		turns,
		credentials,
		drafts,
		messages,
		queue,
		sessions,
		clock,
		...(deps.log ? { log: deps.log } : {}),
	});
	const runAgentTurn = new RunAgentTurn({
		db,
		pool,
		attempts,
		sessions,
		drafts,
		threads,
		turns,
		credentials,
		readState,
		messages,
		invokeSingleAgent,
		telemetry,
		onStreamEvent: deps.onStreamEvent,
		steerRegistry,
		...(deps.log ? { log: deps.log } : {}),
		clock,
		promptTimeoutMs: deps.promptTimeoutMs,
	});
	const settlementDeps = {
		db,
		turns,
		attempts,
		credentials,
		sessions,
		readState,
		messages,
		drafts,
		queue,
		multiMention,
		threads,
		clock,
	};
	const router = new AgentRouter({
		assemble: createContextAssembler({
			assembler,
			registry: deps.registry,
			threads,
			messages,
			...(deps.log ? { log: deps.log } : {}),
		}),
		runner: runAgentTurn,
		committer: new RouteResponseCommitter(settlementDeps),
		telemetry,
		...(deps.log ? { log: deps.log } : {}),
	});
	const processor = new QueueProcessor({
		db,
		registry: deps.registry,
		queue,
		records,
		turns,
		attempts,
		sessions,
		credentials,
		drafts,
		messages,
		threads,
		tracker,
		router,
		...(deps.log ? { log: deps.log } : {}),
		multiMention,
		multiMentionOrchestrator,
		capacity: { check: (threadId, targets) => pool.checkCapacityFor(threadId, targets) },
		telemetry,
		clock,
	});
	const steer = new SteerService({
		threads,
		queue,
		messages,
		tracker,
		registry: steerRegistry,
		processor,
		telemetry,
		clock,
	});
	const recoveryDeps: RecoveryDeps = {
		...settlementDeps,
		queue,
		workers: workerStore,
		releaseSlot: (threadId, agentId, turnExecutionId) => {
			tracker.complete(threadId, agentId, turnExecutionId);
		},
		listStaleSlots: (now, minAgeMs) => tracker.listStaleSlots(now, minAgeMs),
		isWorkerLive: (turnExecutionId) => {
			// EXACT owner fence (§3.10.2): judge by the attempt's own worker
			// binding — the session's CURRENT binding may belong to a newer
			// worker and must not keep an old zombie alive. draining with a
			// valid lease counts live (finalizing providers); unreadable →
			// throw → defer.
			const attempt = attempts.getByTurnExecutionId(turnExecutionId);
			if (!attempt || !attempt.workerId) return false;
			const worker = workerStore.get(attempt.workerId);
			if (!worker) return false;
			if (worker.state === "retired" || worker.state === "stale") return false;
			return worker.leaseExpiresAt > clock();
		},
		processStartedAt: deps.processStartedAt ?? clock(),
		settleMultiMention: (now) => {
			multiMentionOrchestrator.settleExpired(now);
		},
		recoverMultiMention: (now) => {
			multiMentionOrchestrator.recover(now);
		},
	};
	return {
		threads,
		messages,
		readState,
		sessions,
		sessionArtifacts,
		sessionSeal,
		credentials,
		drafts,
		multiMention,
		a2aTools,
		threadContext,
		multiMentionOrchestrator,
		loopGuard,
		control,
		records,
		turns,
		attempts,
		queue,
		tracker,
		telemetry,
		steer,
		steerRegistry,
		workerStore,
		bindings: bindingStore,
		pool,
		ingress,
		processor,
		startup: new TurnExecutionStartupReconciler(recoveryDeps),
		reaper: new InvocationOwnerReaper(recoveryDeps),
		recovery: new ResponseRecoveryService(settlementDeps),
		changeBus: deps.changeBus,
	};
}
