// Types shared by the services and the web app. No runtime dependencies.

// No login (ADR-001): the caller names itself in this header.
export const USER_HEADER = "x-user";

export type Check = { ok: boolean; detail: string };

export type Health = {
  service: string;
  port: number;
  postgres: Check;
  redis?: Check;
};

export type ApiErrorBody = { statusCode: number; code: string; message: string };
