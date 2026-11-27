import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { checkWritePath } from "../src/infrastructure/supervisor/write-path.ts";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
	for (const close of closers.splice(0)) await close();
});

async function startServer(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<number> {
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	closers.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
	return (server.address() as AddressInfo).port;
}

const hubOrigin = "http://localhost:3005";

describe("runtime write-path smoke", () => {
	it("passes when the Origin-bearing write reaches validation", async () => {
		const port = await startServer((request, response) => {
			if (request.method === "GET" && request.url === "/api/session") {
				expect(request.headers.origin).toBe(hubOrigin);
				response.writeHead(200, { "content-type": "application/json", "set-cookie": "sat=1; Path=/" });
				response.end(JSON.stringify({ csrfToken: "csrf-1" }));
				return;
			}
			if (request.method === "POST" && request.url === "/api/agents") {
				expect(request.headers.origin).toBe(hubOrigin);
				expect(request.headers["x-csrf-token"]).toBe("csrf-1");
				expect(request.headers.cookie).toBe("sat=1");
				request.resume();
				response.writeHead(400, { "content-type": "application/json" });
				response.end(JSON.stringify({ error: "invalid_input", message: "displayName is required" }));
				return;
			}
			response.writeHead(404);
			response.end();
		});
		const result = await checkWritePath({ daemonPort: port, hubOrigin });
		expect(result).toMatchObject({ ok: true, status: 400 });
	});

	it("fails when the daemon rejects the Origin", async () => {
		const port = await startServer((request, response) => {
			if (request.method === "GET" && request.url === "/api/session") {
				response.writeHead(200, { "content-type": "application/json", "set-cookie": "sat=1; Path=/" });
				response.end(JSON.stringify({ csrfToken: "csrf-1" }));
				return;
			}
			request.resume();
			response.writeHead(403, { "content-type": "application/json" });
			response.end(JSON.stringify({ error: "forbidden", message: "origin not allowed" }));
		});
		const result = await checkWritePath({ daemonPort: port, hubOrigin });
		expect(result).toMatchObject({ ok: false, status: 403 });
	});

	it("fails when the session cannot be established", async () => {
		const port = await startServer((request, response) => {
			request.resume();
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ csrfToken: "csrf-1" }));
		});
		const result = await checkWritePath({ daemonPort: port, hubOrigin });
		expect(result).toMatchObject({ ok: false, status: 401 });
	});
});
