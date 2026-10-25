# Recursive CTEs

Introduced after `1.0.0-rc.5`.

Use `$withRecursive` to define a common table expression and include it in the main query with `db.with(...)`. PostgreSQL, MySQL, SQLite, CockroachDB and SingleStore emit `WITH RECURSIVE` if any CTE in the WITH list was defined with `$withRecursive`. SQL Server uses `WITH`, which permits recursion without the `RECURSIVE` keyword.

Pass an explicit selection to reference the CTE inside its own definition. The second argument of the `as` callback exposes those fields with the CTE's alias, including computed fields:

```ts
import { eq, isNull, sql } from 'drizzle-orm';

const hierarchy = db.$withRecursive('hierarchy', {
  id: employees.id,
  managerId: employees.managerId,
  level: sql<number>`0`.as('level'),
}).as((qb, self) =>
  qb.select({
    id: employees.id,
    managerId: employees.managerId,
    level: sql<number>`0`.as('level'),
  }).from(employees).where(isNull(employees.managerId))
    .unionAll(
      qb.select({
        id: employees.id,
        managerId: employees.managerId,
        level: sql<number>`${self.level} + 1`.as('level'),
      }).from(employees).innerJoin(self, eq(employees.managerId, self.id)),
    )
);

const rows = await db.with(hierarchy).select().from(hierarchy);
```

The selection describes the CTE's output. Typed queries must return its declared data types and include every declared field; incompatible or missing fields are compiler errors. Raw SQL remains an explicit output contract, just as with ordinary raw SQL CTEs. For typed queries, mismatching SQL column names or aliases are rejected while constructing the CTE; use matching column descriptors or explicit aliases. The returned CTE retains the typed query's output descriptors and decoders, including column codecs and `.mapWith(...)`. For raw SQL, the declared selection supplies the output descriptors. Alias computed SQL fields with `.as(...)`, as for ordinary CTEs. The database's rules for recursive queries still apply; provide a terminating condition. PostgreSQL, MySQL, SQLite and CockroachDB can also use `union` for duplicate elimination where their recursive-query rules permit it. SQL Server and SingleStore require `unionAll` between the anchor and recursive member.

An explicit selection also supports raw SQL. This example uses PostgreSQL syntax:

```ts
const numbers = db.$withRecursive('numbers', {
  n: sql<number>`0`.as('n'),
}).as((_qb, self) =>
  sql`select ${1}::integer as n
      union all
      select ${self.n} + 1 from ${self} where ${self.n} < ${5}`
);

const rows = await db.with(numbers).select().from(numbers);
```

When no typed self reference is needed, `$withRecursive('alias').as(query)` and `$withRecursive('alias').as((qb) => query)` infer the selection in the same way as `$with`.

Recursive and ordinary CTEs can share a WITH list. The API is available on each dialect's standalone `QueryBuilder` and database/transaction types, including the async and Effect APIs for PostgreSQL, MySQL and SQLite. It works with the statements supported by each dialect's existing `with(...)` API. MySQL INSERT ... SELECT can carry a recursive CTE on the SELECT query.

`sql<number>` supplies a static type; it does not convert driver values. Use `.mapWith(Number)` when a numeric expression is returned as a string by the driver (for example, a CockroachDB integer literal).

SingleStore requires CTE materialization not to be disabled (`materialize_ctes` must be `AUTO` or `ALL`) and supports recursive SELECT statements with an anchor based on a sharded table. See its [CTE documentation](https://docs.singlestore.com/db/v8.7/query-data/advanced-query-topics/with-common-table-expressions/) for engine settings and recursive query restrictions. SQL Server also applies its native recursive-query restrictions and recursion limit; see [Microsoft's documentation](https://learn.microsoft.com/en-us/sql/t-sql/queries/recursive-common-table-expression-transact-sql).

Native regression cases live beside the existing CTE tests in the shared `integration-tests/` suites for PostgreSQL, MySQL, SQLite, CockroachDB and SingleStore, and in the SQL Server suite. They run through the existing driver fixtures and CI shards; no separate `CTE_*_URL` configuration is needed. Backend-specific exclusions and disabled SingleStore CI shards remain in effect. PostgreSQL (PGlite) and SQLite (sql.js) focused execution tests also run in the ORM suite without an external service.

The public documentation website is maintained separately in [drizzle-team/drizzle-orm-docs](https://github.com/drizzle-team/drizzle-orm-docs). Changes to this file do not update the website; a companion documentation change must be published with the release that contains this API.
