import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
  type RequestHandler,
} from "express";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { AuthService } from "./auth/auth.service.js";
import { createAuthRouter } from "./auth/auth.routes.js";
import { CaptchaService } from "./captcha/captcha.service.js";

export interface AppOptions {
  authService?: AuthService;
  captchaService?: CaptchaService;
  projectRoot?: string;
  sessionMiddleware?: RequestHandler;
}

export function createApp(options: AppOptions = {}): Express {
  const projectRoot = options.projectRoot ?? fileURLToPath(new URL("../", import.meta.url));
  const app = express();

  app.set("trust proxy", 1);
  app.set("view engine", "ejs");
  app.set("views", path.join(projectRoot, "views"));

  app.use(express.urlencoded({ extended: false, limit: "10kb" }));
  app.use(express.static(path.join(projectRoot, "public")));

  app.get("/favicon.ico", (_request, response) => {
    response.status(204).end();
  });

  if (options.sessionMiddleware) {
    app.use(options.sessionMiddleware);
  }

  if (options.authService && options.captchaService) {
    app.use(createAuthRouter({
      authService: options.authService,
      captchaService: options.captchaService,
    }));
  }

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });

  app.use((_request, response) => {
    response.status(404).render("error", {
      title: "Страница не найдена",
      message: "Запрошенная страница не найдена.",
    });
  });

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) {
      next(error);
      return;
    }

    const status = getErrorStatus(error);

    response.status(status).render("error", {
      title: status < 500 ? "Некорректный запрос" : "Внутренняя ошибка",
      message: "Не удалось обработать запрос.",
    });
  });

  return app;
}

function getErrorStatus(error: unknown): number {
  if (!(error instanceof Error)) {
    return 500;
  }

  const errorWithStatus = error as Error & {
    status?: unknown;
    statusCode?: unknown;
  };
  const status = errorWithStatus.status ?? errorWithStatus.statusCode;

  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status < 500
    ? status
    : 500;
}
