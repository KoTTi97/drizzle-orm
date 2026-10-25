import initSqlJs from 'sql.js';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { eq, inArray, isNull, sql } from '~/sql';
import { drizzle } from '~/sql-js';
import { integer, sqliteTable } from '~/sqlite-core';

const client = new (await initSqlJs()).Database();
const db = drizzle(client);
const employees = sqliteTable('employees', { id: integer().primaryKey(), managerId: integer('manager_id') });
const fields = { id: employees.id, level: sql<number>`0`.as('depth') };
function hierarchy() {
	return db.$withRecursive('hierarchy', fields).as((qb, self) =>
		qb.select(fields).from(employees).where(isNull(employees.managerId)).unionAll(
			qb.select({ id: employees.id, level: sql<number>`${self.level} + 1`.as('depth') })
				.from(employees).innerJoin(self, eq(employees.managerId, self.id)),
		)
	);
}

describe('SQLite recursive CTE execution', () => {
	beforeAll(() => {
		client.run('create table employees (id integer primary key, manager_id integer)');
		db.insert(employees).values([{ id: 1, managerId: null }, { id: 2, managerId: 1 }, { id: 3, managerId: 2 }]).run();
	});
	afterAll(() => client.close());

	test('traverses a hierarchy and maps computed columns', () => {
		const cte = hierarchy();
		expect(db.with(cte).select().from(cte).orderBy(cte.id).all())
			.toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});

	test('executes update and delete using recursive results', () => {
		const cte = hierarchy();
		const leafIds = db.select({ id: cte.id }).from(cte).where(eq(cte.level, 2));
		expect(db.with(cte).update(employees).set({ managerId: 1 }).where(inArray(employees.id, leafIds)).returning().all())
			.toEqual([{ id: 3, managerId: 1 }]);
		expect(db.with(cte).delete(employees).where(inArray(employees.id, leafIds)).returning().all()).toEqual([]);
	});

	test('executes raw SQL with typed self references and parameters', () => {
		const numbers = db.$withRecursive('numbers', { n: sql<number>`0`.as('n') })
			.as((_qb, self) => sql`select ${1} as n union all select ${self.n} + 1 from ${self} where ${self.n} < ${3}`);
		expect(db.with(numbers).select().from(numbers).all()).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
	});
});
