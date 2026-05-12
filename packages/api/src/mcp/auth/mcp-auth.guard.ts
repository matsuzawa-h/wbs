import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';

const ALLOWED_ORIGIN_PATTERNS = [
  /^https?:\/\/localhost(:\d+)?$/i,
  /^https?:\/\/127\.0\.0\.1(:\d+)?$/i,
  /^https?:\/\/\[::1\](:\d+)?$/i,
];

@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly logger = new Logger(McpAuthGuard.name);
  private readonly token: string;

  constructor() {
    const token = process.env.MCP_TOKEN;
    if (!token || token.length < 16) {
      throw new Error(
        'MCP_TOKEN environment variable must be set to a strong secret (>=16 chars) before starting the MCP server',
      );
    }
    this.token = token;
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const origin = req.headers['origin'];
    if (typeof origin === 'string' && origin.length > 0) {
      const ok = ALLOWED_ORIGIN_PATTERNS.some((re) => re.test(origin));
      if (!ok) {
        this.logger.warn(`Rejected MCP request with disallowed Origin: ${origin}`);
        throw new UnauthorizedException('disallowed origin');
      }
    }

    const auth = req.headers['authorization'];
    if (typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token');
    }
    const presented = auth.slice('Bearer '.length).trim();
    if (presented.length !== this.token.length || presented !== this.token) {
      this.logger.warn('Rejected MCP request with invalid bearer token');
      throw new UnauthorizedException('invalid bearer token');
    }
    return true;
  }
}
