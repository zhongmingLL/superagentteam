#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const POWERSHELL = "power" + "shell.exe";
const WSLPATH = "wsl" + "path";
const port = Number(process.env.SUPERAGENTTEAM_WINDOWS_PROXY_PORT ?? "3103");
const action = process.argv[2] ?? "check";
const scriptPath = fileURLToPath(new URL("./windows-proxy.ps1", import.meta.url));
const bridgePath = fileURLToPath(new URL("./wsl-tcp-bridge.py", import.meta.url));

function windowsPath(path) {
	return execFileSync(WSLPATH, ["-w", path], { encoding: "utf8" }).trim();
}

function runProxy(args) {
	return execFileSync(POWERSHELL, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ...args], {
		encoding: "utf8",
	});
}

async function httpStatus(path) {
	try {
		const response = await fetch(`http://localhost:${port}${path}`, { signal: AbortSignal.timeout(5000) });
		return response.status;
	} catch {
		return 0;
	}
}

const winScript = windowsPath(scriptPath);

if (action === "check") {
	let listener;
	try {
		listener = runProxy([winScript, "-Check", "-ListenPort", String(port)]).trim();
	} catch (error) {
		console.error(`windows proxy check failed: ${error instanceof Error ? error.message : String(error)}`);
		process.exit(1);
	}
	const root = await httpStatus("/");
	const session = await httpStatus("/api/session");
	const ok = listener !== "" && root === 200 && session === 200;
	console.log(JSON.stringify({ ok, port, listener, root, session }, null, 2));
	process.exit(ok ? 0 : 1);
}

if (action === "print") {
	console.log(
		`${POWERSHELL} -NoProfile -ExecutionPolicy Bypass -File "${winScript}" -ListenPort ${port} -BridgePath "${bridgePath}"`,
	);
	process.exit(0);
}

console.error("usage: node scripts/superagentteam/windows-proxy.mjs <check|print>");
process.exit(1);
