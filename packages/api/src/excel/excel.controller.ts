import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExcelService } from './excel.service';

@Controller('projects')
export class ExcelController {
  constructor(private readonly excel: ExcelService) {}

  @Get(':id/export.xls')
  exportProject(@Param('id', ParseIntPipe) id: number, @Res() res: Response): void {
    const { buffer, filename } = this.excel.exportProject(id);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', buildContentDisposition(filename));
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }
}

// RFC 6266: include an ASCII fallback (for legacy clients) plus a UTF-8
// percent-encoded `filename*` so Japanese characters survive correctly in
// modern browsers (Chrome/Edge/Firefox/Safari).
function buildContentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
