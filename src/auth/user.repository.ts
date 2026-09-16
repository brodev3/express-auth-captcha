import {
  get,
  run,
  type SqliteDatabase,
} from "../db/database.js";

export interface User {
  id: number;
  username: string;
  email: string;
  passwordHash: string;
  createdAt: string;
}

export interface CreateUserInput {
  username: string;
  email: string;
  passwordHash: string;
}

export type UniqueField = "username" | "email";

export class UniqueConstraintError extends Error {
  public readonly field: UniqueField;

  public constructor(field: UniqueField) {
    super(`Unique constraint violated for ${field}`);
    this.name = "UniqueConstraintError";
    this.field = field;
  }
}

interface UserRow {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  created_at: string;
}

const USER_COLUMNS = "id, username, email, password_hash, created_at";

export class UserRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async create(input: CreateUserInput): Promise<User> {
    try {
      const result = await run(
        this.database,
        "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
        [input.username, input.email, input.passwordHash],
      );
      const user = await this.findById(result.lastID);

      if (!user) {
        throw new Error("Created user could not be loaded");
      }

      return user;
    } catch (error) {
      if (!isSqliteConstraintError(error)) {
        throw error;
      }

      const conflictField = await this.findConflict(input);

      if (conflictField) {
        throw new UniqueConstraintError(conflictField);
      }

      throw error;
    }
  }

  public async findByLogin(login: string): Promise<User | null> {
    const row = await get<UserRow>(
      this.database,
      `SELECT ${USER_COLUMNS}
       FROM users
       WHERE username = ? COLLATE NOCASE OR email = ? COLLATE NOCASE
       LIMIT 1`,
      [login, login],
    );

    return row ? mapUser(row) : null;
  }

  public async findById(id: number): Promise<User | null> {
    const row = await get<UserRow>(
      this.database,
      `SELECT ${USER_COLUMNS} FROM users WHERE id = ?`,
      [id],
    );

    return row ? mapUser(row) : null;
  }

  public async existsByUsername(username: string): Promise<boolean> {
    const row = await get<{ present: number }>(
      this.database,
      "SELECT 1 AS present FROM users WHERE username = ? COLLATE NOCASE LIMIT 1",
      [username],
    );

    return row !== undefined;
  }

  public async existsByEmail(email: string): Promise<boolean> {
    const row = await get<{ present: number }>(
      this.database,
      "SELECT 1 AS present FROM users WHERE email = ? COLLATE NOCASE LIMIT 1",
      [email],
    );

    return row !== undefined;
  }

  private async findConflict(input: CreateUserInput): Promise<UniqueField | null> {
    if (await this.existsByUsername(input.username)) {
      return "username";
    }

    if (await this.existsByEmail(input.email)) {
      return "email";
    }

    return null;
  }
}

function mapUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: row.created_at,
  };
}

function isSqliteConstraintError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as Error & { code?: unknown }).code;
  return typeof code === "string" && code.startsWith("SQLITE_CONSTRAINT");
}
