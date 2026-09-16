import { describe, expect, it } from "vitest";

import {
  CAPTCHA_MAX_ACTIVE_PER_PURPOSE,
  CAPTCHA_RANDOM_BYTES,
  CAPTCHA_TTL_MS,
  CaptchaService,
  type CaptchaRandomSource,
  type CaptchaSession,
} from "../../src/captcha/captcha.service.js";

describe("CaptchaService", () => {
  it("issues a public question and keeps the answer in the session", () => {
    const session: CaptchaSession = {};
    const service = new CaptchaService({
      clock: () => 1_000,
      random: sequenceRandom([3, 7], [1]),
    });

    const challenge = service.issue(session, "register");

    expect(challenge.question).toBe("Сколько будет 3 + 7?");
    expect(challenge.captchaId).toBeTruthy();
    expect(challenge.captchaId).not.toContain("10");
    expect(session.captchas?.[challenge.captchaId]).toEqual({
      answer: 10,
      createdAt: 1_000,
      expiresAt: 1_000 + CAPTCHA_TTL_MS,
      purpose: "register",
    });
  });

  it("consumes a challenge before checking the answer", () => {
    const session: CaptchaSession = {};
    const service = new CaptchaService({
      random: sequenceRandom([4, 6], [2]),
    });
    const challenge = service.issue(session, "login");

    expect(service.consume(session, "login", challenge.captchaId, "wrong")).toBe(false);
    expect(session.captchas).toEqual({});
    expect(service.consume(session, "login", challenge.captchaId, "10")).toBe(false);
  });

  it("rejects another purpose, malformed answers, and expired challenges", () => {
    let now = 10_000;
    const session: CaptchaSession = {};
    const service = new CaptchaService({
      clock: () => now,
      random: sequenceRandom([8, 2, 1, 1], [3, 4]),
    });
    const loginChallenge = service.issue(session, "login");
    const registerChallenge = service.issue(session, "register");

    expect(service.consume(session, "register", loginChallenge.captchaId, "10")).toBe(false);
    expect(service.consume(session, "login", loginChallenge.captchaId, "10")).toBe(false);
    expect(service.consume(session, "register", registerChallenge.captchaId, " 2 ")).toBe(
      false,
    );

    const expiredChallenge = service.issue(session, "login");
    now += CAPTCHA_TTL_MS;

    expect(service.consume(session, "login", expiredChallenge.captchaId, "2")).toBe(false);
  });

  it("keeps at most five active challenges per purpose and removes the oldest", () => {
    let now = 0;
    const session: CaptchaSession = {};
    let nextBytes = 0;
    const service = new CaptchaService({
      clock: () => now++,
      random: {
        bytes: () => Buffer.from(String(nextBytes++).padStart(CAPTCHA_RANDOM_BYTES, "0")),
        int: () => 1,
      },
    });
    const issuedIds: string[] = [];

    for (let index = 0; index < CAPTCHA_MAX_ACTIVE_PER_PURPOSE + 1; index += 1) {
      issuedIds.push(service.issue(session, "register").captchaId);
    }

    const registerCaptchas = Object.values(session.captchas ?? {}).filter(
      (captcha) => captcha.purpose === "register",
    );

    expect(registerCaptchas).toHaveLength(CAPTCHA_MAX_ACTIVE_PER_PURPOSE);
    expect(session.captchas?.[issuedIds[0] ?? ""]).toBeUndefined();

    service.issue(session, "login");
    const loginCaptchas = Object.values(session.captchas ?? {}).filter(
      (captcha) => captcha.purpose === "login",
    );
    expect(loginCaptchas).toHaveLength(1);
  });

  it("removes expired challenges before issuing a new one", () => {
    let now = 100;
    const session: CaptchaSession = {};
    const service = new CaptchaService({
      clock: () => now,
      random: sequenceRandom([1, 1, 1, 1], [5, 6]),
    });
    const oldChallenge = service.issue(session, "register");

    now += CAPTCHA_TTL_MS;
    const newChallenge = service.issue(session, "register");

    expect(session.captchas?.[oldChallenge.captchaId]).toBeUndefined();
    expect(session.captchas?.[newChallenge.captchaId]).toBeDefined();
  });
});

function sequenceRandom(numbers: number[], byteValues: number[]): CaptchaRandomSource {
  let numberIndex = 0;
  let byteIndex = 0;

  return {
    bytes: (size) => {
      const value = byteValues[byteIndex] ?? 0;
      byteIndex += 1;
      return Buffer.alloc(size, value);
    },
    int: () => {
      const value = numbers[numberIndex] ?? 1;
      numberIndex += 1;
      return value;
    },
  };
}
