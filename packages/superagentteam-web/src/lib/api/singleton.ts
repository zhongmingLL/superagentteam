import { createApiClient } from "./client.ts";
import { getCsrfToken, setCsrfToken } from "./token.ts";

async function refreshCsrfToken(): Promise<boolean> {
	try {
		const response = await fetch("/api/session", { credentials: "include" });
		if (!response.ok) return false;
		const body = (await response.json()) as { csrfToken?: unknown };
		if (typeof body.csrfToken !== "string" || body.csrfToken === "") return false;
		setCsrfToken(body.csrfToken);
		return true;
	} catch {
		return false;
	}
}

export const api = createApiClient({ getCsrfToken, refreshCsrfToken });
