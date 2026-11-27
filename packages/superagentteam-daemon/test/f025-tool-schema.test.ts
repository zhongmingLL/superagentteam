import { describe, expect, it } from "vitest";

import { A2A_V1_TOOL_SPECS } from "../src/domains/a2a/tools/tool-surface.ts";

type JSONSchemaNode = Record<string, unknown>;

function assertTypedProperties(schema: unknown, path: string): void {
	if (typeof schema !== "object" || schema === null) return;
	const node = schema as JSONSchemaNode;
	const properties = node.properties;
	if (typeof properties === "object" && properties !== null && !Array.isArray(properties)) {
		for (const [name, property] of Object.entries(properties as Record<string, JSONSchemaNode>)) {
			expect(property, `${path}.${name} is missing type`).toHaveProperty("type");
			assertTypedProperties(property, `${path}.${name}`);
		}
	}
	if (node.items !== undefined) assertTypedProperties(node.items, `${path}[]`);
}

describe("F025 A2A v1 tool schema provider compatibility", () => {
	it("declares a type for every top-level property", () => {
		for (const spec of A2A_V1_TOOL_SPECS) {
			// Moonshot/Kimi rejects schemas such as { enum: [...] } or
			// { const: "agent" } without a type. Every property (including nested
			// array items) must be explicitly typed.
			assertTypedProperties(spec.inputSchema, spec.name);
		}
	});

	it("keeps multi_mention.triggerType a string enum", () => {
		const multi = A2A_V1_TOOL_SPECS.find((spec) => spec.name === "superagentteam_multi_mention")!;
		const schema = multi.inputSchema as {
			properties: { triggerType: { type?: string; enum?: string[] } };
		};
		expect(schema.properties.triggerType.type).toBe("string");
		expect(schema.properties.triggerType.enum).toContain("high-impact");
	});
});
