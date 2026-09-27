/**
 * What an API route may tell the client about a failure (security report L1).
 *
 * The libraries throw plain `Error`s with friendly rule messages ("Only the
 * owner can…"), which are fine to show. Database / driver errors are not: they
 * reveal table and column names. Those are logged and replaced by `fallback`.
 */
const INTERNAL = /SQLITE|libsql|LibsqlError|no such (table|column)|constraint failed|syntax error|HRANA|ECONN|fetch failed|TypeError|ReferenceError|Cannot read prop/i;

export function publicErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const name = error.constructor?.name ?? "";
  if (
    INTERNAL.test(error.message) ||
    INTERNAL.test(name) ||
    error instanceof TypeError ||
    error instanceof ReferenceError ||
    error instanceof SyntaxError
  ) {
    console.error(fallback, error);
    return fallback;
  }
  return error.message;
}
