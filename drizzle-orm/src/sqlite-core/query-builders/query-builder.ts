import { entityKind, is } from '~/entity.ts';
import type { TypedQueryBuilder } from '~/query-builders/query-builder.ts';
import { getRecursiveSelection } from '~/query-builders/with-recursive.ts';
import { SelectionProxyHandler } from '~/selection-proxy.ts';
import { type ColumnsSelection, SQL } from '~/sql/sql.ts';
import type { SQLiteDialectConfig } from '~/sqlite-core/dialect.ts';
import { SQLiteDialect } from '~/sqlite-core/dialect.ts';
import type { WithBuilder, WithRecursiveBuilder } from '~/sqlite-core/subquery.ts';
import { WithSubquery } from '~/subquery.ts';
import { SQLiteSelectBuilder } from './select.ts';
import type { SelectedFields } from './select.types.ts';

export class QueryBuilder {
	static readonly [entityKind]: string = 'SQLiteQueryBuilder';
	static [Symbol.hasInstance](value: unknown): boolean {
		return is(value, this);
	}

	private dialect: SQLiteDialect | undefined;
	private dialectConfig: SQLiteDialectConfig | undefined;

	constructor(dialect?: SQLiteDialect | SQLiteDialectConfig) {
		this.dialect = is(dialect, SQLiteDialect) ? dialect : undefined;
		this.dialectConfig = is(dialect, SQLiteDialect) ? undefined : dialect;
	}

	$with: WithBuilder = (alias: string, selection?: ColumnsSelection) => {
		const queryBuilder = this;
		const as = (
			qb:
				| TypedQueryBuilder<ColumnsSelection | undefined>
				| SQL
				| ((qb: QueryBuilder) => TypedQueryBuilder<ColumnsSelection | undefined> | SQL),
		) => {
			if (typeof qb === 'function') {
				qb = qb(queryBuilder);
			}

			const sql = qb.getSQL();
			return new Proxy(
				new WithSubquery(
					sql,
					selection ?? ('getSelectedFields' in qb ? qb.getSelectedFields() ?? {} : {}) as SelectedFields,
					alias,
					true,
				),
				new SelectionProxyHandler({ alias, sqlAliasedBehavior: 'alias', sqlBehavior: 'error' }),
			) as any;
		};
		return { as };
	};

	/**
	 * Defines a recursive CTE. With an explicit selection, the `as` callback
	 * receives a typed self reference as its second argument.
	 */
	$withRecursive: WithRecursiveBuilder = (alias: string, selection?: ColumnsSelection) => {
		const as = (
			qb:
				| TypedQueryBuilder<ColumnsSelection | undefined>
				| SQL
				| ((qb: QueryBuilder, self: WithSubquery) => TypedQueryBuilder<ColumnsSelection | undefined> | SQL),
		) => {
			if (typeof qb === 'function') {
				const self = new Proxy(
					new WithSubquery(new SQL([]), selection ?? {}, alias, true, true),
					new SelectionProxyHandler({ alias, sqlAliasedBehavior: 'alias', sqlBehavior: 'error' }),
				);
				qb = qb(this, self);
			}

			const fields = getRecursiveSelection(qb, selection);
			return new Proxy(
				new WithSubquery(
					qb.getSQL(),
					fields,
					alias,
					true,
					true,
				),
				new SelectionProxyHandler({ alias, sqlAliasedBehavior: 'alias', sqlBehavior: 'error' }),
			) as any;
		};
		return { as };
	};

	with(...queries: WithSubquery[]) {
		const self = this;

		function select(): SQLiteSelectBuilder<undefined, void>;
		function select<TSelection extends SelectedFields>(
			fields: TSelection,
		): SQLiteSelectBuilder<TSelection, void>;
		function select<TSelection extends SelectedFields>(
			fields?: TSelection,
		): SQLiteSelectBuilder<TSelection | undefined, void> {
			return new SQLiteSelectBuilder({
				fields: fields ?? undefined,
				session: undefined,
				dialect: self.getDialect(),
				withList: queries,
			});
		}

		function selectDistinct(): SQLiteSelectBuilder<undefined, void>;
		function selectDistinct<TSelection extends SelectedFields>(
			fields: TSelection,
		): SQLiteSelectBuilder<TSelection, void>;
		function selectDistinct<TSelection extends SelectedFields>(
			fields?: TSelection,
		): SQLiteSelectBuilder<TSelection | undefined, void> {
			return new SQLiteSelectBuilder({
				fields: fields ?? undefined,
				session: undefined,
				dialect: self.getDialect(),
				withList: queries,
				distinct: true,
			});
		}

		return { select, selectDistinct };
	}

	select(): SQLiteSelectBuilder<undefined, void>;
	select<TSelection extends SelectedFields>(
		fields: TSelection,
	): SQLiteSelectBuilder<TSelection, void>;
	select<TSelection extends SelectedFields>(
		fields?: TSelection,
	): SQLiteSelectBuilder<TSelection | undefined, void> {
		return new SQLiteSelectBuilder({ fields: fields ?? undefined, session: undefined, dialect: this.getDialect() });
	}

	selectDistinct(): SQLiteSelectBuilder<undefined, void>;
	selectDistinct<TSelection extends SelectedFields>(
		fields: TSelection,
	): SQLiteSelectBuilder<TSelection, void>;
	selectDistinct<TSelection extends SelectedFields>(
		fields?: TSelection,
	): SQLiteSelectBuilder<TSelection | undefined, void> {
		return new SQLiteSelectBuilder({
			fields: fields ?? undefined,
			session: undefined,
			dialect: this.getDialect(),
			distinct: true,
		});
	}

	// Lazy load dialect to avoid circular dependency
	private getDialect() {
		if (!this.dialect) {
			this.dialect = new SQLiteDialect(this.dialectConfig);
		}

		return this.dialect;
	}
}
