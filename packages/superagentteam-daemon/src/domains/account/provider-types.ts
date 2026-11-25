export type AccountProviderAuthKind = "simple-env" | "composite" | "dynamic";

export interface AccountProvider {
	readonly id: string;
	readonly label: string;
	readonly envName: string;
	readonly envNames: readonly string[];
	readonly supportsBaseUrl: boolean;
	readonly suggestedModels: readonly string[];
	readonly authKind: AccountProviderAuthKind;
	readonly selectable: boolean;
	readonly api?: string;
}
