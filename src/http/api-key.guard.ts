import { type CanActivate, type ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

const PUBLIC = "ledgerline:public";
export const Public = () => SetMetadata(PUBLIC, true);

// One API key for the whole API, compared in constant time.
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly expected: Buffer;

  constructor(private readonly reflector: Reflector) {
    const key = process.env.LEDGERLINE_API_KEY;
    if (!key || key.length < 16) throw new Error("LEDGERLINE_API_KEY must be set (16 characters or more)");
    this.expected = digest(key);
  }

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const header = context.switchToHttp().getRequest<Request>().headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!timingSafeEqual(digest(token), this.expected)) throw new UnauthorizedException("a valid API key is required");
    return true;
  }
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
