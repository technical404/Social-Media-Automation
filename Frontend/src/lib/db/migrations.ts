// The SQL files in /db/migrations are the single schema source for both engines.
const files = import.meta.glob("/db/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export type Migration = { version: string; sql: string };

export const MIGRATIONS: Migration[] = Object.entries(files)
  .map(([path, sql]) => ({ version: path.split("/").pop()!.replace(/\.sql$/, ""), sql }))
  .sort((a, b) => a.version.localeCompare(b.version));

export const LATEST_SCHEMA = MIGRATIONS[MIGRATIONS.length - 1]?.version ?? "none";
