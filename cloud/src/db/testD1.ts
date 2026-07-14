import { DatabaseSync } from "node:sqlite";

/**
 * Minimal in-memory `D1Database` shim over Node's built-in `node:sqlite`, for
 * unit-testing the query helpers without spinning up the Workers runtime.
 * Implements only the subset of the D1 API the queries use:
 * `prepare().bind().run()/first()/all()`.
 *
 * Foreign keys are left OFF (the SQLite default), matching D1, so inserts with
 * references to rows in other tables succeed without seeding them.
 */
export function makeTestD1(schemaSql: string): D1Database {
  // Production D1 enforces foreign keys, and so does node:sqlite by default —
  // keep them on so tests catch FK violations (e.g. a stray REFERENCES) that a
  // permissive shim would hide.
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql);

  const prepare = (sql: string) => {
    let params: unknown[] = [];
    const stmt = {
      bind(...args: unknown[]) {
        params = args;
        return stmt;
      },
      run() {
        const info = db.prepare(sql).run(...(params as unknown[] as never[]));
        return Promise.resolve({
          success: true,
          meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
        });
      },
      first<T = unknown>(column?: string) {
        const row = db.prepare(sql).get(...(params as unknown[] as never[])) as
          | Record<string, unknown>
          | undefined;
        if (row === undefined) return Promise.resolve(null);
        return Promise.resolve((column ? row[column] : row) as T);
      },
      all<T = unknown>() {
        const results = db.prepare(sql).all(...(params as unknown[] as never[])) as T[];
        return Promise.resolve({ results, success: true, meta: {} });
      },
    };
    return stmt;
  };

  return { prepare } as unknown as D1Database;
}
