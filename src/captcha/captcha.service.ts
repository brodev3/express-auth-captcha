import { randomBytes, randomInt } from "node:crypto";
import type { SessionData } from "express-session";

export type CaptchaPurpose = "register" | "login";

export const CAPTCHA_TTL_MS = 5 * 60 * 1000;
export const CAPTCHA_MAX_ACTIVE_PER_PURPOSE = 5;
export const CAPTCHA_RANDOM_BYTES = 16;

export interface CaptchaChallenge {
  captchaId: string;
  question: string;
}

export interface CaptchaRandomSource {
  int(min: number, maxExclusive: number): number;
  bytes(size: number): Buffer;
}

export interface CaptchaServiceOptions {
  clock?: () => number;
  random?: CaptchaRandomSource;
}

export type CaptchaSession = Pick<SessionData, "captchas">;

const defaultRandomSource: CaptchaRandomSource = {
  bytes: (size) => randomBytes(size),
  int: (min, maxExclusive) => randomInt(min, maxExclusive),
};

export class CaptchaService {
  private readonly clock: () => number;
  private readonly random: CaptchaRandomSource;

  public constructor(options: CaptchaServiceOptions = {}) {
    this.clock = options.clock ?? Date.now;
    this.random = options.random ?? defaultRandomSource;
  }

  public issue(session: CaptchaSession, purpose: CaptchaPurpose): CaptchaChallenge {
    const now = this.clock();
    const captchas = session.captchas ?? (session.captchas = {});

    this.removeExpired(captchas, now);
    this.removeOldestForPurpose(captchas, purpose);

    const firstNumber = this.random.int(1, 21);
    const secondNumber = this.random.int(1, 21);
    const captchaId = this.random.bytes(CAPTCHA_RANDOM_BYTES).toString("base64url");

    captchas[captchaId] = {
      answer: firstNumber + secondNumber,
      createdAt: now,
      expiresAt: now + CAPTCHA_TTL_MS,
      purpose,
    };

    return {
      captchaId,
      question: `Сколько будет ${firstNumber} + ${secondNumber}?`,
    };
  }

  public consume(
    session: CaptchaSession,
    purpose: CaptchaPurpose,
    captchaId: string | undefined,
    answer: string | undefined,
  ): boolean {
    const captchas = session.captchas;

    if (
      !captchas ||
      typeof captchaId !== "string" ||
      typeof answer !== "string" ||
      !Object.hasOwn(captchas, captchaId)
    ) {
      return false;
    }

    const captcha = captchas[captchaId];

    if (!captcha) {
      return false;
    }

    delete captchas[captchaId];

    if (captcha.purpose !== purpose || captcha.expiresAt <= this.clock()) {
      return false;
    }

    if (!/^\d+$/.test(answer)) {
      return false;
    }

    const numericAnswer = Number(answer);
    return Number.isSafeInteger(numericAnswer) && numericAnswer === captcha.answer;
  }

  private removeExpired(
    captchas: NonNullable<CaptchaSession["captchas"]>,
    now: number,
  ): void {
    for (const [captchaId, captcha] of Object.entries(captchas)) {
      if (captcha.expiresAt <= now) {
        delete captchas[captchaId];
      }
    }
  }

  private removeOldestForPurpose(
    captchas: NonNullable<CaptchaSession["captchas"]>,
    purpose: CaptchaPurpose,
  ): void {
    const activeForPurpose = Object.entries(captchas).filter(
      ([, captcha]) => captcha.purpose === purpose,
    );

    while (activeForPurpose.length >= CAPTCHA_MAX_ACTIVE_PER_PURPOSE) {
      const oldest = activeForPurpose.reduce((oldestEntry, current) => {
        return current[1].createdAt < oldestEntry[1].createdAt
          ? current
          : oldestEntry;
      });

      delete captchas[oldest[0]];
      const oldestIndex = activeForPurpose.findIndex(([captchaId]) => captchaId === oldest[0]);
      activeForPurpose.splice(oldestIndex, 1);
    }
  }
}
