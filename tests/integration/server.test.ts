import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { get } from "../../src/db/database.js";
import { startServer, stopServer, type StartedServer } from "../../src/server.js";

describe("server lifecycle", () => {
  let temporaryDirectory = "";
  let startedServer: StartedServer | undefined;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "express-auth-captcha-server-"));
    startedServer = await startServer({
      nodeEnv: "test",
      port: 0,
      databasePath: path.join(temporaryDirectory, "app.sqlite"),
      sessionSecret: "test-only-session-secret-not-for-production",
    });
  });

  afterEach(async () => {
    if (startedServer) {
      await stopServer(startedServer);
      startedServer = undefined;
    }

    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("migrates the database before serving requests", async () => {
    const currentServer = requireStartedServer(startedServer);
    const response = await request(currentServer.server).get("/health");
    const table = await get<{ name: string }>(
      currentServer.database,
      "SELECT name FROM sqlite_master WHERE type = ? AND name = ?",
      ["table", "users"],
    );

    expect(response.status).toBe(200);
    expect(table?.name).toBe("users");
  });
});

function requireStartedServer(startedServer: StartedServer | undefined): StartedServer {
  if (!startedServer) {
    throw new Error("Test server is not initialized");
  }

  return startedServer;
}
