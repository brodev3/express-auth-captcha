import { describe, expect, it } from "vitest";

import { validateRegisterForm } from "../../src/auth/validation.js";

describe("registration validation", () => {
  it("normalizes username and email without changing the password", () => {
    const result = validateRegisterForm({
      captchaAnswer: "10",
      captchaId: "captcha-id",
      email: "  USER@Example.COM ",
      password: " Secret1! ",
      passwordConfirmation: " Secret1! ",
      username: "  User123  ",
    });

    expect(result.errors).toEqual({});
    expect(result.input.username).toBe("User123");
    expect(result.input.email).toBe("user@example.com");
    expect(result.input.password).toBe(" Secret1! ");
  });

  it("returns field errors for invalid registration input", () => {
    const result = validateRegisterForm({
      captchaAnswer: "",
      captchaId: "",
      email: "invalid email",
      password: "abc",
      passwordConfirmation: "different",
      username: "ab",
    });

    expect(result.errors.username).toContain("от 3 до 20");
    expect(result.errors.email).toBe("Введите корректный email");
    expect(result.errors.password).toBe("Пароль должен содержать от 6 до 128 символов");
    expect(result.errors.passwordConfirmation).toBe("Пароли не совпадают");
  });

  it("enforces the registration boundaries", () => {
    const valid = {
      captchaAnswer: "10",
      captchaId: "captcha-id",
      email: "user@example.com",
      password: "Secret1!",
      passwordConfirmation: "Secret1!",
      username: "user123",
    };

    expect(validateRegisterForm({ ...valid, username: "ab" }).errors.username).toBeTruthy();
    expect(
      validateRegisterForm({ ...valid, username: "a".repeat(21) }).errors.username,
    ).toBeTruthy();
    expect(
      validateRegisterForm({ ...valid, email: `${"a".repeat(92)}@example.com` }).errors.email,
    ).toBeTruthy();
    expect(
      validateRegisterForm({ ...valid, password: "abcdef" }).errors.password,
    ).toContain("латинскую букву и цифру");
    expect(
      validateRegisterForm({ ...valid, password: "ABCDEF" }).errors.password,
    ).toContain("латинскую букву и цифру");
    expect(
      validateRegisterForm({ ...valid, password: "Secret1\n" }).errors.password,
    ).toBe("Пароль содержит недопустимые символы");
  });
});
