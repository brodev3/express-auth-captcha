import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

describe("app factory", () => {
  it("serves the health endpoint", async () => {
    const response = await request(createApp()).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("handles the browser favicon request without a console error", async () => {
    const response = await request(createApp()).get("/favicon.ico");

    expect(response.status).toBe(204);
    expect(response.text).toBe("");
  });

  it("renders a safe Russian 404 page", async () => {
    const response = await request(createApp()).get("/missing");

    expect(response.status).toBe(404);
    expect(response.type).toBe("text/html");
    expect(response.text).toContain("Страница не найдена");
  });

  it("preserves the 413 status for an oversized form body", async () => {
    const response = await request(createApp())
      .post("/health")
      .type("form")
      .send({ data: "x".repeat(11_000) });

    expect(response.status).toBe(413);
    expect(response.text).toContain("Некорректный запрос");
    expect(response.text).toContain("Не удалось обработать запрос.");
    expect(response.text).not.toContain("PayloadTooLargeError");
  });

  it("hides unexpected error details", async () => {
    const response = await request(createApp({
      sessionMiddleware: () => {
        throw new Error("internal test detail");
      },
    })).get("/health");

    expect(response.status).toBe(500);
    expect(response.text).toContain("Не удалось обработать запрос.");
    expect(response.text).not.toContain("internal test detail");
  });
});
