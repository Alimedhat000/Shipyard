/**
 * Returns a copy of `input` with only the entries whose values are
 * not `undefined`. Useful for partial updates where spreading
 * an object with `undefined` fields into a query would set
 * columns to `undefined` in the database.
 *
 * @example
 * defined({ name: "my-app", port: undefined })
 * // => { name: "my-app" }
 */
export function defined<T extends Record<string, unknown>>(
	input: T,
): Partial<T> {
	return Object.fromEntries(
		Object.entries(input).filter(([_, v]) => v !== undefined),
	) as Partial<T>;
}
