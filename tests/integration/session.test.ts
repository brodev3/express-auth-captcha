import express from "express";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { loadConfig } from "../../src/config.js";
import {
  closeDatabase,
  get,
  openDatabase,
  type SqliteDatabase,
} from "../../src/db/database.js";
import { createSessionMiddleware } from "../../src/web/session.js";

describe("SQLite-backed sessions", () => {
  let temporaryDirectory = "";
  let database: SqliteDatabase | undefined;

  afterEach(async () => {
    if (database) {
      await closeDatabase(database);
      database = undefined;
    }

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = "";
    }
  });

  it("persists session data and uses a signed HttpOnly cookie", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "express-auth-captcha-session-"));
    const databasePath = path.join(temporaryDirectory, "app.sqlite");
    database = await openDatabase(databasePath);

    const config = loadConfig({
      DATABASE_PATH: databasePath,
      NODE_ENV: "test",
      PORT: "3000",
      SESSION_SECRET: "test-only-session-secret-not-for-production",
    });
    const sessionSetup = createSessionMiddleware({
      database,
      nodeEnv: config.nodeEnv,
      secret: config.sessionSecret,
    });

    await sessionSetup.ready;

    const app = express();
    app.use(sessionSetup.middleware);
    app.get("/session", (request, response) => {
      if (request.session.auth) {
        response.json(request.session.auth);
        return;
      }

      request.session.auth = {
        userId: 42,
        username: "test-user",
      };
      response.status(201).json({ created: true });
    });

    const agent = request.agent(app);
    const firstResponse = await agent.get("/session");
    const secondResponse = await agent.get("/session");
    const sessions = await get<{ count: number }>(
      database,
      "SELECT COUNT(*) AS count FROM sessions",
    );
    const rawSetCookie = firstResponse.headers["set-cookie"];
    const setCookie = Array.isArray(rawSetCookie)
      ? rawSetCookie.join(";")
      : (rawSetCookie ?? "");

    expect(firstResponse.status).toBe(201);
    expect(secondResponse.status).toBe(200);
    expect(secondResponse.body).toEqual({ userId: 42, username: "test-user" });
    expect(sessions?.count).toBe(1);
    expect(setCookie).toContain("auth.sid=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Expires=");
    expect(setCookie).not.toContain("test-only-session-secret");
    expect(setCookie).not.toContain("test-user");
  });

  it("sets a secure cookie behind a trusted HTTPS proxy in production", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "express-auth-captcha-proxy-"));
    database = await openDatabase(path.join(temporaryDirectory, "app.sqlite"));

    const sessionSetup = createSessionMiddleware({
      database,
      nodeEnv: "production",
      secret: "test-only-session-secret-not-for-production",
    });
    await sessionSetup.ready;

    const app = createApp({
      sessionMiddleware: (httpRequest, httpResponse, next) => {
        sessionSetup.middleware(httpRequest, httpResponse, () => {
          httpRequest.session.auth = {
            userId: 42,
            username: "test-user",
          };
          next();
        });
      },
    });
    const response = await request(app)
      .get("/health")
      .set("X-Forwarded-Proto", "https");
    const rawSetCookie = response.headers["set-cookie"];
    const setCookie = Array.isArray(rawSetCookie)
      ? rawSetCookie.join(";")
      : (rawSetCookie ?? "");

    expect(response.status).toBe(200);
    expect(setCookie).toContain("auth.sid=");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("HttpOnly");
  });
});
