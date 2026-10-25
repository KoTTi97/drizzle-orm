import type { Column } from '~/column.ts';
import type { SelectedFieldsOrdered } from '~/operations.ts';
import type { ColumnsSelection, SQL } from '~/sql/sql.ts';
import { orderSelectedFields } from '~/utils.ts';
import type { TypedQueryBuilder } from './query-builder.ts';

function outputName(entry: SelectedFieldsOrdered<Column>[number]): string | undefined {
	switch (entry.fieldType) {
		case 'Column':
			return entry.field.name;
		case 'SQL.Aliased':
			return entry.field.fieldAlias;
		case 'Subquery':
			return entry.field._.alias;
		case 'SQL':
			return undefined;
	}
}

/** @internal */
export function getRecursiveSelection(
	query: TypedQueryBuilder<ColumnsSelection | undefined> | SQL,
	selection: ColumnsSelection | undefined,
): ColumnsSelection {
	if (!('getSelectedFields' in query)) return selection ?? {};

	const querySelection = query.getSelectedFields() ?? {};
	if (selection) {
		const output = new Map(orderSelectedFields(querySelection).map((entry) => [JSON.stringify(entry.path), entry]));
		for (const entry of orderSelectedFields(selection)) {
			const actual = output.get(JSON.stringify(entry.path));
			const expectedName = outputName(entry);
			if (!actual || expectedName === undefined || expectedName !== outputName(actual)) {
				throw new Error(
					`Recursive CTE field "${
						entry.path.join('.')
					}" must use the same SQL column name or alias in the declared selection and the query.`,
				);
			}
		}
	}

	// A typed query owns its output descriptors, including column codecs and mapWith decoders.
	return querySelection;
}
