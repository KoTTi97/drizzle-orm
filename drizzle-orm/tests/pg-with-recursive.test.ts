import { PgliteClient } from '@effect/sql-pglite';
import { PGlite } from '@electric-sql/pglite';
import * as Effect from 'effect/Effect';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import * as PgDrizzle from '~/effect-pglite';
import { drizzle as mockDrizzle } from '~/node-postgres';
import { integer, pgTable, QueryBuilder, text, timestamp } from '~/pg-core';
import { drizzle } from '~/pglite';
import { asc, eq, inArray, isNull, lt, sql } from '~/sql';

const employees = pgTable('employees', {
	id: integer('employee_id').primaryKey(),
	managerId: integer('manager_id'),
	name: text('employee_name').notNull(),
});
const decoded = pgTable('decoded', { id: integer('actual_id').primaryKey(), at: timestamp('at').notNull() });
const archive = pgTable('employee_archive', { id: integer().primaryKey(), depth: integer().notNull() });
const selection = {
	id: employees.id,
	managerId: employees.managerId,
	name: employees.name,
	level: sql<number>`0`.as('depth'),
};

function hierarchy(builder: Pick<QueryBuilder, '$withRecursive'>) {
	return builder.$withRecursive('employee_hierarchy', selection).as((qb, self) =>
		qb.select(selection).from(employees).where(isNull(employees.managerId))
			.unionAll(
				qb.select({
					id: employees.id,
					managerId: employees.managerId,
					name: employees.name,
					level: sql<number>`${self.level} + 1`.as('depth'),
				}).from(employees).innerJoin(self, eq(employees.managerId, self.id)),
			)
	);
}

describe('PostgreSQL WITH RECURSIVE SQL', () => {
	const db = mockDrizzle.mock();

	test('typed self reference includes computed aliases and column names', () => {
		const cte = hierarchy(db);
		const query = db.with(cte).select().from(cte).toSQL();

		expect(query).toEqual({
			sql:
				'with recursive "employee_hierarchy" as ((select "employee_id", "manager_id", "employee_name", 0 as "depth" from "employees" where ("employees"."manager_id" is null)) union all (select "employees"."employee_id", "employees"."manager_id", "employees"."employee_name", "employee_hierarchy"."depth" + 1 as "depth" from "employees" inner join "employee_hierarchy" on "employees"."manager_id" = "employee_hierarchy"."employee_id")) select "employee_id", "manager_id", "employee_name", "depth" from "employee_hierarchy"',
			params: [],
		});
	});

	test('mixes ordinary and multiple recursive CTEs with one recursive keyword', () => {
		const qb = new QueryBuilder();
		const ordinary = qb.$with('ordinary').as(qb.select({ id: employees.id }).from(employees));
		const first = hierarchy(qb);
		const second = qb.$withRecursive('second').as((qb) => qb.select().from(first));
		const query = qb.with(ordinary, first, second).select().from(second).toSQL();

		expect(query.sql).toMatch(/^with recursive "ordinary" as /);
		expect(query.sql.match(/with recursive/g)).toHaveLength(1);
		expect(query.sql).toContain(', "second" as (select');
	});

	test('ordinary CTEs and empty WITH lists keep their existing SQL', () => {
		const cte = db.$with('ordinary').as(db.select({ id: employees.id }).from(employees));
		expect(db.with(cte).select().from(cte).toSQL().sql).toBe(
			'with "ordinary" as (select "employee_id" from "employees") select "employee_id" from "ordinary"',
		);
		expect(db.with().select().from(employees).toSQL().sql).toMatch(/^select /);
	});

	test('supports inferred query and callback selections', () => {
		const query = db.select({ id: employees.id }).from(employees);
		const direct = db.$withRecursive('direct').as(query);
		const callback = db.$withRecursive('callback').as((qb) => qb.select({ id: employees.id }).from(employees));
		expect(db.with(direct).select().from(direct).toSQL().sql).toMatch(/^with recursive "direct" as /);
		expect(db.with(callback).select().from(callback).toSQL().sql).toMatch(/^with recursive "callback" as /);
	});

	test('quotes aliases and preserves parameters in raw recursive SQL', () => {
		const cte = db.$withRecursive('quoted"cte', { value: sql<number>`0`.as('value') })
			.as((_qb, self) =>
				sql`select ${1}::integer as value union all select ${self.value} + ${1} from ${self} where ${self.value} < ${3}`
			);
		expect(db.with(cte).select().from(cte).toSQL()).toEqual({
			sql:
				'with recursive "quoted""cte" as (select $1::integer as value union all select "quoted""cte"."value" + $2 from "quoted""cte" where "quoted""cte"."value" < $3) select "value" from "quoted""cte"',
			params: [1, 1, 3],
		});
	});

	test('requires aliases for raw SQL selection fields', () => {
		expect(() => db.$withRecursive('invalid', { value: sql<number>`0` }).as((_qb, self) => sql`select ${self.value}`))
			.toThrow("doesn't have an alias declared");
	});

	test('supports recursive CTEs in insert, update and delete', () => {
		const cte = hierarchy(db);
		const queries = [
			db.with(cte).insert(employees).select((qb) =>
				qb.select({ id: cte.id, managerId: cte.managerId, name: cte.name }).from(cte)
			),
			db.with(cte).update(employees).set({ name: 'updated' }).where(
				inArray(employees.id, db.select({ id: cte.id }).from(cte)),
			),
			db.with(cte).delete(employees).where(inArray(employees.id, db.select({ id: cte.id }).from(cte))),
		];
		for (const query of queries) expect(query.toSQL().sql).toMatch(/^with recursive /);
	});
});

