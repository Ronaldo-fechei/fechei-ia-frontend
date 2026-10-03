import "fastify";
import type { AuthContext } from "./plugins/auth";

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
    rawBody?: Buffer;
  }
}
