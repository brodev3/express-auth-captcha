import { all, get } from "../../src/db/database.js";
import { startServer, stopServer, type StartedServer } from "../../src/server.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("registration routes", () => {
  let temporaryDirectory = "";
  let startedServer: StartedServer | undefined;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "express-auth-captcha-register-"));
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

  it("renders a CAPTCHA and registers a user with a PBKDF2 hash", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    const registerPage = await agent.get("/register");
    const challenge = extractCaptcha(registerPage.text);
    const password = "Secret1!";

    const response = await agent.post("/register").type("form").send({
      captchaAnswer: challenge.answer,
      captchaId: challenge.captchaId,
      email: "User@Example.com",
      password,
      passwordConfirmation: password,
      username: "TestUser",
    });
    const user = await get<{
      email: string;
      password_hash: string;
      username: string;
    }>(
      currentServer.database,
      "SELECT username, email, password_hash FROM users WHERE username = ?",
      ["TestUser"],
    );
    const sessions = await all<{ sess: string }>(
      currentServer.database,
      "SELECT sess FROM sessions",
    );

    expect(registerPage.status).toBe(200);
    expect(registerPage.headers["cache-control"]).toBe("no-store");
    expect(registerPage.text).toContain('name="captchaId"');
    expect(registerPage.text).not.toContain('name="captchaAnswer" value=');
    expect(response.status).toBe(303);
    expect(response.headers.location).toBe("/login");
    expect(user?.username).toBe("TestUser");
    expect(user?.email).toBe("user@example.com");
    expect(user?.password_hash).toMatch(/^v1\$pbkdf2_sha256\$/);
    expect(user?.password_hash).not.toContain(password);
    expect(sessions.some((session) => session.sess.includes("Регистрация успешна! Войдите в систему."))).toBe(
      true,
    );
  });

  it("returns validation errors without reflecting passwords or CAPTCHA answers", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    const initialPage = await agent.get("/register");
    const initialChallenge = extractCaptcha(initialPage.text);

    const response = await agent.post("/register").type("form").send({
      captchaAnswer: initialChallenge.answer,
      captchaId: initialChallenge.captchaId,
      email: "invalid email",
      password: "bad-pass",
      passwordConfirmation: "different-pass",
      username: "ab!",
    });
    const nextChallenge = extractCaptcha(response.text);

    expect(response.status).toBe(422);
    expect(response.text).toContain("Введите корректный email");
    expect(response.text).toContain("Пароли не совпадают");
    expect(response.text).not.toContain('value="bad-pass"');
    expect(response.text).not.toContain('value="different-pass"');
    expect(response.text).not.toContain(`value="${initialChallenge.answer}"`);
    expect(nextChallenge.captchaId).not.toBe(initialChallenge.captchaId);
  });

  it("consumes an incorrect CAPTCHA and rejects replay of the original ID", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);
    const initialPage = await agent.get("/register");
    const challenge = extractCaptcha(initialPage.text);
    const fields = {
      email: "user@example.com",
      password: "Secret1!",
      passwordConfirmation: "Secret1!",
      username: "TestUser",
    };

    const incorrectResponse = await agent.post("/register").type("form").send({
      ...fields,
      captchaAnswer: "999",
      captchaId: challenge.captchaId,
    });
    const replayResponse = await agent.post("/register").type("form").send({
      ...fields,
      captchaAnswer: challenge.answer,
      captchaId: challenge.captchaId,
    });

    expect(incorrectResponse.status).toBe(422);
    expect(incorrectResponse.text).toContain("Неверный ответ капчи");
    expect(replayResponse.status).toBe(422);
    expect(replayResponse.text).toContain("Неверный ответ капчи");
    expect(
      await get<{ count: number }>(
        currentServer.database,
        "SELECT COUNT(*) AS count FROM users",
      ),
    ).toEqual({ count: 0 });
  });

  it("returns separate messages for duplicate username and email", async () => {
    const currentServer = requireStartedServer(startedServer);
    const agent = request.agent(currentServer.server);

    await register(agent, "TestUser", "first@example.com");

    const usernamePage = await agent.get("/register");
    const usernameChallenge = extractCaptcha(usernamePage.text);
    const usernameConflict = await agent.post("/register").type("form").send({
      captchaAnswer: usernameChallenge.answer,
      captchaId: usernameChallenge.captchaId,
      email: "second@example.com",
      password: "Secret1!",
      passwordConfirmation: "Secret1!",
      username: "testuser",
    });

    const emailPage = await agent.get("/register");
    const emailChallenge = extractCaptcha(emailPage.text);
    const emailConflict = await agent.post("/register").type("form").send({
      captchaAnswer: emailChallenge.answer,
      captchaId: emailChallenge.captchaId,
      email: "FIRST@example.com",
      password: "Secret1!",
      passwordConfirmation: "Secret1!",
      username: "SecondUser",
    });

    expect(usernameConflict.status).toBe(409);
    expect(usernameConflict.text).toContain("Пользователь с таким именем уже существует");
    expect(emailConflict.status).toBe(409);
    expect(emailConflict.text).toContain("Пользователь с таким email уже зарегистрирован");
  });
});

async function register(
  agent: request.Agent,
  username: string,
  email: string,
): Promise<void> {
  const page = await agent.get("/register");
  const challenge = extractCaptcha(page.text);
  const response = await agent.post("/register").type("form").send({
    captchaAnswer: challenge.answer,
    captchaId: challenge.captchaId,
    email,
    password: "Secret1!",
    passwordConfirmation: "Secret1!",
    username,
  });

  expect(response.status).toBe(303);
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
    throw new Error("CAPTCHA was not found in the registration page");
  }

  return {
    answer: String(Number(firstNumber) + Number(secondNumber)),
    captchaId,
  };
}

function requireStartedServer(startedServer: StartedServer | undefined): StartedServer {
  if (!startedServer) {
    throw new Error("Test server is not initialized");
  }

  return startedServer;
}
