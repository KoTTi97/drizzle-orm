import { cockroachTable, int4, QueryBuilder, text } from '~/cockroach-core';
import { eq, isNull, SQL, sql } from '~/sql';
import { Equal, Expect } from '../utils.ts';
import { db } from './db.ts';

const employees = cockroachTable('employees', {
	id: int4().primaryKey(),
	managerId: int4(),
	name: text().notNull(),
});
const fields = {
	id: employees.id,
	managerId: employees.managerId,
	name: employees.name,
	level: sql<number>`0`.as('depth'),
};

const cte = db.$withRecursive('hierarchy', fields).as((qb, self) => {
	Expect<Equal<typeof self.id['_']['tableName'], 'hierarchy'>>;
	Expect<Equal<typeof self.level, SQL.Aliased<number>>>;
	// @ts-expect-error - the self reference exposes only the declared selection
	self.missing;
	return qb.select(fields).from(employees).where(isNull(employees.managerId)).unionAll(
		qb.select({
			id: employees.id,
			managerId: employees.managerId,
			name: employees.name,
			level: sql<number>`${self.level} + 1`.as('depth'),
		}).from(employees).innerJoin(self, eq(employees.managerId, self.id)),
	);
});
Expect<Equal<typeof cte.id['_']['tableName'], 'hierarchy'>>;
const result = await db.with(cte).select().from(cte);
Expect<Equal<typeof result, { id: number; managerId: number | null; name: string; level: number }[]>>;
Expect<Equal<typeof cte['_']['alias'], 'hierarchy'>>;

const inferred = db.$withRecursive('inferred').as(db.select().from(employees));
const inferredResult = await db.with(inferred).select().from(inferred);
Expect<Equal<typeof inferredResult, { id: number; managerId: number | null; name: string }[]>>;
const callback = db.$withRecursive('callback').as((qb) => qb.select().from(employees));
const callbackResult = await db.with(callback).select().from(callback);
Expect<Equal<typeof callbackResult, { id: number; managerId: number | null; name: string }[]>>;

const qb = new QueryBuilder();
const standalone = qb.$withRecursive('standalone', fields).as((qb, self) => qb.select(fields).from(self));
Expect<Equal<typeof standalone['_']['alias'], 'standalone'>>;

const raw = db.$withRecursive('raw', { value: sql<number>`0`.as('value') })
	.as((_qb, self) => sql`select 1 as value union all select ${self.value} + 1 from ${self} where ${self.value} < 3`);
const rawResult = await db.with(raw).select().from(raw);
Expect<Equal<typeof rawResult, { value: number }[]>>;

// @ts-expect-error - the query must return the declared numeric field
qb.$withRecursive('wrong_type', { value: sql<number>`0`.as('value') }).as((qb) =>
	qb.select({ value: sql<string>`'text'`.as('value') }).from(employees)
);
// @ts-expect-error - a typed query cannot omit a declared field
qb.$withRecursive('missing_field', fields).as((qb) => qb.select({ id: employees.id }).from(employees));

// @ts-expect-error - a typed self reference requires an explicit selection
qb.$withRecursive('invalid').as((qb, self) => qb.select().from(self));
// @ts-expect-error - raw SQL requires an explicit selection
qb.$withRecursive('invalid').as(sql`select 1`);

await db.transaction(async (tx) => {
	const txCte = tx.$withRecursive('transaction', fields).as((qb, self) => qb.select(fields).from(self));
	Expect<Equal<typeof txCte['_']['alias'], 'transaction'>>;
});

// The typed body owns the final selection, including extra fields and its decoder result types.
const bodySelection = db.$withRecursive('body_selection', { id: sql<number>`0`.as('id') })
	.as((qb) =>
		qb.select({
			id: employees.id.as('id'),
			name: employees.name,
			mapped: sql`0`.mapWith(String).as('mapped'),
		}).from(employees)
	);
Expect<Equal<typeof bodySelection.id['_']['tableName'], 'body_selection'>>;
const bodyRows = await db.with(bodySelection).select().from(bodySelection);
Expect<Equal<typeof bodyRows, { id: number; name: string; mapped: string }[]>>;
