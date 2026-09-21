import { describe, expect, it } from "vitest";
import { profileFilter } from "./datasets";

type Group = { operator?: string; filters?: Group[]; name?: string };
/** Levels of groups; a single rule is not a level. */
const depth = (g: Group): number => (g.filters ? 1 + Math.max(0, ...g.filters.map(depth)) : 0);
const widest = (g: Group): number => Math.max(g.filters?.length ?? 0, ...(g.filters ?? []).map(widest));

const search = { keywords: ["a1", "b2", "c3"], minFollowers: 10_000, maxFollowers: 500_000, exclude: ["x"], limit: 10 };

describe("profileFilter", () => {
	it("stays inside Bright Data's limits (4 rules per group, 3 levels) even with many keywords and every option", () => {
		const many = Array.from({ length: 16 }, (_, i) => `word ${i}`);
		const f = profileFilter({ ...search, keywords: many }) as Group;
		expect(widest(f)).toBeLessThanOrEqual(4);
		expect(depth(f)).toBeLessThanOrEqual(3);
	});

	it("matches any keyword in the bio, within the follower range, leaving out seen handles", () => {
		const f = profileFilter(search) as Group;
		expect(f.operator).toBe("and");
		const names = (f.filters ?? []).map((x) => x.name ?? x.operator);
		expect(names).toEqual(["or", "followers", "followers", "account"]);
	});

	it("leaves out the upper follower bound and the exclusion when there are none", () => {
		const f = profileFilter({ ...search, maxFollowers: null, exclude: [] }) as Group;
		expect((f.filters ?? []).length).toBe(2);
	});
});
