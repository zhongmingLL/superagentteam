export interface ApiErrorBody {
	error?: string;
	message?: string;
	[key: string]: unknown;
}

export class ApiError extends Error {
	readonly status: number;
	readonly code: string;
	readonly body: unknown;

	constructor(status: number, code: string, message: string, body: unknown) {
		super(message);
		this.name = "ApiError";
		this.status = status;
		this.code = code;
		this.body = body;
	}
}

let unauthorizedHandler: (() => void) | undefined;

export function setUnauthorizedHandler(handler: (() => void) | undefined): void {
	unauthorizedHandler = handler;
}

export interface ApiClientOptions {
	baseUrl?: string;
	fetchImpl?: typeof fetch;
	getCsrfToken?: () => string | undefined;
	/** Called once when a write is rejected with 403 `csrf_failed`; retry only if it returns true. */
	refreshCsrfToken?: () => Promise<boolean>;
}

export interface ApiClient {
	request<T>(path: string, init?: RequestInit): Promise<T>;
	get<T>(path: string): Promise<T>;
	post<T>(path: string, body: unknown): Promise<T>;
}

export function createApiClient(options: ApiClientOptions = {}): ApiClient {
	const baseUrl = options.baseUrl ?? "";
	const fetchImpl = options.fetchImpl ?? fetch;

	async function request<T>(path: string, init: RequestInit = {}, retried = false): Promise<T> {
		const headers = new Headers(init.headers);
		const method = (init.method ?? "GET").toUpperCase();
		if (init.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
		if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
			const csrf = options.getCsrfToken?.();
			if (csrf) headers.set("x-csrf-token", csrf);
		}
		const response = await fetchImpl(`${baseUrl}${path}`, { ...init, headers, credentials: "include" });
		const text = await response.text();
		let body: unknown;
		if (text !== "") {
			try {
				body = JSON.parse(text) as unknown;
			} catch {
				body = text;
			}
		}
		if (!response.ok) {
			if (response.status === 401) unauthorizedHandler?.();
			const errorBody = typeof body === "object" && body !== null ? (body as ApiErrorBody) : undefined;
			const code = typeof errorBody?.error === "string" ? errorBody.error : `http_${response.status}`;
			const refresh = options.refreshCsrfToken;
			const canRetry =
				response.status === 403 &&
				code === "csrf_failed" &&
				!retried &&
				refresh !== undefined &&
				(init.body === undefined || typeof init.body === "string");
			if (canRetry) {
				const refreshed = await refresh().catch(() => false);
				if (refreshed) return request<T>(path, init, true);
			}
			throw new ApiError(
				response.status,
				code,
				typeof errorBody?.message === "string" ? errorBody.message : response.statusText,
				body,
			);
		}
		return body as T;
	}

	return {
		request,
		get: (path) => request(path),
		post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body) }),
	};
}
