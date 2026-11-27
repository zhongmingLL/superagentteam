import { randomUUID } from "node:crypto";
import { resolveDaemonPaths } from "../app/paths.ts";
import { readStateFile } from "../app/state.ts";
import { operatorCredentialPaths, signOperatorPayload } from "../domains/access/operator.ts";
import { authorizationPayload, StopOperationService } from "../infrastructure/process/index.ts";
import { ControlError } from "../shared/control/errors.ts";
import { envValue } from "../shared/env.ts";
import { option, type ParsedArgs } from "./args.ts";
import { type CliCommandContext, requireOperator } from "./context.ts";
import { writeJson, writeLine } from "./output.ts";

function daemonService(context: CliCommandContext, args: ParsedArgs): StopOperationService {
	return new StopOperationService({
		dataDir: context.dataDir,
		deploymentId: option(args, "deployment-id") ?? envValue(process.env, "DEPLOYMENT_ID") ?? "local",
		installationRoot:
			option(args, "installation-root") ?? envValue(process.env, "INSTALLATION_ROOT") ?? process.cwd(),
	});
}

export async function runDaemonCommand(args: ParsedArgs, context: CliCommandContext): Promise<number> {
	const subcommand = args.positionals[0];
	if (subcommand === "status") {
		const status = daemonService(context, args).status();
		if (context.json) writeJson(status);
		else {
			writeLine(
				`daemon state=${status.daemonState?.state ?? "unknown"} boot=${status.daemonState?.bootId ?? "-"} sequence=${status.daemonState?.bootSequence ?? "-"}`,
			);
			if (status.latestOperation) {
				writeLine(`lifecycle op=${status.latestOperation.opId} state=${status.latestOperation.state}`);
			}
		}
		return 0;
	}
	if (subcommand === "stop") {
		const operator = requireOperator(context);
		const daemonPaths = resolveDaemonPaths(context.dataDir);
		const state = readStateFile(daemonPaths.stateFile);
		if (!state) throw new ControlError("not_found", "daemon state is not available");
		const deploymentId = option(args, "deployment-id") ?? envValue(process.env, "DEPLOYMENT_ID") ?? "local";
		const opId = `lifecycle_${randomUUID()}`;
		const keyFingerprint = operatorCredentialPaths(context.dataDir).fingerprint;
		const authorization = {
			opId,
			deploymentId,
			stoppedBootId: state.bootId,
			action: "halt" as const,
			operatorRef: `operator:${operator.id}`,
			keyFingerprint,
			signature: signOperatorPayload(
				operator.privateKey,
				authorizationPayload(opId, deploymentId, state.bootId, "halt"),
			),
		};
		const service = daemonService(context, args);
		service.requestStop(authorization);
		const record = await service.executeStop(opId);
		if (context.json) writeJson(record);
		else writeLine(`lifecycle ${record.opId} state=${record.state}`);
		return 0;
	}
	throw new ControlError("invalid_input", "usage: superagentteam daemon <status|stop>");
}
