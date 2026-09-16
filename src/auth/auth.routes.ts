import express, { type Response, type Router } from "express";

import { AuthService, type RegisterResult } from "./auth.service.js";
import { CaptchaService, type CaptchaChallenge } from "../captcha/captcha.service.js";
import {
  validateLoginForm,
  validateRegisterForm,
  type RegisterFieldErrors,
  type RegisterInput,
  type LoginFieldErrors,
  type LoginInput,
} from "./validation.js";
import { consumeFlash, setFlash, type FlashMessage } from "../web/flash.js";
import { SESSION_COOKIE_NAME } from "../web/session.js";
import type { Session } from "express-session";
import { requireAuthenticated } from "./auth.middleware.js";

const REGISTER_TITLE = "Регистрация";

export interface AuthRoutesOptions {
  authService: AuthService;
  captchaService: CaptchaService;
}

export interface RegisterViewModel {
  captcha: {
    captchaId: string;
    question: string;
  };
  errors: RegisterFieldErrors;
  form: {
    email: string;
    username: string;
  };
  title: string;
}

export interface LoginViewModel {
  captcha: CaptchaChallenge;
  errors: LoginFieldErrors;
  flash: FlashMessage | null;
  form: {
    login: string;
  };
  message: string | null;
  title: string;
}

export function createAuthRouter(options: AuthRoutesOptions): Router {
  const router = express.Router();

  router.get("/", (request, response) => {
    response.redirect(303, request.session.auth ? "/profile" : "/login");
  });

  router.get("/register", (request, response) => {
    if (request.session.auth) {
      response.redirect(303, "/profile");
      return;
    }

    renderRegister(response, 200, options.captchaService.issue(request.session, "register"), {
      captchaAnswer: "",
      captchaId: "",
      email: "",
      password: "",
      passwordConfirmation: "",
      username: "",
    }, {});
  });

  router.get("/login", (request, response) => {
    if (request.session.auth) {
      response.redirect(303, "/profile");
      return;
    }

    renderLogin(
      response,
      200,
      options.captchaService.issue(request.session, "login"),
      { captchaAnswer: "", captchaId: "", login: "", password: "" },
      {},
      null,
      consumeFlash(request.session) ?? null,
    );
  });

  router.post("/register", async (request, response): Promise<void> => {
    if (request.session.auth) {
      response.redirect(303, "/profile");
      return;
    }

    const validation = validateRegisterForm(request.body);
    const errors: RegisterFieldErrors = { ...validation.errors };
    const captchaIsValid = options.captchaService.consume(
      request.session,
      "register",
      validation.input.captchaId,
      validation.input.captchaAnswer,
    );

    if (!captchaIsValid) {
      errors.captchaAnswer = "Неверный ответ капчи";
    }

    if (Object.keys(errors).length > 0) {
      renderRegister(
        response,
        422,
        options.captchaService.issue(request.session, "register"),
        validation.input,
        errors,
      );
      return;
    }

    const result = await options.authService.register({
      email: validation.input.email,
      password: validation.input.password,
      username: validation.input.username,
    });

    if (result.kind === "conflict") {
      errors[result.field] = getConflictMessage(result);
      renderRegister(
        response,
        409,
        options.captchaService.issue(request.session, "register"),
        validation.input,
        errors,
      );
      return;
    }

    setFlash(request.session, {
      kind: "success",
      message: "Регистрация успешна! Войдите в систему.",
    });
    response.redirect(303, "/login");
  });

  router.post("/login", async (request, response): Promise<void> => {
    if (request.session.auth) {
      response.redirect(303, "/profile");
      return;
    }

    const validation = validateLoginForm(request.body);
    const captchaIsValid = options.captchaService.consume(
      request.session,
      "login",
      validation.input.captchaId,
      validation.input.captchaAnswer,
    );

    if (!captchaIsValid) {
      const errors: LoginFieldErrors = {
        ...validation.errors,
        captchaAnswer: "Неверный ответ капчи",
      };
      renderLogin(
        response,
        422,
        options.captchaService.issue(request.session, "login"),
        validation.input,
        errors,
        null,
        null,
      );
      return;
    }

    if (Object.keys(validation.errors).length > 0) {
      renderLogin(
        response,
        422,
        options.captchaService.issue(request.session, "login"),
        validation.input,
        validation.errors,
        null,
        null,
      );
      return;
    }

    const result = await options.authService.login({
      login: validation.input.login,
      password: validation.input.password,
    });

    if (result.kind === "invalid") {
      renderLogin(
        response,
        401,
        options.captchaService.issue(request.session, "login"),
        validation.input,
        {},
        "Неверный логин или пароль",
        null,
      );
      return;
    }

    await regenerateSession(request.session);
    request.session.auth = {
      userId: result.user.id,
      username: result.user.username,
    };
    response.redirect(303, "/profile");
  });

  router.get("/profile", requireAuthenticated, async (request, response): Promise<void> => {
    const auth = request.session.auth;

    if (!auth || !Number.isInteger(auth.userId) || auth.userId < 1) {
      await destroySession(request.session);
      clearSessionCookie(response);
      response.redirect(303, "/login");
      return;
    }

    const user = await options.authService.findUserById(auth.userId);

    if (!user) {
      await destroySession(request.session);
      clearSessionCookie(response);
      response.redirect(303, "/login");
      return;
    }

    response.set("Cache-Control", "no-store");
    response.status(200).render("profile", {
      createdAt: formatCreatedAt(user.createdAt),
      email: user.email,
      role: "Пользователь",
      title: "Профиль",
      username: user.username,
    });
  });

  router.post(
    "/logout",
    requireAuthenticated,
    async (request, response): Promise<void> => {
      await destroySession(request.session);
      clearSessionCookie(response);
      response.redirect(303, "/login");
    },
  );

  return router;
}

function renderRegister(
  response: Response,
  status: number,
  captcha: RegisterViewModel["captcha"],
  input: RegisterInput,
  errors: RegisterFieldErrors,
): void {
  response.set("Cache-Control", "no-store");
  response.status(status).render("register", {
    captcha,
    errors,
    form: {
      email: input.email,
      username: input.username,
    },
    title: REGISTER_TITLE,
  } satisfies RegisterViewModel);
}

function renderLogin(
  response: Response,
  status: number,
  captcha: LoginViewModel["captcha"],
  input: LoginInput,
  errors: LoginFieldErrors,
  message: string | null,
  flash: FlashMessage | null,
): void {
  response.set("Cache-Control", "no-store");
  response.status(status).render("login", {
    captcha,
    errors,
    flash,
    form: { login: input.login },
    message,
    title: "Вход",
  } satisfies LoginViewModel);
}

function regenerateSession(session: Session): Promise<void> {
  return new Promise((resolve, reject) => {
    session.regenerate((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function destroySession(session: Session): Promise<void> {
  return new Promise((resolve, reject) => {
    session.destroy((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function clearSessionCookie(response: Response): void {
  response.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

function formatCreatedAt(createdAt: string): string {
  const isoCreatedAt = createdAt.includes("T")
    ? createdAt
    : `${createdAt.replace(" ", "T")}Z`;
  const date = new Date(isoCreatedAt);

  return Number.isNaN(date.getTime())
    ? createdAt
    : date.toLocaleDateString("ru-RU", { timeZone: "UTC" });
}

function getConflictMessage(
  result: Extract<RegisterResult, { kind: "conflict" }>,
): string {
  return result.field === "username"
    ? "Пользователь с таким именем уже существует"
    : "Пользователь с таким email уже зарегистрирован";
}
