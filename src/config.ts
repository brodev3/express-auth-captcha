import path from "node:path";
import { fileURLToPath } from "node:url";

export type NodeEnvironment = "development" | "test" | "production";

export interface AppConfig {
  nodeEnv: NodeEnvironment;
  port: number;
  databasePath: string;
  sessionSecret: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_DATABASE_PATH = "data/app.sqlite";
const TEST_SESSION_SECRET = "test-only-session-secret-not-for-production";

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  projectRoot = fileURLToPath(new URL("../", import.meta.url)),
): AppConfig {
  const nodeEnv = parseNodeEnvironment(env.NODE_ENV);
  const port = parsePort(env.PORT);
  const databasePath = resolveDatabasePath(env.DATABASE_PATH, projectRoot);
  const sessionSecret = env.SESSION_SECRET || undefined;

  if (nodeEnv !== "test" && (!sessionSecret || sessionSecret.length < 32)) {
    throw new Error("SESSION_SECRET must contain at least 32 characters");
  }

  return {
    nodeEnv,
    port,
    databasePath,
    sessionSecret: sessionSecret ?? TEST_SESSION_SECRET,
  };
}

function resolveDatabasePath(value: string | undefined, projectRoot: string): string {
  const databasePath = value?.trim() || DEFAULT_DATABASE_PATH;

  if (databasePath === ":memory:" || path.isAbsolute(databasePath)) {
    return databasePath;
  }

  return path.resolve(projectRoot, databasePath);
}

function parseNodeEnvironment(value: string | undefined): NodeEnvironment {
  const nodeEnv = value ?? "development";

  if (nodeEnv === "development" || nodeEnv === "test" || nodeEnv === "production") {
    return nodeEnv;
  }

  throw new Error("NODE_ENV must be development, test, or production");
}

function parsePort(value: string | undefined): number {
  const rawPort = value?.trim() || String(DEFAULT_PORT);

  if (!/^\d+$/.test(rawPort)) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  const port = Number(rawPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  return port;
}
