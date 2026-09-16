import "dotenv/config";
import { once } from "node:events";
import type { Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "./app.js";
import { AuthService } from "./auth/auth.service.js";
import { PasswordHasher } from "./auth/password.js";
import { UserRepository } from "./auth/user.repository.js";
import { CaptchaService } from "./captcha/captcha.service.js";
import { loadConfig, type AppConfig } from "./config.js";
import {
  closeDatabase,
  configureDatabase,
  openDatabase,
  type SqliteDatabase,
} from "./db/database.js";
import { migrate } from "./db/migrate.js";
import { createSessionMiddleware } from "./web/session.js";

export interface StartedServer {
  server: Server;
  database: SqliteDatabase;
}

export async function startServer(config: AppConfig = loadConfig()): Promise<StartedServer> {
  const database = await openDatabase(config.databasePath);

  try {
    await configureDatabase(database);
    await migrate(database);

    const sessionSetup = createSessionMiddleware({
      database,
      nodeEnv: config.nodeEnv,
      secret: config.sessionSecret,
    });

    await sessionSetup.ready;

    const authService = new AuthService({
      passwordHasher: new PasswordHasher(),
      userRepository: new UserRepository(database),
    });

    const server = createApp({
      authService,
      captchaService: new CaptchaService(),
      projectRoot: fileURLToPath(new URL("../", import.meta.url)),
      sessionMiddleware: sessionSetup.middleware,
    }).listen(config.port);
    await once(server, "listening");

    return { server, database };
  } catch (error) {
    await closeDatabase(database);
    throw error;
  }
}

export async function stopServer(startedServer: StartedServer): Promise<void> {
  await closeHttpServer(startedServer.server);
  await closeDatabase(startedServer.database);
}

async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function main(): Promise<void> {
  const startedServer = await startServer();
  const address = startedServer.server.address();
  const port = typeof address === "object" && address ? address.port : address;
  console.log(`Server listening on port ${port ?? "unknown"}`);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.log(`Received ${signal}; shutting down`);
    await stopServer(startedServer);
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT").catch(() => {
      console.error("Failed to shut down cleanly");
      process.exitCode = 1;
    });
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM").catch(() => {
      console.error("Failed to shut down cleanly");
      process.exitCode = 1;
    });
  });
}

const currentModulePath = fileURLToPath(import.meta.url);
const invokedModulePath = process.argv[1] ? path.resolve(process.argv[1]) : undefined;

if (invokedModulePath === currentModulePath) {
  void main().catch(() => {
    console.error("Failed to start server");
    process.exitCode = 1;
  });
}
