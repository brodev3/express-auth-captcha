export type RegisterField =
  | "username"
  | "email"
  | "password"
  | "passwordConfirmation"
  | "captchaAnswer";

export type RegisterFieldErrors = Partial<Record<RegisterField, string>>;

export type LoginField = "login" | "password" | "captchaAnswer";
export type LoginFieldErrors = Partial<Record<LoginField, string>>;

export interface RegisterInput {
  captchaAnswer: string;
  captchaId: string;
  email: string;
  password: string;
  passwordConfirmation: string;
  username: string;
}

export interface RegisterValidationResult {
  errors: RegisterFieldErrors;
  input: RegisterInput;
}

export interface LoginInput {
  captchaAnswer: string;
  captchaId: string;
  login: string;
  password: string;
}

export interface LoginValidationResult {
  errors: LoginFieldErrors;
  input: LoginInput;
}

export function validateRegisterForm(body: unknown): RegisterValidationResult {
  const rawUsername = readString(body, "username");
  const rawEmail = readString(body, "email");
  const password = readString(body, "password");
  const passwordConfirmation = readString(body, "passwordConfirmation");
  const captchaAnswer = readString(body, "captchaAnswer");
  const captchaId = readString(body, "captchaId");
  const username = rawUsername.trim();
  const email = rawEmail.trim().toLowerCase();
  const errors: RegisterFieldErrors = {};

  validateUsername(username, errors);
  validateEmail(email, errors);
  validatePassword(password, errors);
  validatePasswordConfirmation(password, passwordConfirmation, errors);

  return {
    errors,
    input: {
      captchaAnswer,
      captchaId,
      email,
      password,
      passwordConfirmation,
      username,
    },
  };
}

export function validateLoginForm(body: unknown): LoginValidationResult {
  const login = readString(body, "login").trim();
  const password = readString(body, "password");
  const captchaAnswer = readString(body, "captchaAnswer");
  const captchaId = readString(body, "captchaId");
  const errors: LoginFieldErrors = {};

  if (!login) {
    errors.login = "Введите логин";
  } else if (login.length > 100) {
    errors.login = "Логин не должен превышать 100 символов";
  }

  if (!password) {
    errors.password = "Введите пароль";
  }

  return {
    errors,
    input: {
      captchaAnswer,
      captchaId,
      login,
      password,
    },
  };
}

function validateUsername(username: string, errors: RegisterFieldErrors): void {
  if (!username) {
    errors.username = "Введите имя пользователя";
    return;
  }

  if (username.length < 3 || username.length > 20) {
    errors.username = "Имя пользователя должно содержать от 3 до 20 символов";
    return;
  }

  if (!/^[A-Za-z0-9]+$/.test(username)) {
    errors.username = "Имя пользователя должно содержать только латинские буквы и цифры";
  }
}

function validateEmail(email: string, errors: RegisterFieldErrors): void {
  if (!email) {
    errors.email = "Введите email";
    return;
  }

  if (email.length > 100) {
    errors.email = "Email не должен превышать 100 символов";
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Введите корректный email";
  }
}

function validatePassword(password: string, errors: RegisterFieldErrors): void {
  if (!password) {
    errors.password = "Введите пароль";
    return;
  }

  if (password.length < 6 || password.length > 128) {
    errors.password = "Пароль должен содержать от 6 до 128 символов";
    return;
  }

  if (/\p{Cc}/u.test(password)) {
    errors.password = "Пароль содержит недопустимые символы";
    return;
  }

  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = "Пароль должен содержать латинскую букву и цифру";
  }
}

function validatePasswordConfirmation(
  password: string,
  passwordConfirmation: string,
  errors: RegisterFieldErrors,
): void {
  if (!passwordConfirmation) {
    errors.passwordConfirmation = "Подтвердите пароль";
    return;
  }

  if (passwordConfirmation !== password) {
    errors.passwordConfirmation = "Пароли не совпадают";
  }
}

function readString(body: unknown, field: string): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "";
  }

  const value = (body as Record<string, unknown>)[field];
  return typeof value === "string" ? value : "";
}
