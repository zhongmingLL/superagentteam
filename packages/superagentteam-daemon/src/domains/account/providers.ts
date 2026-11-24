// F030: v1 API-key provider catalog. Provider ids mirror the pi model catalog
// and its default environment key names (packages/ai/src/env-api-keys.ts).

export interface AccountProvider {
	readonly id: string;
	readonly label: string;
	readonly envName: string;
	readonly supportsBaseUrl: boolean;
}

export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = [
	{ id: "kimi-coding", label: "Kimi For Coding", envName: "KIMI_API_KEY", supportsBaseUrl: true },
	{ id: "anthropic", label: "Anthropic", envName: "ANTHROPIC_API_KEY", supportsBaseUrl: true },
	{ id: "openai", label: "OpenAI", envName: "OPENAI_API_KEY", supportsBaseUrl: true },
	{ id: "google", label: "Google Gemini", envName: "GEMINI_API_KEY", supportsBaseUrl: true },
	{ id: "zai", label: "Z.AI", envName: "ZAI_API_KEY", supportsBaseUrl: true },
	{ id: "minimax", label: "MiniMax", envName: "MINIMAX_API_KEY", supportsBaseUrl: true },
	{ id: "deepseek", label: "DeepSeek", envName: "DEEPSEEK_API_KEY", supportsBaseUrl: true },
	{ id: "openrouter", label: "OpenRouter", envName: "OPENROUTER_API_KEY", supportsBaseUrl: true },
	{ id: "xai", label: "xAI", envName: "XAI_API_KEY", supportsBaseUrl: true },
	{ id: "groq", label: "Groq", envName: "GROQ_API_KEY", supportsBaseUrl: true },
];

export function findAccountProvider(id: string): AccountProvider | undefined {
	return ACCOUNT_PROVIDERS.find((provider) => provider.id === id);
}
