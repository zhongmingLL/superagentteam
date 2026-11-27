export type EvidenceSourceKind = "file" | "control";

export type EvidenceKind =
	| "feature"
	| "decision"
	| "plan"
	| "lesson"
	| "architecture"
	| "thread"
	| "session"
	| "research"
	| "discussion"
	| "task"
	| "artifact"
	| "review"
	| "verification"
	| "merge";

export type EvidenceStatus =
	| "active"
	| "done"
	| "archived"
	| "review"
	| "invalidated"
	| "superseded"
	| "drifted"
	| "stale"
	| "historical"
	| "retired";

export type ProvenanceTier = "authoritative" | "derived" | "soft_clue";

export type ControlTable = "tasks" | "artifacts" | "reviews" | "verifications" | "merges";

export interface FileEvidenceSourceRef {
	readonly kind: "file";
	readonly ref: `file:${string}`;
	readonly path: string;
	readonly sha256: string;
	readonly updatedAt: number;
}

export interface ControlEvidenceSourceRef {
	readonly kind: "control";
	readonly ref:
		| `task:${string}`
		| `artifact:${string}`
		| `review:${string}`
		| `verification:${string}`
		| `merge:${string}`;
	readonly table: ControlTable;
	readonly id: string;
	readonly sha256: string;
	readonly updatedAt: number;
}

export type EvidenceSourceRef = FileEvidenceSourceRef | ControlEvidenceSourceRef;

export type EvidenceDrillDown =
	| { readonly kind: "file"; readonly sourceRef: string; readonly path: string; readonly line?: number }
	| { readonly kind: "control"; readonly sourceRef: string; readonly table: ControlTable; readonly id: string };

export interface EvidenceItem {
	readonly anchor: string;
	readonly kind: EvidenceKind;
	readonly status: EvidenceStatus;
	readonly title: string;
	readonly summary: string | null;
	readonly keywords: readonly string[];
	readonly provenanceTier: ProvenanceTier;
	readonly source: EvidenceSourceRef;
	readonly drillDown: EvidenceDrillDown;
	readonly updatedAt: number;
}

export interface EvidencePassage {
	readonly passageId: string;
	readonly anchor: string;
	readonly ordinal: number;
	readonly content: string;
	readonly contentHash: string;
	readonly createdAt: number;
}

export interface EvidenceHit {
	readonly anchor: string;
	readonly kind: EvidenceKind;
	readonly status: EvidenceStatus;
	readonly title: string;
	readonly summary: string | null;
	readonly passage: string;
	readonly score: number;
	readonly match: "fts" | "lexical_fallback";
	readonly source: EvidenceSourceRef;
	readonly drillDown: EvidenceDrillDown;
	readonly stale: boolean;
	readonly staleReasons: readonly string[];
}

export type CoverageIndexStatus = "fresh" | "degraded" | "interrupted" | "failed" | "indexing" | "never_run";

export interface Coverage {
	readonly workspaceId: string;
	readonly collectionId: string;
	readonly scope: "indexed_scope_only";
	readonly indexRunId: string | null;
	readonly indexedAt: number | null;
	readonly indexStatus: CoverageIndexStatus;
	readonly stale: boolean;
	readonly degraded: boolean;
	readonly reasons: readonly string[];
	readonly counts: { readonly evidence: number; readonly file: number; readonly control: number };
}

export interface RecallResult {
	readonly query: string;
	readonly items: readonly EvidenceHit[];
	readonly coverage: Coverage;
}

export type ReadResult =
	| {
			readonly found: true;
			readonly item: EvidenceItem;
			readonly content: string;
			readonly passages: readonly EvidencePassage[];
			readonly coverage: Coverage;
			readonly redacted: boolean;
			readonly redactionFindings: readonly string[];
			readonly stale: boolean;
			readonly staleReasons: readonly string[];
	  }
	| {
			readonly found: false;
			readonly anchor: string;
			readonly coverage: Coverage;
			readonly reason: "not_indexed";
	  };

export type RetrievalTrigger = "kickoff" | "design" | "impl" | "review" | "verify" | "merge" | "completion";

export interface RetrievalTriggerInput {
	readonly query?: string;
	readonly taskTitle?: string;
	readonly taskWhy?: string;
	readonly featureId?: string;
	readonly files?: readonly string[];
	readonly risk?: string;
	readonly headSha?: string;
	readonly limit?: number;
}

export interface RetrievalRequest {
	readonly trigger: RetrievalTrigger;
	readonly query: string;
	readonly kinds: readonly EvidenceKind[];
	readonly limit: number;
	readonly rationale: string;
}

export interface TriggerRecallResult {
	readonly trigger: RetrievalTrigger;
	readonly request: RetrievalRequest;
	readonly result: RecallResult;
	readonly contextBlock: string;
}
