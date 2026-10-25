import type { TypedQueryBuilder } from '~/query-builders/query-builder.ts';
import type { AddAliasToSelection, SelectResultFields } from '~/query-builders/select.types.ts';
import type { ColumnsSelection, SQL } from '~/sql/sql.ts';
import type { Subquery, WithSubquery, WithSubqueryWithoutSelection } from '~/subquery.ts';
import type { QueryBuilder } from './query-builders/query-builder.ts';

export type SubqueryWithSelection<
	TSelection extends ColumnsSelection,
	TAlias extends string,
> =
	& Subquery<TAlias, AddAliasToSelection<TSelection, TAlias, 'singlestore'>>
	& AddAliasToSelection<TSelection, TAlias, 'singlestore'>;

export type WithSubqueryWithSelection<
	TSelection extends ColumnsSelection,
	TAlias extends string,
> =
	& WithSubquery<TAlias, AddAliasToSelection<TSelection, TAlias, 'singlestore'>>
	& AddAliasToSelection<TSelection, TAlias, 'singlestore'>;

export interface WithBuilder {
	<TAlias extends string>(alias: TAlias): {
		as: {
			<TSelection extends ColumnsSelection>(
				qb: TypedQueryBuilder<TSelection> | ((qb: QueryBuilder) => TypedQueryBuilder<TSelection>),
			): WithSubqueryWithSelection<TSelection, TAlias>;
			(
				qb: TypedQueryBuilder<undefined> | ((qb: QueryBuilder) => TypedQueryBuilder<undefined>),
			): WithSubqueryWithoutSelection<TAlias>;
		};
	};
	<TAlias extends string, TSelection extends ColumnsSelection>(alias: TAlias, selection: TSelection): {
		as: (qb: SQL | ((qb: QueryBuilder) => SQL)) => WithSubqueryWithSelection<TSelection, TAlias>;
	};
}

/** Builds a recursive CTE for the containing query. */
export interface WithRecursiveBuilder {
	<TAlias extends string>(alias: TAlias): {
		as: {
			<TSelection extends ColumnsSelection>(
				qb: TypedQueryBuilder<TSelection> | ((qb: QueryBuilder) => TypedQueryBuilder<TSelection>),
			): WithSubqueryWithSelection<TSelection, TAlias>;
			(
				qb: TypedQueryBuilder<undefined> | ((qb: QueryBuilder) => TypedQueryBuilder<undefined>),
			): WithSubqueryWithoutSelection<TAlias>;
		};
	};
	<TAlias extends string, TSelection extends ColumnsSelection>(alias: TAlias, selection: TSelection): {
		as: {
			<TQuerySelection extends ColumnsSelection>(
				qb:
					| TypedQueryBuilder<TQuerySelection, SelectResultFields<TSelection>[]>
					| ((
						qb: QueryBuilder,
						self: WithSubqueryWithSelection<TSelection, TAlias>,
					) => TypedQueryBuilder<TQuerySelection, SelectResultFields<TSelection>[]>),
			): WithSubqueryWithSelection<TQuerySelection, TAlias>;
			(
				qb: SQL | ((qb: QueryBuilder, self: WithSubqueryWithSelection<TSelection, TAlias>) => SQL),
			): WithSubqueryWithSelection<TSelection, TAlias>;
		};
	};
}
