declare module "connect-sqlite3" {
  import type { EventEmitter } from "node:events";
  import type session from "express-session";

  interface SQLiteStoreOptions {
    concurrentDb?: boolean;
    createDirIfNotExists?: boolean;
    db?: object;
    dir?: string;
    table?: string;
  }

  interface SQLiteStore extends session.Store {
    client: EventEmitter;
  }

  interface SQLiteStoreConstructor {
    new (options?: SQLiteStoreOptions): SQLiteStore;
  }

  function connectSqlite3(connect: typeof session): SQLiteStoreConstructor;

  export = connectSqlite3;
}
