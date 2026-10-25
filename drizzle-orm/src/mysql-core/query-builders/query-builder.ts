import { entityKind, is } from '~/entity.ts';
import type { MySqlDialectConfig } from '~/mysql-core/dialect.ts';
import { MySqlDialect } from '~/mysql-core/dialect.ts';
import type { WithBuilder, WithRecursiveBuilder } from '~/mysql-core/subquery.ts';
import type { TypedQueryBuilder } from '~/query-builders/query-builder.ts';
import { getRecursiveSelection } from '~/query-builders/with-recursive.ts';
import { SelectionProxyHandler } from '~/selection-proxy.ts';
import { type ColumnsSelection, SQL } from '~/sql/sql.ts';
import { WithSubquery } from '~/subquery.ts';
import { MySqlSelectBuilder } from './select.ts';
import type { SelectedFields } from './select.types.ts';

export class QueryBuilder {
	static readonly [entityKind]: string = 'MySqlQueryBuilder';
	static [Symbol.hasInstance](value: unknown): boolean {
		return is(value, this);
	}

	private dialect: MySqlDialect | undefined;
	private dialectConfig: MySqlDialectConfig | undefined;

	constructor(dialect?: MySqlDialect | MySqlDialectConfig) {
		this.dialect = is(dialect, MySqlDialect) ? dialect : undefined;
		this.dialectConfig = is(dialect, MySqlDialect) ? undefined : dialect;
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

			return new Proxy(
				new WithSubquery(
					qb.getSQL(),
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

		function select(): MySqlSelectBuilder<undefined>;
		function select<TSelection extends SelectedFields>(
			fields: TSelection,
		): MySqlSelectBuilder<TSelection>;
		function select<TSelection extends SelectedFields>(
			fields?: TSelection,
		): MySqlSelectBuilder<TSelection | undefined> {
			return new MySqlSelectBuilder({
				fields: fields ?? undefined,
				session: undefined,
				dialect: self.getDialect(),
				withList: queries,
			});
		}

		function selectDistinct(): MySqlSelectBuilder<undefined>;
		function selectDistinct<TSelection extends SelectedFields>(
			fields: TSelection,
		): MySqlSelectBuilder<TSelection>;
		function selectDistinct<TSelection extends SelectedFields>(
			fields?: TSelection,
		): MySqlSelectBuilder<TSelection | undefined> {
			return new MySqlSelectBuilder({
				fields: fields ?? undefined,
				session: undefined,
				dialect: self.getDialect(),
				withList: queries,
				distinct: true,
			});
		}

		return { select, selectDistinct };
	}

	select(): MySqlSelectBuilder<undefined>;
	select<TSelection extends SelectedFields>(fields: TSelection): MySqlSelectBuilder<TSelection>;
	select<TSelection extends SelectedFields>(
		fields?: TSelection,
	): MySqlSelectBuilder<TSelection | undefined> {
		return new MySqlSelectBuilder({ fields: fields ?? undefined, session: undefined, dialect: this.getDialect() });
	}

	selectDistinct(): MySqlSelectBuilder<undefined>;
	selectDistinct<TSelection extends SelectedFields>(
		fields: TSelection,
	): MySqlSelectBuilder<TSelection>;
	selectDistinct<TSelection extends SelectedFields>(
		fields?: TSelection,
	): MySqlSelectBuilder<TSelection | undefined> {
		return new MySqlSelectBuilder({
			fields: fields ?? undefined,
			session: undefined,
			dialect: this.getDialect(),
			distinct: true,
		});
	}

	// Lazy load dialect to avoid circular dependency
	private getDialect() {
		if (!this.dialect) {
			this.dialect = new MySqlDialect(this.dialectConfig);
		}

		return this.dialect;
	}
}
