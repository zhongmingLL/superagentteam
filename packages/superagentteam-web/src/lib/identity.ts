export function toneFor(seed: string): number {
	let hash = 0;
	for (let index = 0; index < seed.length; index += 1) hash = (hash * 31 + seed.charCodeAt(index)) | 0;
	return (Math.abs(hash) % 6) + 1;
}

export function initialForName(name: string | null | undefined): string {
	const trimmed = name?.trim() ?? "";
	if (trimmed === "") return "#";
	const agent = trimmed.match(/^Agent\s+(\S+)/i);
	if (agent) return agent[1]!.slice(0, 1).toUpperCase();
	return trimmed.slice(0, 1).toUpperCase();
}

export function initialForThread(title: string | null | undefined): string {
	const trimmed = title?.trim() ?? "";
	const thread = trimmed.match(/Thread\s+(\S+)/i);
	if (thread) return thread[1]!.slice(0, 1).toUpperCase();
	return initialForName(trimmed);
}
