import type { KeyObject } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveControlDataDir } from "../app/data-dir.ts";
import { loadOperatorPrivateKey, operatorCredentialPaths, signOperatorPayload } from "../domains/access/operator.ts";
import { principalFromOperatorProof } from "../domains/access/principals.ts";
import { ControlError } from "../shared/control/errors.ts";
import { flag, option, type ParsedArgs } from "./args.ts";

export interface CliCommandContext {
	readonly dataDir: string;
	readonly json: boolean;
}

export interface OperatorContext {
	readonly id: string;
	readonly privateKey: KeyObject;
	readonly publicKeyPem: string;
}

export function openCliCommandContext(args: ParsedArgs): CliCommandContext {
	return { dataDir: resolveControlDataDir(option(args, "data-dir")), json: flag(args, "json") };
}

export function requireOperator(context: { readonly dataDir: string }): OperatorContext {
	const paths = operatorCredentialPaths(context.dataDir);
	const privateKey = loadOperatorPrivateKey(context.dataDir);
	const publicKeyPem = readFileSync(paths.publicKeyPath, "utf8");
	const payload = `codeteam-cli:${process.pid}:${Date.now()}`;
	const signature = signOperatorPayload(privateKey, payload);
	const principal = principalFromOperatorProof({ publicKeyPem, payload, signature });
	if (principal.kind !== "operator") {
		throw new ControlError("forbidden", "operator credential did not resolve to an operator principal");
	}
	return { id: principal.id, privateKey, publicKeyPem };
}
