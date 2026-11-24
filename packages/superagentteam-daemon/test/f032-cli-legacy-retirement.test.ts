import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = join(process.cwd(), "dist/cli.js");

function run(args: readonly string[]): { status: number | null; stdout: string; stderr: string } {
	const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
	return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function errorOf(result: { status: number | null; stderr: string }): { code: string; message: string } {
	if (result.status === 0) throw new Error("cli unexpectedly succeeded");
	const line = result.stderr
		.split(/\r?\n/)
		.find((candidate) => candidate.trim().startsWith("{") && candidate.includes('"error"'));
	if (!line) throw new Error(`cli produced no JSON error: ${result.stderr}`);
	return (JSON.parse(line) as { error: { code: string; message: string } }).error;
}

const RETIRED_COMMANDS = [
	"backlog",
	"sop",
	"task",
	"approval",
	"budget",
	"deployment",
	"schedule",
	"session",
	"profile",
	"gate",
	"merge",
	"eval",
] as const;

describe("F032 legacy CLI retirement", () => {
	it("rejects the retired legacy thread engine with a typed error", () => {
		const error = errorOf(run(["thread", "list", "--engine", "legacy"]));
		expect(error.code).toBe("legacy_engine_retired");
		expect(error.message).toMatch(/A2A/);
	});

	it("still accepts the explicit a2a engine selection", () => {
		const result = run(["thread", "--engine", "a2a", "list", "--help"]);
		expect(result.status).toBe(0);
	});

	it("rejects unknown engines without advertising the legacy path", () => {
		const error = errorOf(run(["thread", "list", "--engine", "bogus"]));
		expect(error.code).toBe("invalid_input");
		expect(error.message).toContain("a2a");
		expect(error.message).not.toContain("legacy");
	});

	for (const command of RETIRED_COMMANDS) {
		it(`retires the ${command} command with a typed error`, () => {
			const error = errorOf(run([command]));
			expect(error.code).toBe("legacy_command_retired");
			expect(error.message).toContain(command);
			expect(error.message).toMatch(/A2A|thread/);
		});
	}

	it("does not advertise retired commands or the legacy engine in help", () => {
		const help = run(["--help"]).stdout;
		expect(help).toContain("usage: superagentteam <command>");
		expect(help).toContain("  thread <create|list|show|post|tail>");
		expect(help).toContain("  daemon <status|stop>");
		expect(help).toContain("  memory ");
		expect(help).not.toContain("--engine");
		for (const command of RETIRED_COMMANDS) {
			expect(help).not.toMatch(new RegExp(`^  ${command} `, "m"));
		}
	});
});
