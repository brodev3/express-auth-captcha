import connectSqlite3 from "connect-sqlite3";
import { type RequestHandler } from "express";
import session from "express-session";

import type { NodeEnvironment } from "../config.js";
import type { SqliteDatabase } from "../db/database.js";

const SQLiteStore = connectSqlite3(session);

export const SESSION_COOKIE_NAME = "auth.sid";
export const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface SessionSetup {
  middleware: RequestHandler;
  ready: Promise<void>;
  store: session.Store;
}

export interface CreateSessionMiddlewareOptions {
  database: SqliteDatabase;
  nodeEnv: NodeEnvironment;
  secret: string;
}

export function createSessionMiddleware(
  options: CreateSessionMiddlewareOptions,
): SessionSetup {
  const store = new SQLiteStore({
    db: options.database,
    table: "sessions",
  });

  return {
    middleware: session({
      cookie: {
        httpOnly: true,
        maxAge: SESSION_MAX_AGE_MS,
        path: "/",
        sameSite: "lax",
        secure: options.nodeEnv === "production",
      },
      name: SESSION_COOKIE_NAME,
      resave: false,
      saveUninitialized: false,
      secret: options.secret,
      store,
    }),
    ready: waitForStore(store),
    store,
  };
}

function waitForStore(store: { client: NodeJS.EventEmitter }): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      store.client.off("connect", onConnect);
      store.client.off("error", onError);
    };

    const onConnect = (): void => {
      cleanup();
      resolve();
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    store.client.once("connect", onConnect);
    store.client.once("error", onError);
  });
}
