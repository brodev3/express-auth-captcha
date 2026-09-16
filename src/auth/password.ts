import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";

export const PASSWORD_HASH_ITERATIONS = 600_000;
export const PASSWORD_SALT_BYTES = 16;
export const PASSWORD_KEY_BYTES = 32;

const HASH_VERSION = "v1";
const HASH_ALGORITHM = "pbkdf2_sha256";
const MAX_PBKDF2_ITERATIONS = 10_000_000;

export interface PasswordHasherOptions {
  iterations?: number;
  randomBytes?: (size: number) => Buffer;
}

interface ParsedPasswordHash {
  derivedKey: Buffer;
  iterations: number;
  salt: Buffer;
}

export class PasswordHasher {
  private readonly iterations: number;
  private readonly randomBytes: (size: number) => Buffer;

  public constructor(options: PasswordHasherOptions = {}) {
    const iterations = options.iterations ?? PASSWORD_HASH_ITERATIONS;

    if (!isValidIterationCount(iterations)) {
      throw new Error("PBKDF2 iterations must be a positive safe integer");
    }

    this.iterations = iterations;
    this.randomBytes = options.randomBytes ?? randomBytes;
  }

  public async hash(password: string): Promise<string> {
    const salt = this.randomBytes(PASSWORD_SALT_BYTES);

    if (salt.length !== PASSWORD_SALT_BYTES) {
      throw new Error("Password salt source returned an invalid length");
    }

    const derivedKey = await deriveKey(password, salt, this.iterations);
    return formatPasswordHash(this.iterations, salt, derivedKey);
  }

  public async verify(password: string, encodedHash: string): Promise<boolean> {
    const parsedHash = parsePasswordHash(encodedHash);

    if (!parsedHash) {
      return false;
    }

    const derivedKey = await deriveKey(password, parsedHash.salt, parsedHash.iterations);

    if (derivedKey.length !== parsedHash.derivedKey.length) {
      return false;
    }

    return timingSafeEqual(derivedKey, parsedHash.derivedKey);
  }

  public getDummyHash(): string {
    return formatPasswordHash(
      this.iterations,
      Buffer.alloc(PASSWORD_SALT_BYTES),
      Buffer.alloc(PASSWORD_KEY_BYTES),
    );
  }
}

function deriveKey(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    pbkdf2(password, salt, iterations, PASSWORD_KEY_BYTES, "sha256", (error, derivedKey) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(derivedKey);
    });
  });
}

function formatPasswordHash(iterations: number, salt: Buffer, derivedKey: Buffer): string {
  return [
    HASH_VERSION,
    HASH_ALGORITHM,
    String(iterations),
    salt.toString("base64"),
    derivedKey.toString("base64"),
  ].join("$");
}

function parsePasswordHash(encodedHash: string): ParsedPasswordHash | null {
  const parts = encodedHash.split("$");

  if (parts.length !== 5) {
    return null;
  }

  const [version, algorithm, iterationsText, saltText, derivedKeyText] = parts;

  if (
    version !== HASH_VERSION ||
    algorithm !== HASH_ALGORITHM ||
    !iterationsText ||
    !saltText ||
    !derivedKeyText ||
    !/^\d+$/.test(iterationsText)
  ) {
    return null;
  }

  const iterations = Number(iterationsText);

  if (!isValidIterationCount(iterations)) {
    return null;
  }

  const salt = decodeBase64(saltText);
  const derivedKey = decodeBase64(derivedKeyText);

  if (
    !salt ||
    !derivedKey ||
    salt.length !== PASSWORD_SALT_BYTES ||
    derivedKey.length !== PASSWORD_KEY_BYTES
  ) {
    return null;
  }

  return { derivedKey, iterations, salt };
}

function decodeBase64(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return null;
  }

  const decoded = Buffer.from(value, "base64");
  return decoded.toString("base64") === value ? decoded : null;
}

function isValidIterationCount(value: number): boolean {
  return (
    Number.isSafeInteger(value) &&
    value > 0 &&
    value <= MAX_PBKDF2_ITERATIONS
  );
}
