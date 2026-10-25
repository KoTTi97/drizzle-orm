import mssql from 'mssql';
import { createConnection } from 'mysql2/promise';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { drizzle as cockroachDrizzle } from '~/cockroach';
import { cockroachTable, int4 } from '~/cockroach-core';
import { int as mssqlInt, mssqlTable } from '~/mssql-core';
import { int as mysqlInt, mysqlTable } from '~/mysql-core';
import { drizzle as mysqlDrizzle } from '~/mysql2';
import { drizzle as mssqlDrizzle } from '~/node-mssql';
import { drizzle as singleStoreDrizzle } from '~/singlestore';
import { int as singleStoreInt, singlestoreTable } from '~/singlestore-core';
import { eq, gt, isNull, sql } from '~/sql';

// Set these URLs to isolated test databases to run against native database engines.

describe.skipIf(!process.env['CTE_MYSQL_URL'])('MySQL recursive CTE execution', () => {
	const employees = mysqlTable('drizzle_recursive_employees', {
		id: mysqlInt('id').primaryKey(),
		managerId: mysqlInt('manager_id'),
	});
	let client: Awaited<ReturnType<typeof connect>>;
	let db: ReturnType<typeof createDb>;
	let created = false;

	async function connect() {
		const url = process.env['CTE_MYSQL_URL'];
		if (!url) throw new Error('CTE_MYSQL_URL is required');
		return createConnection(url);
	}
	function createDb(client: Awaited<ReturnType<typeof connect>>) {
		return mysqlDrizzle({ client });
	}
	function hierarchy() {
		const fields = { id: employees.id, level: sql<number>`0`.mapWith(Number).as('depth') };
		return db.$withRecursive('hierarchy', fields).as((qb, self) =>
			qb.select(fields).from(employees).where(isNull(employees.managerId)).unionAll(
				qb.select({ id: employees.id, level: sql<number>`${self.level} + 1`.as('depth') })
					.from(employees).innerJoin(self, eq(employees.managerId, self.id)),
			)
		);
	}
	beforeAll(async () => {
		client = await connect();
		db = createDb(client);
		await db.execute(sql.raw('create table drizzle_recursive_employees (id integer primary key, manager_id integer)'));
		created = true;
		await db.insert(employees).values([{ id: 1, managerId: null }, { id: 2, managerId: 1 }, { id: 3, managerId: 2 }]);
	}, 30000);
	afterAll(async () => {
		if (created) await db.execute(sql`drop table ${employees}`);
		if (client) await client.end();
	});

	test('traverses a hierarchy using typed UNION ALL queries', async () => {
		const cte = hierarchy();
		const result = await db.with(cte).select().from(cte).orderBy(cte.id);
		expect(result).toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});

	test('mixes an ordinary CTE with a recursive CTE', async () => {
		const cte = hierarchy();
		const ordinary = db.$with('ordinary').as(db.select({ id: employees.id }).from(employees));
		expect(await db.with(ordinary, cte).select().from(cte).orderBy(cte.id))
			.toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});

	test('uses a recursive CTE in INSERT ... SELECT', async () => {
		const cte = hierarchy();
		await db.insert(employees).select((qb) =>
			qb.with(cte).select({
				id: sql<number>`${cte.id} + 10`.as('id'),
				managerId: sql<number | null>`null`.as('manager_id'),
			}).from(cte)
		);
		expect(await db.select({ id: employees.id }).from(employees).where(gt(employees.id, 10)).orderBy(employees.id))
			.toEqual([{ id: 11 }, { id: 12 }, { id: 13 }]);
	});
});

describe.skipIf(!process.env['CTE_COCKROACH_URL'])('CockroachDB recursive CTE execution', () => {
	const employees = cockroachTable('drizzle_recursive_employees', {
		id: int4('id').primaryKey(),
		managerId: int4('manager_id'),
	});
	let client: Awaited<ReturnType<typeof connect>>;
	let db: ReturnType<typeof createDb>;
	let created = false;

	async function connect() {
		const url = process.env['CTE_COCKROACH_URL'];
		if (!url) throw new Error('CTE_COCKROACH_URL is required');
		return Promise.resolve(new pg.Client({ connectionString: url })).then(async (client) => {
			await client.connect();
			return client;
		});
	}
	function createDb(client: Awaited<ReturnType<typeof connect>>) {
		return cockroachDrizzle({ client });
	}
	function hierarchy() {
		const fields = { id: employees.id, level: sql<number>`0`.mapWith(Number).as('depth') };
		return db.$withRecursive('hierarchy', fields).as((qb, self) =>
			qb.select(fields).from(employees).where(isNull(employees.managerId)).unionAll(
				qb.select({ id: employees.id, level: sql<number>`${self.level} + 1`.as('depth') })
					.from(employees).innerJoin(self, eq(employees.managerId, self.id)),
			)
		);
	}
	beforeAll(async () => {
		client = await connect();
		db = createDb(client);
		await db.execute(sql.raw('create table drizzle_recursive_employees (id integer primary key, manager_id integer)'));
		created = true;
		await db.insert(employees).values([{ id: 1, managerId: null }, { id: 2, managerId: 1 }, { id: 3, managerId: 2 }]);
	}, 30000);
	afterAll(async () => {
		if (created) await db.execute(sql`drop table ${employees}`);
		if (client) await client.end();
	});

	test('traverses a hierarchy using typed UNION ALL queries', async () => {
		const cte = hierarchy();
		const result = await db.with(cte).select().from(cte).orderBy(cte.id);
		expect(result).toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});

	test('mixes an ordinary CTE with a recursive CTE', async () => {
		const cte = hierarchy();
		const ordinary = db.$with('ordinary').as(db.select({ id: employees.id }).from(employees));
		expect(await db.with(ordinary, cte).select().from(cte).orderBy(cte.id))
			.toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});
});

