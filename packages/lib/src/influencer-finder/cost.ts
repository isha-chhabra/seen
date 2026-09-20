/**
 * Spending guard for one search. Every paid call is charged here at
 * deliberately high prices, and the pipeline asks the ledger how much it may
 * still buy before it buys, so a search stops at its cap instead of passing it.
 */

/** USD, rounded up from Bright Data's published rates ($1.50 per 1,000 records) so the cap errs on the safe side. */
export const PRICE = {
	searchRequest: 0.003,
	record: 0.0015,
	/** gpt-5-mini list price, per token. */
	llmInputToken: 0.25 / 1_000_000,
	llmOutputToken: 2 / 1_000_000,
	/** Hidden reasoning tokens the model spends before it answers. */
	llmReasoningTokens: 900,
} as const;

export class CostLedger {
	searches = 0;
	records = 0;
	private llmUsd = 0;

	constructor(readonly capUsd: number) {}

	spent(): number {
		return this.searches * PRICE.searchRequest + this.records * PRICE.record + this.llmUsd;
	}

	/** Money left after setting `reserve` aside (for the AI judging that must still happen). */
	remaining(reserve = 0): number {
		return this.capUsd - this.spent() - reserve;
	}

	/** How many records can still be bought within the cap, leaving `reserve` untouched. */
	affordableRecords(reserve = 0): number {
		return Math.max(0, Math.floor(this.remaining(reserve) / PRICE.record));
	}

	canSearch(reserve = 0): boolean {
		return this.remaining(reserve) >= PRICE.searchRequest;
	}

	chargeSearch(): void {
		this.searches += 1;
	}

	chargeRecords(count: number): void {
		this.records += Math.max(0, count);
	}

	/** Estimates a model call from the prompt and answer sizes (about 4 characters per token). */
	chargeLlm(promptChars: number, outputChars: number): void {
		const input = promptChars / 4;
		const output = outputChars / 4 + PRICE.llmReasoningTokens;
		this.llmUsd += input * PRICE.llmInputToken + output * PRICE.llmOutputToken;
	}

	/** Enough left to make one more model call of a typical size. */
	canAffordLlm(): boolean {
		return this.remaining() >= 0.004;
	}

	snapshot() {
		return {
			usd: Math.round(this.spent() * 10_000) / 10_000,
			capUsd: this.capUsd,
			searches: this.searches,
			records: this.records,
		};
	}
}

/**
 * Rough cost of a search before it runs, for the estimate on the form. Measured on a real run:
 * about half the creators looked up are kept, each analysed creator costs two records (the post that
 * found them and their profile), each kept creator three more posts for engagement, plus the searches
 * (more of them when more creators are wanted) and the AI reading.
 */
const PER_KEPT = { low: 0.0105, high: 0.016 };
const FIXED = { low: 0.06, high: 0.09 };

export function estimateSearchCost(creators: number): { low: number; high: number } {
	return {
		low: round(FIXED.low + creators * PER_KEPT.low),
		high: round(FIXED.high + creators * PER_KEPT.high),
	};
}

/** About how many creators a spending limit reaches. */
export function estimateCreatorsForLimit(capUsd: number): number {
	return Math.max(0, Math.floor((capUsd - FIXED.low) / ((PER_KEPT.low + PER_KEPT.high) / 2)));
}

const round = (n: number) => Math.round(n * 100) / 100;
