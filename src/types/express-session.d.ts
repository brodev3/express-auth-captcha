import "express-session";

declare module "express-session" {
  interface AuthSessionData {
    userId: number;
    username: string;
  }

  interface CaptchaSessionData {
    purpose: "register" | "login";
    answer: number;
    createdAt: number;
    expiresAt: number;
  }

  interface SessionData {
    auth?: AuthSessionData;
    captchas?: Record<string, CaptchaSessionData>;
    flash?: {
      kind: "success" | "info";
      message: string;
    };
  }
}
