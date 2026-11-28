import { useEffect, useId, useMemo, useState } from "react";

import {
	type LogsResponse,
	type MetricsResponse,
	type TelemetryApi,
	type TelemetryHealthResponse,
	type TelemetrySpan,
	type TraceResponse,
	telemetryApi,
} from "@/domains/telemetry/api";

type Tab = "traces" | "metrics" | "logs";
type TraceFilterKind = "thread" | "invocation" | "turn" | "agent";

export interface ObservabilityDialogProps {
	threadId?: string;
	api?: Pick<TelemetryApi, "traces" | "metrics" | "logs" | "health">;
	onClose(): void;
}

function statusClass(status: string): string {
	if (status === "ready") return "is-ready";
	if (status === "degraded") return "is-degraded";
	return "is-disabled";
}

function shortId(value: string): string {
	return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

export function ObservabilityDialog({ threadId, api = telemetryApi, onClose }: ObservabilityDialogProps) {
	const titleId = useId();
	const [tab, setTab] = useState<Tab>("traces");
	const [health, setHealth] = useState<TelemetryHealthResponse | null>(null);
	const [traces, setTraces] = useState<TraceResponse | null>(null);
	const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
	const [logs, setLogs] = useState<LogsResponse | null>(null);
	const [filterKind, setFilterKind] = useState<TraceFilterKind>("thread");
	const [filterValue, setFilterValue] = useState(threadId ?? "");
	const [selected, setSelected] = useState<TelemetrySpan | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | undefined>();

	const traceQuery = useMemo(() => {
		if (filterValue.trim() === "") return { limit: 100 };
		if (filterKind === "thread") return { threadId: filterValue.trim(), limit: 100 };
		if (filterKind === "invocation") return { invocationId: filterValue.trim(), limit: 100 };
		if (filterKind === "turn") return { turnExecutionId: filterValue.trim(), limit: 100 };
		return { agentId: filterValue.trim(), limit: 100 };
	}, [filterKind, filterValue]);

	const loadHealth = async (): Promise<void> => {
		try {
			setHealth(await api.health());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "无法读取 telemetry 健康状态");
		}
	};

	const loadTraces = async (): Promise<void> => {
		setLoading(true);
		try {
			const result = await api.traces(traceQuery);
			setTraces(result);
			setSelected(result.spans[0] ?? null);
			setError(undefined);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "无法读取 traces");
		} finally {
			setLoading(false);
		}
	};

	const loadMetrics = async (): Promise<void> => {
		setLoading(true);
		try {
			setMetrics(await api.metrics());
			setError(undefined);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "无法读取 metrics");
		} finally {
			setLoading(false);
		}
	};

	const loadLogs = async (): Promise<void> => {
		setLoading(true);
		try {
			setLogs(await api.logs(100));
			setError(undefined);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "无法读取 logs");
		} finally {
			setLoading(false);
		}
	};

	useEffect(() => {
		void loadHealth();
		void loadTraces();
	}, []);

	const selectTab = (next: Tab): void => {
		setTab(next);
		if (next === "traces" && !traces) void loadTraces();
		if (next === "metrics" && !metrics) void loadMetrics();
		if (next === "logs" && !logs) void loadLogs();
	};

	const refresh = (): void => {
		void loadHealth();
		if (tab === "traces") void loadTraces();
		if (tab === "metrics") void loadMetrics();
		if (tab === "logs") void loadLogs();
	};

	return (
		<div
			className="st-dialog-backdrop"
			role="presentation"
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="st-dialog st-observability-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId}>
				<div className="st-observability-head">
					<h2 id={titleId}>Observability</h2>
					<div className="st-observability-head-actions">
						<button type="button" className="st-link-button" onClick={refresh} disabled={loading}>
							刷新
						</button>
						<button type="button" className="st-link-button" onClick={onClose}>
							关闭
						</button>
					</div>
				</div>

				{health ? (
					<div className="st-observability-health" aria-label="telemetry health">
						<div className={`st-observability-health-card ${statusClass(health.status)}`}>
							<span>整体</span>
							<strong>{health.status}</strong>
						</div>
						<div className={`st-observability-health-card ${statusClass(health.telemetry.trace.status)}`}>
							<span>Trace ring</span>
							<strong>
								{health.telemetry.trace.spanCount} / {health.telemetry.trace.maxSpans}
							</strong>
						</div>
						<div className={`st-observability-health-card ${statusClass(health.telemetry.metrics.status)}`}>
							<span>Metrics</span>
							<strong>{health.telemetry.metrics.seriesCount} series</strong>
						</div>
						<div className={`st-observability-health-card ${statusClass(health.telemetry.logs.status)}`}>
							<span>Logs</span>
							<strong>{health.telemetry.logs.fileCount} files</strong>
						</div>
					</div>
				) : null}

				<div className="st-observability-tabs" role="tablist" aria-label="observability sections">
					{(["traces", "metrics", "logs"] as const).map((item) => (
						<button
							key={item}
							type="button"
							role="tab"
							aria-selected={tab === item}
							className={`st-observability-tab${tab === item ? " is-active" : ""}`}
							onClick={() => selectTab(item)}
						>
							{item === "traces" ? "Traces" : item === "metrics" ? "Metrics" : "Logs"}
						</button>
					))}
				</div>

				{error ? (
					<p className="st-error" role="alert">
						{error}
					</p>
				) : null}

				{tab === "traces" ? (
					<>
						<div className="st-observability-filter">
							<select value={filterKind} onChange={(event) => setFilterKind(event.target.value as TraceFilterKind)}>
								<option value="thread">Thread</option>
								<option value="invocation">Invocation</option>
								<option value="turn">Turn</option>
								<option value="agent">Agent</option>
							</select>
							<input
								value={filterValue}
								placeholder={filterKind === "thread" ? "thread id" : filterKind === "agent" ? "agent id" : "id"}
								onChange={(event) => setFilterValue(event.target.value)}
							/>
							<button type="button" className="st-button st-button-secondary" onClick={() => void loadTraces()}>
								查询
							</button>
						</div>
						<div className="st-observability-trace-layout">
							<div className="st-observability-trace-list" role="list">
								{traces?.availability === "trace_unavailable" ? (
									<p className="st-field-note">
										Trace 不可用：{traces.reason === "telemetry_disabled" ? "telemetry 已关闭" : "ring 未命中"}
									</p>
								) : null}
								{traces?.spans.map((span) => (
									<button
										type="button"
										key={`${span.traceId}:${span.spanId}`}
										className={`st-observability-trace-row${selected?.spanId === span.spanId ? " is-selected" : ""}`}
										onClick={() => setSelected(span)}
									>
										<span className={`st-observability-span-status is-${span.status.code}`} aria-hidden="true" />
										<span className="st-observability-trace-name">{span.name}</span>
										<span className="st-observability-trace-duration">{Math.round(span.durationMs)} ms</span>
										<span className="st-observability-trace-id">{shortId(span.traceId)}</span>
									</button>
								))}
								{traces && traces.spans.length === 0 ? <p className="st-field-note">没有匹配的 trace。</p> : null}
							</div>
							{selected ? (
								<div className="st-observability-span-detail" aria-label="span detail">
									<h3>{selected.name}</h3>
									<dl>
										<dt>status</dt>
										<dd>{selected.status.code}</dd>
										<dt>duration</dt>
										<dd>{Math.round(selected.durationMs)} ms</dd>
										<dt>trace</dt>
										<dd>{shortId(selected.traceId)}</dd>
										<dt>span</dt>
										<dd>{shortId(selected.spanId)}</dd>
									</dl>
									<h4>Attributes</h4>
									<dl>
										{Object.entries(selected.attributes).map(([key, value]) => (
											<div key={key}>
												<dt>{key}</dt>
												<dd>{String(value)}</dd>
											</div>
										))}
									</dl>
									{selected.events.length > 0 ? (
										<>
											<h4>Events</h4>
											<ul>
												{selected.events.map((event, index) => (
													<li key={`${event.name}-${index}`}>
														{event.name}
														{event.attributes ? ` ${JSON.stringify(event.attributes)}` : ""}
													</li>
												))}
											</ul>
										</>
									) : null}
								</div>
							) : null}
						</div>
					</>
				) : null}

				{tab === "metrics" ? (
					<div className="st-observability-table-wrap">
						<table className="st-observability-table">
							<thead>
								<tr>
									<th>metric</th>
									<th>kind</th>
									<th>labels</th>
									<th>value</th>
								</tr>
							</thead>
							<tbody>
								{metrics?.series.map((series) => (
									<tr key={`${series.name}:${JSON.stringify(series.labels)}`}>
										<td>{series.name}</td>
										<td>{series.kind}</td>
										<td>{Object.entries(series.labels).map(([key, value]) => `${key}=${String(value)}`).join(", ")}</td>
										<td>{series.kind === "histogram" ? `${series.count ?? 0} / sum ${series.sum ?? 0}` : String(series.value ?? 0)}</td>
									</tr>
								))}
							</tbody>
						</table>
						{metrics && metrics.series.length === 0 ? <p className="st-field-note">还没有 metric。</p> : null}
					</div>
				) : null}

				{tab === "logs" ? (
					<div className="st-observability-log-list">
						{logs?.availability === "unavailable" ? (
							<p className="st-field-note">日志不可用（telemetry 已关闭或没有日志文件）。</p>
						) : null}
						{logs?.entries.map((entry, index) => (
							<article key={`${entry.ts}-${index}`}>
								<header>
									<span>{new Date(entry.ts).toLocaleTimeString()}</span>
									<span className={`st-observability-log-level is-${entry.level}`}>{entry.level}</span>
									<span>{entry.event}</span>
								</header>
								<pre>{JSON.stringify(entry.fields)}</pre>
							</article>
						))}
						{logs && logs.entries.length === 0 ? <p className="st-field-note">还没有日志。</p> : null}
					</div>
				) : null}
			</div>
		</div>
	);
}
