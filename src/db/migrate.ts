import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { all, exec, run, type SqliteDatabase } from "./database.js";

interface MigrationFile {
  version: number;
  name: string;
  filePath: string;
}

interface AppliedMigrationRow {
  version: number;
  name: string;
}

const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

export async function migrate(
  database: SqliteDatabase,
  migrationsDir = DEFAULT_MIGRATIONS_DIR,
): Promise<void> {
  await run(
    database,
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );

  const migrations = await loadMigrationFiles(migrationsDir);
  const applied = await all<AppliedMigrationRow>(
    database,
    "SELECT version, name FROM schema_migrations ORDER BY version",
  );
  const appliedByVersion = new Map(applied.map((migration) => [migration.version, migration.name]));

  for (const migration of migrations) {
    const appliedName = appliedByVersion.get(migration.version);

    if (appliedName !== undefined) {
      if (appliedName !== migration.name) {
        throw new Error(`Migration ${migration.version} has a different name`);
      }

      continue;
    }

    const sql = await readFile(migration.filePath, "utf8");
    await run(database, "BEGIN");

    try {
      await exec(database, sql);
      await run(
        database,
        "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
        [migration.version, migration.name],
      );
      await run(database, "COMMIT");
    } catch (error) {
      try {
        await run(database, "ROLLBACK");
      } catch (rollbackError) {
        throw new AggregateError(
          [error, rollbackError],
          `Migration ${migration.version} failed and rollback failed`,
        );
      }

      throw error;
    }
  }
}

async function loadMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
  const entries = await readdir(migrationsDir, { withFileTypes: true });
  const migrations: MigrationFile[] = [];
  const versions = new Set<number>();

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) {
      continue;
    }

    const match = /^(\d+)_([a-z0-9_-]+)\.sql$/i.exec(entry.name);

    if (!match) {
      throw new Error(`Invalid migration filename: ${entry.name}`);
    }

    const versionText = match[1];
    const name = match[2];

    if (!versionText || !name) {
      throw new Error(`Invalid migration filename: ${entry.name}`);
    }

    const version = Number(versionText);

    if (versions.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`);
    }

    versions.add(version);
    migrations.push({
      version,
      name,
      filePath: path.join(migrationsDir, entry.name),
    });
  }

  return migrations.sort((left, right) => left.version - right.version);
}
