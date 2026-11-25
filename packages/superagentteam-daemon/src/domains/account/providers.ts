// F030.5a: the account provider view is generated from pi's provider registry
// and env-key map. Do not add a second hand-written provider list here.
import { GENERATED_ACCOUNT_PROVIDERS } from "./provider-catalog.generated.ts";
import type { AccountProvider } from "./provider-types.ts";

export type { AccountProvider } from "./provider-types.ts";

export const ACCOUNT_PROVIDERS = GENERATED_ACCOUNT_PROVIDERS;

export function findAccountProvider(id: string): AccountProvider | undefined {
	return ACCOUNT_PROVIDERS.find((provider) => provider.id === id);
}
