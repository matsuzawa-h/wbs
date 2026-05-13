import { Controller, Get, NotFoundException, Res } from '@nestjs/common';
import { Response } from 'express';
import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';

@Controller('downloads')
export class DownloadsController {
  @Get('km_module.xla')
  downloadKmModule(@Res() res: Response): void {
    const path = this.resolveAddinPath();
    const stat = statSync(path);
    const buffer = readFileSync(path);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', 'attachment; filename="km_module.xla"');
    res.setHeader('Content-Length', String(stat.size));
    res.send(buffer);
  }

  // Same path-resolution pattern as the template lookup in excel.service.ts:
  // honour XLA_ADDIN_PATH first, then walk up from cwd, then from __dirname.
  private resolveAddinPath(): string {
    const candidates = [
      process.env.XLA_ADDIN_PATH,
      resolve(process.cwd(), 'addins', 'km_module.xla'),
      resolve(process.cwd(), '..', 'addins', 'km_module.xla'),
      resolve(process.cwd(), '..', '..', '..', 'AddIns', 'km_module.xla'),
      resolve(__dirname, '..', '..', '..', '..', '..', 'AddIns', 'km_module.xla'),
    ].filter((value): value is string => Boolean(value));

    const found = candidates.find((c) => existsSync(c));
    if (!found) {
      throw new NotFoundException(
        `km_module.xla not found. Tried: ${candidates.join(', ')}`,
      );
    }
    return found;
  }
}
