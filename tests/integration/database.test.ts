import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UserRepository } from "../../src/auth/user.repository.js";
import {
  all,
  closeDatabase,
  configureDatabase,
  get,
  openDatabase,
  type SqliteDatabase,
} from "../../src/db/database.js";
import { migrate } from "../../src/db/migrate.js";

describe("SQLite database and user repository", () => {
  let database: SqliteDatabase | undefined;
  let temporaryDirectory = "";
  let repository: UserRepository;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "express-auth-captcha-"));
    database = await openDatabase(path.join(temporaryDirectory, "app.sqlite"));
    await configureDatabase(database);
    await migrate(database);
    repository = new UserRepository(database);
  });

  afterEach(async () => {
    if (database) {
      await closeDatabase(database);
      database = undefined;
    }

    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("configures SQLite and applies migrations only once", async () => {
    const currentDatabase = requireDatabase(database);
    const foreignKeys = await get<{ foreign_keys: number }>(currentDatabase, "PRAGMA foreign_keys");
    const busyTimeout = await get<{ timeout: number }>(currentDatabase, "PRAGMA busy_timeout");
    const journalMode = await get<{ journal_mode: string }>(currentDatabase, "PRAGMA journal_mode");
    const before = await get<{ count: number }>(
      currentDatabase,
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );

    await migrate(currentDatabase);

    const after = await get<{ count: number }>(
      currentDatabase,
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );

    expect(foreignKeys?.foreign_keys).toBe(1);
    expect(busyTimeout?.timeout).toBe(5000);
    expect(journalMode?.journal_mode).toBe("wal");
    expect(before?.count).toBe(1);
    expect(after?.count).toBe(1);
  });

  it("creates and finds users by id, username, and email case-insensitively", async () => {
    const created = await repository.create({
      username: "Alice01",
      email: "alice@example.com",
      passwordHash: "test-hash",
    });

    expect(created).toMatchObject({
      username: "Alice01",
      email: "alice@example.com",
      passwordHash: "test-hash",
    });
    expect(await repository.findById(created.id)).toEqual(created);
    expect(await repository.findByLogin("alice01")).toEqual(created);
    expect(await repository.findByLogin("ALICE@EXAMPLE.COM")).toEqual(created);
    expect(await repository.findById(999999)).toBeNull();
  });

  it("converts both UNIQUE conflicts into typed repository errors", async () => {
    await repository.create({
      username: "Alice01",
      email: "alice@example.com",
      passwordHash: "test-hash",
    });

    await expect(
      repository.create({
        username: "alice01",
        email: "another@example.com",
        passwordHash: "test-hash",
      }),
    ).rejects.toMatchObject({
      name: "UniqueConstraintError",
      field: "username",
    });

    await expect(
      repository.create({
        username: "another-user",
        email: "ALICE@EXAMPLE.COM",
        passwordHash: "test-hash",
      }),
    ).rejects.toMatchObject({
      name: "UniqueConstraintError",
      field: "email",
    });

    expect(await repository.existsByUsername("ALICE01")).toBe(true);
    expect(await repository.existsByEmail("ALICE@EXAMPLE.COM")).toBe(true);
  });

  it("keeps user input as SQL parameters", async () => {
    const currentDatabase = requireDatabase(database);
    const username = "safe'); DROP TABLE users;--";

    await repository.create({
      username,
      email: "safe@example.com",
      passwordHash: "test-hash",
    });

    expect(await repository.findByLogin(username)).not.toBeNull();

    const usersTable = await all<{ name: string }>(
      currentDatabase,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'users'",
    );
    expect(usersTable).toHaveLength(1);
  });
});

function requireDatabase(database: SqliteDatabase | undefined): SqliteDatabase {
  if (!database) {
    throw new Error("Test database is not initialized");
  }

  return database;
}
