import { describe, expect, it } from "vitest";

import {
  PASSWORD_KEY_BYTES,
  PASSWORD_SALT_BYTES,
  PasswordHasher,
} from "../../src/auth/password.js";

describe("PasswordHasher", () => {
  it("creates the documented PBKDF2 format and verifies passwords", async () => {
    const hasher = new PasswordHasher({
      iterations: 10_000,
      randomBytes: (size) => Buffer.alloc(size, 1),
    });

    const encodedHash = await hasher.hash("Secret1!");
    const parts = encodedHash.split("$");

    expect(parts).toHaveLength(5);
    expect(parts[0]).toBe("v1");
    expect(parts[1]).toBe("pbkdf2_sha256");
    expect(parts[2]).toBe("10000");
    expect(Buffer.from(parts[3] ?? "", "base64")).toHaveLength(PASSWORD_SALT_BYTES);
    expect(Buffer.from(parts[4] ?? "", "base64")).toHaveLength(PASSWORD_KEY_BYTES);
    expect(await hasher.verify("Secret1!", encodedHash)).toBe(true);
    expect(await hasher.verify("Wrong1!", encodedHash)).toBe(false);
  });

  it("uses a new salt for each password hash", async () => {
    let saltNumber = 0;
    const hasher = new PasswordHasher({
      iterations: 1_000,
      randomBytes: (size) => Buffer.alloc(size, saltNumber++),
    });

    const firstHash = await hasher.hash("Secret1!");
    const secondHash = await hasher.hash("Secret1!");

    expect(firstHash).not.toBe(secondHash);
    expect(await hasher.verify("Secret1!", firstHash)).toBe(true);
    expect(await hasher.verify("Secret1!", secondHash)).toBe(true);
  });

  it("rejects malformed hashes and provides a valid dummy hash", async () => {
    const hasher = new PasswordHasher({ iterations: 1_000 });

    expect(await hasher.verify("Secret1!", "not-a-password-hash")).toBe(false);
    expect(
      await hasher.verify(
        "Secret1!",
        "v1$pbkdf2_sha256$1000$AAAAAAAAAAAAAAAAAAAAAA==$AA==",
      ),
    ).toBe(false);
    expect(await hasher.verify("Secret1!", hasher.getDummyHash())).toBe(false);
  });
});