describe.skipIf(!process.env['CTE_SINGLESTORE_URL'])('SingleStore recursive CTE execution', () => {
	const employees = singlestoreTable('drizzle_recursive_employees', {
		id: singleStoreInt('id').primaryKey(),
		managerId: singleStoreInt('manager_id'),
	});
	let client: Awaited<ReturnType<typeof connect>>;
	let db: ReturnType<typeof createDb>;
	let created = false;

	async function connect() {
		const url = process.env['CTE_SINGLESTORE_URL'];
		if (!url) throw new Error('CTE_SINGLESTORE_URL is required');
		return createConnection(url);
	}
	function createDb(client: Awaited<ReturnType<typeof connect>>) {
		return singleStoreDrizzle({ client });
	}
	function hierarchy() {
		const fields = { id: employees.id, level: sql<number>`0`.mapWith(Number).as('depth') };
		return db.$withRecursive('hierarchy', fields).as((qb, self) =>
			qb.select(fields).from(employees).where(isNull(employees.managerId)).unionAll(
				qb.select({ id: employees.id, level: sql<number>`${self.level} + 1`.as('depth') })
					.from(employees).innerJoin(self, eq(employees.managerId, self.id)),
			)
		);
	}
	beforeAll(async () => {
		client = await connect();
		db = createDb(client);
		await db.execute(sql.raw('create table drizzle_recursive_employees (id integer primary key, manager_id integer)'));
		created = true;
		await db.insert(employees).values([{ id: 1, managerId: null }, { id: 2, managerId: 1 }, { id: 3, managerId: 2 }]);
	}, 30000);
	afterAll(async () => {
		if (created) await db.execute(sql`drop table ${employees}`);
		if (client) await client.end();
	});

	test('traverses a hierarchy using typed UNION ALL queries', async () => {
		const cte = hierarchy();
		const result = await db.with(cte).select().from(cte).orderBy(cte.id);
		expect(result).toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});

	test('mixes an ordinary CTE with a recursive CTE', async () => {
		const cte = hierarchy();
		const ordinary = db.$with('ordinary').as(db.select({ id: employees.id }).from(employees));
		expect(await db.with(ordinary, cte).select().from(cte).orderBy(cte.id))
			.toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});
});

describe.skipIf(!process.env['CTE_MSSQL_URL'])('SQL Server recursive CTE execution', () => {
	const employees = mssqlTable('drizzle_recursive_employees', {
		id: mssqlInt('id').primaryKey(),
		managerId: mssqlInt('manager_id'),
	});
	let client: Awaited<ReturnType<typeof connect>>;
	let db: ReturnType<typeof createDb>;
	let created = false;

	async function connect() {
		const url = process.env['CTE_MSSQL_URL'];
		if (!url) throw new Error('CTE_MSSQL_URL is required');
		return new mssql.ConnectionPool(url).connect();
	}
	function createDb(client: Awaited<ReturnType<typeof connect>>) {
		return mssqlDrizzle({ client });
	}
	function hierarchy() {
		const fields = { id: employees.id, level: sql<number>`0`.mapWith(Number).as('depth') };
		return db.$withRecursive('hierarchy', fields).as((qb, self) =>
			qb.select(fields).from(employees).where(isNull(employees.managerId)).unionAll(
				qb.select({ id: employees.id, level: sql<number>`${self.level} + 1`.as('depth') })
					.from(employees).innerJoin(self, eq(employees.managerId, self.id)),
			)
		);
	}
	beforeAll(async () => {
		client = await connect();
		db = createDb(client);
		await db.execute(sql.raw('create table drizzle_recursive_employees (id integer primary key, manager_id integer)'));
		created = true;
		await db.insert(employees).values([{ id: 1, managerId: null }, { id: 2, managerId: 1 }, { id: 3, managerId: 2 }]);
	}, 30000);
	afterAll(async () => {
		if (created) await db.execute(sql`drop table ${employees}`);
		if (client) await client.close();
	});

	test('traverses a hierarchy using typed UNION ALL queries', async () => {
		const cte = hierarchy();
		const result = await db.with(cte).select().from(cte).orderBy(cte.id);
		expect(result).toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});

	test('mixes an ordinary CTE with a recursive CTE', async () => {
		const cte = hierarchy();
		const ordinary = db.$with('ordinary').as(db.select({ id: employees.id }).from(employees));
		expect(await db.with(ordinary, cte).select().from(cte).orderBy(cte.id))
			.toEqual([{ id: 1, level: 0 }, { id: 2, level: 1 }, { id: 3, level: 2 }]);
	});
});
