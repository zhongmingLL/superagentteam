// F030: v1 API-key provider catalog. Provider ids mirror the pi model catalog
// and its default environment key names (packages/ai/src/env-api-keys.ts).

export interface AccountProvider {
	readonly id: string;
	readonly label: string;
	readonly envName: string;
	readonly supportsBaseUrl: boolean;
	readonly suggestedModels: readonly string[];
}

export const ACCOUNT_PROVIDERS: readonly AccountProvider[] = [
	{
		id: "kimi-coding",
		label: "Kimi For Coding",
		envName: "KIMI_API_KEY",
		supportsBaseUrl: true,
		suggestedModels: ["kimi-for-coding"],
	},
	{ id: "anthropic", label: "Anthropic", envName: "ANTHROPIC_API_KEY", supportsBaseUrl: true, suggestedModels: [] },
	{ id: "openai", label: "OpenAI", envName: "OPENAI_API_KEY", supportsBaseUrl: true, suggestedModels: [] },
	{ id: "google", label: "Google Gemini", envName: "GEMINI_API_KEY", supportsBaseUrl: true, suggestedModels: [] },
	{
		id: "zai",
		label: "Z.AI / 智谱 GLM",
		envName: "ZAI_API_KEY",
		supportsBaseUrl: true,
		suggestedModels: ["glm-5.2", "glm-5-turbo", "glm-4.7"],
	},
	{ id: "minimax", label: "MiniMax", envName: "MINIMAX_API_KEY", supportsBaseUrl: true, suggestedModels: [] },
	{
		id: "deepseek",
		label: "DeepSeek",
		envName: "DEEPSEEK_API_KEY",
		supportsBaseUrl: true,
		suggestedModels: ["deepseek-chat", "deepseek-reasoner"],
	},
	{ id: "openrouter", label: "OpenRouter", envName: "OPENROUTER_API_KEY", supportsBaseUrl: true, suggestedModels: [] },
	{ id: "xai", label: "xAI", envName: "XAI_API_KEY", supportsBaseUrl: true, suggestedModels: [] },
	{ id: "groq", label: "Groq", envName: "GROQ_API_KEY", supportsBaseUrl: true, suggestedModels: [] },
];

export function findAccountProvider(id: string): AccountProvider | undefined {
	return ACCOUNT_PROVIDERS.find((provider) => provider.id === id);
}
