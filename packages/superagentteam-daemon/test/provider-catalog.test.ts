import { describe, expect, it } from "vitest";
import { ACCOUNT_PROVIDERS, findAccountProvider } from "../src/domains/account/providers.ts";

describe("generated account provider catalog", () => {
	it("is derived from the full pi API-key provider set", () => {
		expect(ACCOUNT_PROVIDERS.length).toBeGreaterThanOrEqual(40);
		expect(new Set(ACCOUNT_PROVIDERS.map((provider) => provider.id)).size).toBe(ACCOUNT_PROVIDERS.length);
		expect(findAccountProvider("openai-codex")).toBeUndefined();
	});

	it("keeps GLM discoverable with generated labels and model suggestions", () => {
		const zai = findAccountProvider("zai");
		expect(zai).toMatchObject({ label: "Z.AI / 智谱 GLM", selectable: true, authKind: "simple-env" });
		expect(zai?.suggestedModels).toEqual(expect.arrayContaining(["glm-5.2", "glm-4.7"]));
	});

	it("keeps composite-auth providers visible but non-selectable", () => {
		expect(findAccountProvider("amazon-bedrock")).toMatchObject({
			authKind: "composite",
			selectable: false,
		});
		expect(findAccountProvider("google-vertex")).toMatchObject({
			authKind: "composite",
			selectable: false,
		});
	});
});
