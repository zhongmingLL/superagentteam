import { describe, expect, it, vi } from "vitest";

import { ApiError, createApiClient } from "@/lib/api/client.ts";

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

describe("api client", () => {
	it("loads JSON with credentials and returns the parsed body", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ userId: "operator:1", csrfToken: "csrf" }));
		const client = createApiClient({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			getCsrfToken: () => "csrf",
		});

		await expect(client.get<{ userId: string }>("/api/session")).resolves.toMatchObject({
			userId: "operator:1",
		});
		expect(fetchImpl).toHaveBeenCalledWith("/api/session", expect.objectContaining({ credentials: "include" }));
	});

	it("adds the CSRF token to writes", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ id: "thread:1" }));
		const client = createApiClient({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			getCsrfToken: () => "csrf-1",
		});

		await client.post("/api/threads", { projectPath: "/tmp/p", idempotencyKey: "k" });

		const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
		const headers = new Headers(init?.headers);
		expect(headers.get("x-csrf-token")).toBe("csrf-1");
		expect(init?.body).toBe(JSON.stringify({ projectPath: "/tmp/p", idempotencyKey: "k" }));
	});

	it("throws a typed error for 401", async () => {
		const fetchImpl = vi.fn(async () =>
			jsonResponse({ error: "unauthorized", message: "missing browser session" }, 401),
		);
		const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

		await expect(client.get("/api/session")).rejects.toMatchObject({
			name: "ApiError",
			status: 401,
			code: "unauthorized",
			message: "missing browser session",
		});
	});

	it("keeps non-JSON error bodies observable", async () => {
		const fetchImpl = vi.fn(async () => new Response("<html>oops</html>", { status: 500 }));
		const client = createApiClient({ fetchImpl: fetchImpl as unknown as typeof fetch });

		const error = await client.get("/api/session").catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(ApiError);
		expect(error).toMatchObject({ status: 500, code: "http_500", body: "<html>oops</html>" });
	});

	it("refreshes the CSRF token and retries a csrf_failed write once", async () => {
		let token = "csrf-old";
		const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
			const csrf = new Headers(init?.headers).get("x-csrf-token");
			if (csrf === "csrf-old") return jsonResponse({ error: "csrf_failed", message: "invalid CSRF token" }, 403);
			return jsonResponse({ id: "thread:1" });
		});
		const refreshCsrfToken = vi.fn(async () => {
			token = "csrf-new";
			return true;
		});
		const client = createApiClient({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			getCsrfToken: () => token,
			refreshCsrfToken,
		});

		await expect(client.post("/api/threads", { projectPath: "/tmp/p" })).resolves.toEqual({ id: "thread:1" });
		expect(refreshCsrfToken).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
		const retryInit = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
		expect(new Headers(retryInit.headers).get("x-csrf-token")).toBe("csrf-new");
	});

	it("surfaces the original csrf_failed error when the refresh fails", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ error: "csrf_failed", message: "invalid CSRF token" }, 403));
		const refreshCsrfToken = vi.fn(async () => false);
		const client = createApiClient({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			getCsrfToken: () => "csrf-old",
			refreshCsrfToken,
		});

		await expect(client.post("/api/threads", { projectPath: "/tmp/p" })).rejects.toMatchObject({
			status: 403,
			code: "csrf_failed",
		});
		expect(refreshCsrfToken).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledTimes(1);
	});

	it("retries at most once when the session remains stale", async () => {
		const fetchImpl = vi.fn(async () => jsonResponse({ error: "csrf_failed", message: "invalid CSRF token" }, 403));
		const refreshCsrfToken = vi.fn(async () => true);
		const client = createApiClient({
			fetchImpl: fetchImpl as unknown as typeof fetch,
			getCsrfToken: () => "csrf-old",
			refreshCsrfToken,
		});

		await expect(client.post("/api/threads", { projectPath: "/tmp/p" })).rejects.toMatchObject({
			status: 403,
			code: "csrf_failed",
		});
		expect(refreshCsrfToken).toHaveBeenCalledTimes(1);
		expect(fetchImpl).toHaveBeenCalledTimes(2);
	});
});
