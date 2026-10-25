import { describe, expect, test } from 'vitest';
import { QueryBuilder as CockroachQueryBuilder } from '~/cockroach-core';
import { QueryBuilder as MsSqlQueryBuilder } from '~/mssql-core';
import { QueryBuilder as MySqlQueryBuilder } from '~/mysql-core';
import { QueryBuilder as SingleStoreQueryBuilder } from '~/singlestore-core';
import { sql } from '~/sql';
import { QueryBuilder as SQLiteQueryBuilder } from '~/sqlite-core';

const cases = [
	{
		name: 'MySql',
		prefix: 'with recursive ',
		quote: '`',
		closeQuote: '`',
		param: '?',
		build: () => {
			const qb = new MySqlQueryBuilder();
			const fields = { n: sql<number>`0`.as('value') };
			const recursive = qb.$withRecursive('numbers', fields).as((_qb, self) =>
				sql`select ${1} as value union all select ${self.n} + 1 from ${self} where ${self.n} < ${3}`
			);
			const ordinary = qb.$with('ordinary').as(qb.select(fields).from(sql`source`));
			const inferred = qb.$withRecursive('inferred').as((qb) => qb.select(fields).from(sql`source`));
			return {
				recursive: qb.with(recursive).select().from(recursive).toSQL(),
				mixed: qb.with(ordinary, recursive, inferred).select().from(inferred).toSQL(),
				ordinary: qb.with(ordinary).select().from(ordinary).toSQL(),
				empty: qb.with().select(fields).from(sql`source`).toSQL(),
			};
		},
	},
	{
		name: 'SQLite',
		prefix: 'with recursive ',
		quote: '"',
		closeQuote: '"',
		param: '?',
		build: () => {
			const qb = new SQLiteQueryBuilder();
			const fields = { n: sql<number>`0`.as('value') };
			const recursive = qb.$withRecursive('numbers', fields).as((_qb, self) =>
				sql`select ${1} as value union all select ${self.n} + 1 from ${self} where ${self.n} < ${3}`
			);
			const ordinary = qb.$with('ordinary').as(qb.select(fields).from(sql`source`));
			const inferred = qb.$withRecursive('inferred').as((qb) => qb.select(fields).from(sql`source`));
			return {
				recursive: qb.with(recursive).select().from(recursive).toSQL(),
				mixed: qb.with(ordinary, recursive, inferred).select().from(inferred).toSQL(),
				ordinary: qb.with(ordinary).select().from(ordinary).toSQL(),
				empty: qb.with().select(fields).from(sql`source`).toSQL(),
			};
		},
	},
	{
		name: 'Cockroach',
		prefix: 'with recursive ',
		quote: '"',
		closeQuote: '"',
		param: '$1',
		build: () => {
			const qb = new CockroachQueryBuilder();
			const fields = { n: sql<number>`0`.as('value') };
			const recursive = qb.$withRecursive('numbers', fields).as((_qb, self) =>
				sql`select ${1} as value union all select ${self.n} + 1 from ${self} where ${self.n} < ${3}`
			);
			const ordinary = qb.$with('ordinary').as(qb.select(fields).from(sql`source`));
			const inferred = qb.$withRecursive('inferred').as((qb) => qb.select(fields).from(sql`source`));
			return {
				recursive: qb.with(recursive).select().from(recursive).toSQL(),
				mixed: qb.with(ordinary, recursive, inferred).select().from(inferred).toSQL(),
				ordinary: qb.with(ordinary).select().from(ordinary).toSQL(),
				empty: qb.with().select(fields).from(sql`source`).toSQL(),
			};
		},
	},
	{
		name: 'SingleStore',
		prefix: 'with recursive ',
		quote: '`',
		closeQuote: '`',
		param: '?',
		build: () => {
			const qb = new SingleStoreQueryBuilder();
			const fields = { n: sql<number>`0`.as('value') };
			const recursive = qb.$withRecursive('numbers', fields).as((_qb, self) =>
				sql`select ${1} as value union all select ${self.n} + 1 from ${self} where ${self.n} < ${3}`
			);
			const ordinary = qb.$with('ordinary').as(qb.select(fields).from(sql`source`));
			const inferred = qb.$withRecursive('inferred').as((qb) => qb.select(fields).from(sql`source`));
			return {
				recursive: qb.with(recursive).select().from(recursive).toSQL(),
				mixed: qb.with(ordinary, recursive, inferred).select().from(inferred).toSQL(),
				ordinary: qb.with(ordinary).select().from(ordinary).toSQL(),
				empty: qb.with().select(fields).from(sql`source`).toSQL(),
			};
		},
	},
	{
		name: 'MsSql',
		prefix: 'with ',
		quote: '[',
		closeQuote: ']',
		param: '@par0',
		build: () => {
			const qb = new MsSqlQueryBuilder();
			const fields = { n: sql<number>`0`.as('value') };
			const recursive = qb.$withRecursive('numbers', fields).as((_qb, self) =>
				sql`select ${1} as value union all select ${self.n} + 1 from ${self} where ${self.n} < ${3}`
			);
			const ordinary = qb.$with('ordinary').as(qb.select(fields).from(sql`source`));
			const inferred = qb.$withRecursive('inferred').as((qb) => qb.select(fields).from(sql`source`));
			return {
				recursive: qb.with(recursive).select().from(recursive).toSQL(),
				mixed: qb.with(ordinary, recursive, inferred).select().from(inferred).toSQL(),
				ordinary: qb.with(ordinary).select().from(ordinary).toSQL(),
				empty: qb.with().select(fields).from(sql`source`).toSQL(),
			};
		},
	},
];

describe.each(cases)('$name recursive CTE SQL', ({ build, prefix, quote, closeQuote, param }) => {
	test('uses dialect syntax, typed self aliases and bound parameters', () => {
		const { recursive } = build();
		expect(recursive.sql).toBe(
			`${prefix}${quote}numbers${closeQuote} as (select ${param} as value union all select ${quote}numbers${closeQuote}.${quote}value${closeQuote} + 1 from ${quote}numbers${closeQuote} where ${quote}numbers${closeQuote}.${quote}value${closeQuote} < ${
				param === '$1' ? '$2' : param === '@par0' ? '@par1' : '?'
			}) select ${quote}value${closeQuote} from ${quote}numbers${closeQuote}`,
		);
		expect(recursive.params).toEqual([1, 3]);
	});

	test('mixes ordinary and recursive CTEs under a single WITH', () => {
		const { mixed } = build();
		expect(mixed.sql).toMatch(new RegExp(`^${prefix}`));
		expect(mixed.sql.match(/with /g)).toHaveLength(1);
		expect(mixed.sql).toContain(`, ${quote}inferred${closeQuote} as (`);
	});

	test('preserves ordinary CTEs and empty WITH lists', () => {
		const { ordinary, empty } = build();
		expect(ordinary.sql).toMatch(/^with /);
		expect(ordinary.sql).not.toContain('recursive');
		expect(empty.sql).toMatch(/^select /);
	});
});
