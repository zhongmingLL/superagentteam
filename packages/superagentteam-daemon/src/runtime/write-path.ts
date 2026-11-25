export interface WritePathCheckResult {
	readonly ok: boolean;
	readonly status: number;
	readonly detail: string;
}

export interface WritePathCheckOptions {
	readonly daemonPort: number;
	readonly hubOrigin: string;
	readonly fetchImpl?: typeof fetch;
}

/**
 * Safe smoke for the browser write path: exchanges the local dev session,
 * then posts an invalid agent payload with an Origin header. A 400/422 means
 * the request passed the origin/session/CSRF gates and reached validation;
 * 403/401 means the page would be unable to write.
 */
export async function checkWritePath(options: WritePathCheckOptions): Promise<WritePathCheckResult> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const base = `http://127.0.0.1:${options.daemonPort}`;
	try {
		const session = await fetchImpl(`${base}/api/session`, {
			headers: { origin: options.hubOrigin },
			signal: AbortSignal.timeout(5_000),
		});
		if (!session.ok) return { ok: false, status: session.status, detail: `session ${session.status}` };
		const cookie = (session.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
		const sessionBody = (await session.json()) as { csrfToken?: unknown };
		const csrfToken = typeof sessionBody.csrfToken === "string" ? sessionBody.csrfToken : "";
		if (cookie === "" || csrfToken === "") {
			return { ok: false, status: 401, detail: "session cookie or CSRF token missing" };
		}
		const response = await fetchImpl(`${base}/api/agents`, {
			method: "POST",
			headers: {
				origin: options.hubOrigin,
				"content-type": "application/json",
				"x-csrf-token": csrfToken,
				cookie,
			},
			body: "{}",
			signal: AbortSignal.timeout(5_000),
		});
		const detail = (await response.text()).slice(0, 200);
		return { ok: response.status === 400 || response.status === 422, status: response.status, detail };
	} catch (error) {
		return { ok: false, status: 0, detail: error instanceof Error ? error.message : String(error) };
	}
}
