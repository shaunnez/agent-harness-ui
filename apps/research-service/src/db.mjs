// The database handle the engine's Postgres stores take (`@eversor/research-engine/pg/schema.mjs`):
// `query`, `exec` and `transaction`, over either driver.
//
//   postgres://…            a real server through `pg` (Azure Database for PostgreSQL in prod)
//   pglite:memory           Postgres in this process, gone when it stops (tests)
//   pglite:<directory>      Postgres in this process, kept on disk (a local run without Docker)
//
// PGlite is the same Postgres compiled to WebAssembly, so the SQL is the SQL prod runs. It is a
// single connection: fine for one local service, not for prod.

import { mkdir } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

export async function openDatabase(url) {
  const target = String(url ?? "").trim();
  if (!target)
    throw new Error("Set RESEARCH_DATABASE_URL: postgres://…, or pglite:<directory> to run locally.");
  if (target.startsWith("pglite:")) return openPglite(target.slice("pglite:".length));
  if (/^postgres(ql)?:\/\//.test(target)) return openPostgres(target);
  throw new Error("RESEARCH_DATABASE_URL must start with postgres://, postgresql:// or pglite:.");
}

async function openPglite(location) {
  // A dev dependency: the production image has no PGlite, so it can only reach a real server.
  const { PGlite } = await import("@electric-sql/pglite").catch(() => {
    throw new Error("pglite: needs the service's dev dependencies; in production set a postgres:// URL.");
  });
  const inMemory = location === "memory" || location === "";
  // PGlite makes its own directory but not the ones above it.
  if (!inMemory) await mkdir(path.dirname(path.resolve(location)), { recursive: true });
  const db = inMemory ? new PGlite() : new PGlite(location);
  await db.waitReady;
  const wrap = (handle) => ({
    async query(text, params = []) {
      const result = await handle.query(text, params);
      return { rows: result.rows, rowCount: Number(result.affectedRows ?? result.rows.length) };
    },
    async exec(text) {
      await handle.exec(text);
    },
  });
  return {
    kind: "pglite",
    ...wrap(db),
    transaction: (operation) => db.transaction((tx) => operation(wrap(tx))),
    close: () => db.close(),
  };
}

function openPostgres(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const wrap = (client) => ({
    async query(text, params = []) {
      const result = await client.query(text, params);
      return { rows: result.rows, rowCount: Number(result.rowCount ?? 0) };
    },
    async exec(text) {
      // No parameters, so `pg` sends it as a simple query, which may hold several statements.
      await client.query(text);
    },
  });
  return {
    kind: "postgres",
    ...wrap(pool),
    async transaction(operation) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await operation(wrap(client));
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
