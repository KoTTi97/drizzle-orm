import { entityKind, is } from '~/entity.ts';
import type { TypedQueryBuilder } from '~/query-builders/query-builder.ts';
import { getRecursiveSelection } from '~/query-builders/with-recursive.ts';
import { SelectionProxyHandler } from '~/selection-proxy.ts';
import type { SingleStoreDialectConfig } from '~/singlestore-core/dialect.ts';
import { SingleStoreDialect } from '~/singlestore-core/dialect.ts';
import type { WithBuilder, WithRecursiveBuilder } from '~/singlestore-core/subquery.ts';
import { type ColumnsSelection, SQL } from '~/sql/sql.ts';
import { WithSubquery } from '~/subquery.ts';
import { SingleStoreSelectBuilder } from './select.ts';
import type { SelectedFields } from './select.types.ts';

export class QueryBuilder {
	static readonly [entityKind]: string = 'SingleStoreQueryBuilder';
	static [Symbol.hasInstance](value: unknown): boolean {
		return is(value, this);
	}

	private dialect: SingleStoreDialect | undefined;
	private dialectConfig: SingleStoreDialectConfig | undefined;

	constructor(dialect?: SingleStoreDialect | SingleStoreDialectConfig) {
		this.dialect = is(dialect, SingleStoreDialect) ? dialect : undefined;
		this.dialectConfig = is(dialect, SingleStoreDialect) ? undefined : dialect;
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

		function select(): SingleStoreSelectBuilder<undefined, never, 'qb'>;
		function select<TSelection extends SelectedFields>(
			fields: TSelection,
		): SingleStoreSelectBuilder<TSelection, never, 'qb'>;
		function select<TSelection extends SelectedFields>(
			fields?: TSelection,
		): SingleStoreSelectBuilder<TSelection | undefined, never, 'qb'> {
			return new SingleStoreSelectBuilder({
				fields: fields ?? undefined,
				session: undefined,
				dialect: self.getDialect(),
				withList: queries,
			});
		}

		function selectDistinct(): SingleStoreSelectBuilder<undefined, never, 'qb'>;
		function selectDistinct<TSelection extends SelectedFields>(
			fields: TSelection,
		): SingleStoreSelectBuilder<TSelection, never, 'qb'>;
		function selectDistinct<TSelection extends SelectedFields>(
			fields?: TSelection,
		): SingleStoreSelectBuilder<TSelection | undefined, never, 'qb'> {
			return new SingleStoreSelectBuilder({
				fields: fields ?? undefined,
				session: undefined,
				dialect: self.getDialect(),
				withList: queries,
				distinct: true,
			});
		}

		return { select, selectDistinct };
	}

	select(): SingleStoreSelectBuilder<undefined, never, 'qb'>;
	select<TSelection extends SelectedFields>(fields: TSelection): SingleStoreSelectBuilder<TSelection, never, 'qb'>;
	select<TSelection extends SelectedFields>(
		fields?: TSelection,
	): SingleStoreSelectBuilder<TSelection | undefined, never, 'qb'> {
		return new SingleStoreSelectBuilder({
			fields: fields ?? undefined,
			session: undefined,
			dialect: this.getDialect(),
		});
	}

	selectDistinct(): SingleStoreSelectBuilder<undefined, never, 'qb'>;
	selectDistinct<TSelection extends SelectedFields>(
		fields: TSelection,
	): SingleStoreSelectBuilder<TSelection, never, 'qb'>;
	selectDistinct<TSelection extends SelectedFields>(
		fields?: TSelection,
	): SingleStoreSelectBuilder<TSelection | undefined, never, 'qb'> {
		return new SingleStoreSelectBuilder({
			fields: fields ?? undefined,
			session: undefined,
			dialect: this.getDialect(),
			distinct: true,
		});
	}

	// Lazy load dialect to avoid circular dependency
	private getDialect() {
		if (!this.dialect) {
			this.dialect = new SingleStoreDialect(this.dialectConfig);
		}

		return this.dialect;
	}
}
