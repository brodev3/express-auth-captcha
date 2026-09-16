import { mkdir } from "node:fs/promises";
import path from "node:path";
import sqlite3 from "sqlite3";

export type SqliteDatabase = sqlite3.Database;
export type SqliteValue = string | number | null | Buffer;

export interface RunResult {
  changes: number;
  lastID: number;
}

const SQLITE_BUSY_TIMEOUT_MS = 5000;

export async function openDatabase(filename: string): Promise<SqliteDatabase> {
  if (filename !== ":memory:") {
    await mkdir(path.dirname(filename), { recursive: true });
  }

  return new Promise((resolve, reject) => {
    const database = new sqlite3.Database(filename, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(database);
    });
  });
}

export function run(
  database: SqliteDatabase,
  sql: string,
  params: readonly SqliteValue[] = [],
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    database.run(sql, [...params], function (this: sqlite3.RunResult, error) {
      if (error) {
        reject(error);
        return;
      }

      resolve({
        changes: this.changes,
        lastID: this.lastID,
      });
    });
  });
}

export function get<T>(
  database: SqliteDatabase,
  sql: string,
  params: readonly SqliteValue[] = [],
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    database.get<T>(sql, [...params], (error, row) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(row);
    });
  });
}

export function all<T>(
  database: SqliteDatabase,
  sql: string,
  params: readonly SqliteValue[] = [],
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    database.all<T>(sql, [...params], (error, rows) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(rows);
    });
  });
}

export function exec(database: SqliteDatabase, sql: string): Promise<void> {
  return new Promise((resolve, reject) => {
    database.exec(sql, (error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export function closeDatabase(database: SqliteDatabase): Promise<void> {
  return new Promise((resolve, reject) => {
    database.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

export async function configureDatabase(database: SqliteDatabase): Promise<void> {
  database.configure("busyTimeout", SQLITE_BUSY_TIMEOUT_MS);
  await run(database, "PRAGMA foreign_keys = ON");
  await get<{ journal_mode: string }>(database, "PRAGMA journal_mode = WAL");
}