describe('PostgreSQL recursive CTE execution', () => {
	const client = new PGlite();
	const db = drizzle({ client });

	beforeAll(async () => {
		await client.exec(
			'create table employees (employee_id integer primary key, manager_id integer, employee_name text not null)',
		);
		await client.exec('create table decoded (actual_id integer primary key, at timestamp not null)');
		await db.insert(decoded).values({ id: 1, at: new Date('2026-01-01T00:00:00Z') });
		await client.exec('create table employee_archive (id integer primary key, depth integer not null)');
		await db.insert(employees).values([
			{ id: 1, managerId: null, name: 'Root' },
			{ id: 2, managerId: 1, name: 'Child' },
			{ id: 3, managerId: 2, name: 'Grandchild' },
			{ id: 4, managerId: 1, name: 'Sibling' },
		]);
	});
	afterAll(() => client.close());

	test('traverses a hierarchy and maps a computed depth', async () => {
		const cte = hierarchy(db);
		const result = await db.with(cte).select().from(cte).orderBy(asc(cte.id));
		expect(result).toEqual([
			{ id: 1, managerId: null, name: 'Root', level: 0 },
			{ id: 2, managerId: 1, name: 'Child', level: 1 },
			{ id: 3, managerId: 2, name: 'Grandchild', level: 2 },
			{ id: 4, managerId: 1, name: 'Sibling', level: 1 },
		]);
	});

	test('runs raw recursive SQL with an explicit selection', async () => {
		const cte = db.$withRecursive('numbers', { n: sql<number>`0`.as('n') })
			.as((_qb, self) =>
				sql`select ${1}::integer as n union all select ${self.n} + 1 from ${self} where ${self.n} < ${4}`
			);
		expect(await db.with(cte).select().from(cte)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }]);
	});

	test('works inside a transaction', async () => {
		await db.transaction(async (tx) => {
			const cte = hierarchy(tx);
			expect(await tx.with(cte).select({ id: cte.id }).from(cte).where(lt(cte.level, 1))).toEqual([{ id: 1 }]);
		});
	});

	test('executes mixed ordinary and recursive CTEs', async () => {
		const seed = db.$with('seed', { n: sql<number>`1`.as('n') }).as(sql`select ${1}::integer as n`);
		const numbers = db.$withRecursive('numbers', { n: sql<number>`0`.as('n') })
			.as((qb, self) =>
				qb.select({ n: seed.n }).from(seed).unionAll(
					qb.select({ n: sql<number>`${self.n} + 1`.as('n') }).from(self).where(lt(self.n, 3)),
				)
			);
		expect(await db.with(seed, numbers).select().from(numbers)).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
	});

	test('executes insert, update and delete with a recursive CTE', async () => {
		const cte = hierarchy(db);
		const inserted = await db.with(cte).insert(archive).select((qb) =>
			qb.select({ id: cte.id, depth: cte.level }).from(cte)
		).returning();
		expect(inserted.sort((a, b) => a.id - b.id)).toEqual([
			{ id: 1, depth: 0 },
			{ id: 2, depth: 1 },
			{ id: 3, depth: 2 },
			{ id: 4, depth: 1 },
		]);
		const ids = db.select({ id: cte.id }).from(cte).where(eq(cte.level, 1));
		const updated = await db.with(cte).update(archive).set({ depth: 10 })
			.where(inArray(archive.id, ids)).returning();
		expect(updated.sort((a, b) => a.id - b.id)).toEqual([{ id: 2, depth: 10 }, { id: 4, depth: 10 }]);
		const deleted = await db.with(cte).delete(archive).where(inArray(archive.id, ids)).returning({ id: archive.id });
		expect(deleted.sort((a, b) => a.id - b.id)).toEqual([{ id: 2 }, { id: 4 }]);
	});

	test('rejects mismatching SQL output names before returning a typed CTE', () => {
		expect(() =>
			db.$withRecursive('invalid_names', { id: sql<number>`0`.as('id') })
				.as((qb) => qb.select({ id: decoded.id }).from(decoded))
		)
			.toThrow('same SQL column name or alias');
	});

	test('accepts explicitly matching query aliases', async () => {
		const cte = db.$withRecursive('matching_names', { id: sql<number>`0`.as('id') })
			.as((qb) => qb.select({ id: decoded.id.as('id') }).from(decoded));
		expect(await db.with(cte).select().from(cte)).toEqual([{ id: 1 }]);
	});

	test('preserves a typed query column codec instead of a selection placeholder', async () => {
		const cte = db.$withRecursive('dates', { at: sql<Date>`null`.as('at') })
			.as((qb) => qb.select({ at: decoded.at }).from(decoded));
		const rows = await db.with(cte).select().from(cte);
		expect(rows).toEqual([{ at: new Date('2026-01-01T00:00:00Z') }]);
		expect(rows[0]!.at).toBeInstanceOf(Date);
	});

	test('preserves a typed query mapWith decoder', async () => {
		const cte = db.$withRecursive('mapped', { value: sql<number>`0`.as('value') })
			.as((qb) => qb.select({ value: sql`'41'`.mapWith((value) => Number(value) + 1).as('value') }).from(decoded));
		expect(await db.with(cte).select().from(cte)).toEqual([{ value: 42 }]);
	});

	test('supports the Effect database API', async () => {
		const result = await Effect.runPromise(
			Effect.gen(function*() {
				const db = yield* PgDrizzle.makeWithDefaults();
				const cte = db.$withRecursive('numbers', { n: sql<number>`0`.as('n') })
					.as((_qb, self) => sql`select 1 as n union all select ${self.n} + 1 from ${self} where ${self.n} < 3`);
				return yield* db.with(cte).select().from(cte);
			}).pipe(Effect.provide(PgliteClient.layer({ dataDir: 'memory://' })), Effect.scoped),
		);
		expect(result).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
	});
});
