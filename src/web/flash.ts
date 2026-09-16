import type { SessionData } from "express-session";

export type FlashMessage = NonNullable<SessionData["flash"]>;
export type FlashSession = Pick<SessionData, "flash">;

export function setFlash(session: FlashSession, message: FlashMessage): void {
  session.flash = message;
}

export function consumeFlash(session: FlashSession): FlashMessage | undefined {
  const message = session.flash;
  delete session.flash;
  return message;
}
