import { all } from "../../src/db/database.js";
import { startServer, stopServer, type StartedServer } from "../../src/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("login routes", () => {
  let temporaryDirectory = "";
  let startedServer: StartedServer | undefined;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "express-auth-captcha-login-"));
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

  it("consumes flash once and regenerates the session ID after login", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    const registrationResponse = await registerUser(agent);
    const oldCookie = cookieValue(registrationResponse.headers["set-cookie"]);

    const firstLoginPage = await agent.get("/login");
    const firstChallenge = extractCaptcha(firstLoginPage.text);
    const secondLoginPage = await agent.get("/login");
    const secondChallenge = extractCaptcha(secondLoginPage.text);
    const loginResponse = await agent.post("/login").type("form").send({
      captchaAnswer: secondChallenge.answer,
      captchaId: secondChallenge.captchaId,
      login: "USER@EXAMPLE.COM",
      password: "Secret1!",
    });
    const newCookie = cookieValue(loginResponse.headers["set-cookie"]);
    const sessions = await all<{ sess: string }>(
      currentServer.database,
      "SELECT sess FROM sessions",
    );
    const authenticatedSession = sessions
      .map(({ sess }) => JSON.parse(sess) as { auth?: { userId: number; username: string } })
      .find((session) => session.auth?.username === "TestUser");

    expect(firstLoginPage.status).toBe(200);
    expect(firstLoginPage.headers["cache-control"]).toBe("no-store");
    expect(firstLoginPage.text).toContain("Регистрация успешна! Войдите в систему.");
    expect(secondLoginPage.status).toBe(200);
    expect(secondLoginPage.text).not.toContain("Регистрация успешна! Войдите в систему.");
    expect(firstChallenge.captchaId).not.toBe(secondChallenge.captchaId);
    expect(loginResponse.status).toBe(303);
    expect(loginResponse.headers.location).toBe("/profile");
    expect(oldCookie).toBeTruthy();
    expect(newCookie).toBeTruthy();
    expect(newCookie).not.toBe(oldCookie);
    expect(authenticatedSession?.auth).toEqual({ userId: expect.any(Number), username: "TestUser" });

    const authenticatedLoginPage = await agent.get("/login");
    expect(authenticatedLoginPage.status).toBe(303);
    expect(authenticatedLoginPage.headers.location).toBe("/profile");
  });

  it("returns the same generic result for an unknown user and a wrong password", async () => {
    const currentServer = requireStartedServer(startedServer);
    const registeredAgent = request.agent(currentServer.server);
    await registerUser(registeredAgent);

    const wrongPasswordPage = await registeredAgent.get("/login");
    const wrongPasswordChallenge = extractCaptcha(wrongPasswordPage.text);
    const wrongPasswordResponse = await registeredAgent.post("/login").type("form").send({
      captchaAnswer: wrongPasswordChallenge.answer,
      captchaId: wrongPasswordChallenge.captchaId,
      login: "TestUser",
      password: "Wrong1!",
    });

    const unknownAgent = request.agent(currentServer.server);
    const unknownUserPage = await unknownAgent.get("/login");
    const unknownUserChallenge = extractCaptcha(unknownUserPage.text);
    const unknownUserResponse = await unknownAgent.post("/login").type("form").send({
      captchaAnswer: unknownUserChallenge.answer,
      captchaId: unknownUserChallenge.captchaId,
      login: "UnknownUser",
      password: "Wrong1!",
    });

    expect(wrongPasswordResponse.status).toBe(401);
    expect(wrongPasswordResponse.headers["cache-control"]).toBe("no-store");
    expect(unknownUserResponse.status).toBe(401);
    expect(wrongPasswordResponse.text).toContain("Неверный логин или пароль");
    expect(unknownUserResponse.text).toContain("Неверный логин или пароль");
    expect(wrongPasswordResponse.text).not.toContain("Пользователь с таким именем");
    expect(unknownUserResponse.text).not.toContain("TestUser");
  });

  it("rejects missing login fields with 422 and issues a new CAPTCHA", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    const page = await agent.get("/login");
    const challenge = extractCaptcha(page.text);

    const response = await agent.post("/login").type("form").send({
      captchaAnswer: challenge.answer,
      captchaId: challenge.captchaId,
      login: "",
      password: "",
    });
    const nextChallenge = extractCaptcha(response.text);

    expect(response.status).toBe(422);
    expect(response.text).toContain("Введите логин");
    expect(response.text).toContain("Введите пароль");
    expect(nextChallenge.captchaId).not.toBe(challenge.captchaId);
  });
});

async function registerUser(agent: request.Agent): Promise<request.Response> {
  const page = await agent.get("/register");
  const challenge = extractCaptcha(page.text);
  const response = await agent.post("/register").type("form").send({
    captchaAnswer: challenge.answer,
    captchaId: challenge.captchaId,
    email: "user@example.com",
    password: "Secret1!",
    passwordConfirmation: "Secret1!",
    username: "TestUser",
  });

  expect(response.status).toBe(303);
  return response;
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
    throw new Error("CAPTCHA was not found in the login page");
  }

  return {
    answer: String(Number(firstNumber) + Number(secondNumber)),
    captchaId,
  };
}

function cookieValue(rawCookie: string | string[] | undefined): string | undefined {
  const cookie = Array.isArray(rawCookie) ? rawCookie[0] : rawCookie;
  return cookie?.match(/^auth\.sid=([^;]+)/)?.[1];
}

function requireStartedServer(startedServer: StartedServer | undefined): StartedServer {
  if (!startedServer) {
    throw new Error("Test server is not initialized");
  }

  return startedServer;
}
