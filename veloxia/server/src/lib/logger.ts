import pino from "pino";
import { env, isProd, isTest } from "../config/env";

/** Campos sensíveis nunca devem ir para os logs. */
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.password",
  "*.accessToken",
  "*.access_token",
  "*.token",
  "*.client_secret",
];

export const loggerOptions: pino.LoggerOptions = {
  level: isTest ? "silent" : env.LOG_LEVEL,
  redact: { paths: REDACT_PATHS, censor: "[redacted]" },
  ...(isProd || isTest ? {} : { transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } }),
};

export const logger = pino(loggerOptions);
