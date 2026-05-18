import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';

const IMG_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

/**
 * Serves the in-repo operation manual (docs/manual.html + docs/screenshots/*)
 * so it can be embedded inside the app. docs/manual.html stays the single
 * source of truth — no duplicated copy. Same resilient path-resolution
 * approach as DownloadsController (cwd / __dirname walk-up, env override).
 */
@Controller('help')
export class HelpController {
  @Get('manual.html')
  manual(@Res() res: Response): void {
    const html = readFileSync(this.resolveDocsPath(['manual.html']));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  }

  @Get('screenshots/:name')
  screenshot(@Param('name') name: string, @Res() res: Response): void {
    if (!/^[A-Za-z0-9_.-]+\.(png|jpe?g|gif|webp|svg)$/i.test(name)) {
      throw new NotFoundException('invalid screenshot name');
    }
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const buf = readFileSync(this.resolveDocsPath(['screenshots', name]));
    res.setHeader('Content-Type', IMG_MIME[ext] ?? 'application/octet-stream');
    res.send(buf);
  }

  private resolveDocsPath(parts: string[]): string {
    const bases = [
      process.env.MANUAL_DOCS_DIR,
      resolve(process.cwd(), 'docs'),
      resolve(process.cwd(), '..', '..', 'docs'),
      resolve(__dirname, '..', '..', '..', 'docs'),
      resolve(__dirname, '..', '..', '..', '..', 'docs'),
      resolve(__dirname, '..', '..', '..', '..', '..', 'docs'),
    ].filter((v): v is string => Boolean(v));

    const candidates = bases.map((b) => resolve(b, ...parts));
    const found = candidates.find((c) => existsSync(c));
    if (!found) {
      throw new NotFoundException(
        `docs file not found: ${parts.join('/')} (tried: ${candidates.join(', ')})`,
      );
    }
    return found;
  }
}
