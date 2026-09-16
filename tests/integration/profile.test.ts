import { all, run } from "../../src/db/database.js";
import { startServer, stopServer, type StartedServer } from "../../src/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("profile and logout routes", () => {
  let temporaryDirectory = "";
  let startedServer: StartedServer | undefined;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "express-auth-captcha-profile-"));
    startedServer = await startServer({
      databasePath: path.join(temporaryDirectory, "app.sqlite"),
      nodeEnv: "test",
      port: 0,
      sessionSecret: "test-only-session-secret-not-for-production",
    });
  });

  afterEach(async () => {
    if (startedServer) {
      await stopServer(startedServer);
      startedServer = undefined;
    }

    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true });
      temporaryDirectory = "";
    }
  });

  it("redirects guests to login and the root follows authentication state", async () => {
    const currentServer = requireStartedServer(startedServer);
    const guestProfile = await request(currentServer.server).get("/profile");
    const guestRoot = await request(currentServer.server).get("/");

    expect(guestProfile.status).toBe(303);
    expect(guestProfile.headers.location).toBe("/login");
    expect(guestRoot.status).toBe(303);
    expect(guestRoot.headers.location).toBe("/login");
  });

  it("loads current profile data from the database", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    await registerAndLogin(agent);

    const profile = await agent.get("/profile");
    const authenticatedRoot = await agent.get("/");

    expect(profile.status).toBe(200);
    expect(profile.headers["cache-control"]).toBe("no-store");
    expect(profile.text).toContain("Добро пожаловать, TestUser!");
    expect(profile.text).toContain("user@example.com");
    expect(profile.text).toContain("Пользователь");
    expect(profile.text).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(authenticatedRoot.status).toBe(303);
    expect(authenticatedRoot.headers.location).toBe("/profile");
  });

  it("escapes user data rendered in the profile", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    await registerAndLogin(agent, '"><script>alert(1)</script>@example.com');

    const profile = await agent.get("/profile");

    expect(profile.status).toBe(200);
    expect(profile.text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(profile.text).not.toContain("<script>alert(1)</script>");
  });

  it("destroys the session and clears the cookie on logout", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    await registerAndLogin(agent);

    const logout = await agent.post("/logout");
    const profileAfterLogout = await agent.get("/profile");
    const sessions = await all<{ sid: string }>(
      currentServer.database,
      "SELECT sid FROM sessions",
    );
    const clearedCookies = normalizeCookies(logout.headers["set-cookie"]);

    expect(logout.status).toBe(303);
    expect(logout.headers.location).toBe("/login");
    expect(clearedCookies.some((cookie) => cookie.startsWith("auth.sid=;"))).toBe(true);
    expect(profileAfterLogout.status).toBe(303);
    expect(profileAfterLogout.headers.location).toBe("/login");
    expect(sessions).toHaveLength(0);
  });

  it("destroys a stale authenticated session when the user no longer exists", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    await registerAndLogin(agent);
    await run(currentServer.database, "DELETE FROM users");

    const staleProfile = await agent.get("/profile");
    const profileAfterCleanup = await agent.get("/profile");

    expect(staleProfile.status).toBe(303);
    expect(staleProfile.headers.location).toBe("/login");
    expect(profileAfterCleanup.status).toBe(303);
    expect(profileAfterCleanup.headers.location).toBe("/login");
  });
});

async function registerAndLogin(
  agent: request.Agent,
  email = "user@example.com",
): Promise<void> {
  const registrationPage = await agent.get("/register");
  const registrationCaptcha = extractCaptcha(registrationPage.text);
  const registration = await agent.post("/register").type("form").send({
    captchaAnswer: registrationCaptcha.answer,
    captchaId: registrationCaptcha.captchaId,
    email,
    password: "Secret1!",
    passwordConfirmation: "Secret1!",
    username: "TestUser",
  });

  expect(registration.status).toBe(303);

  const loginPage = await agent.get("/login");
  const loginCaptcha = extractCaptcha(loginPage.text);
  const login = await agent.post("/login").type("form").send({
    captchaAnswer: loginCaptcha.answer,
    captchaId: loginCaptcha.captchaId,
    login: "TestUser",
    password: "Secret1!",
  });

  expect(login.status).toBe(303);
}

function extractCaptcha(html: string): { answer: string; captchaId: string } {
  const questionMatch = /<p id="captcha-question">Сколько будет (\d+) \+ (\d+)\?<\/p>/.exec(
    html,
  );
  const idMatch = /name="captchaId" value="([^"]+)"/.exec(html);
  const firstNumber = questionMatch?.[1];
  const secondNumber = questionMatch?.[2];
  const captchaId = idMatch?.[1];

  if (!firstNumber || !secondNumber || !captchaId) {
    throw new Error("CAPTCHA was not found in the authentication page");
  }

  return {
    answer: String(Number(firstNumber) + Number(secondNumber)),
    captchaId,
  };
}

function normalizeCookies(rawCookie: string | string[] | undefined): string[] {
  return rawCookie ? (Array.isArray(rawCookie) ? rawCookie : [rawCookie]) : [];
}

function requireStartedServer(startedServer: StartedServer | undefined): StartedServer {
  if (!startedServer) {
    throw new Error("Test server is not initialized");
  }

  return startedServer;
}
