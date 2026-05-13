import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import { Response } from 'express';
import { ExcelService } from './excel.service';

@Controller('projects')
export class ExcelController {
  constructor(private readonly excel: ExcelService) {}

  @Get(':id/export.xls')
  exportProject(@Param('id', ParseIntPipe) id: number, @Res() res: Response): void {
    const buffer = this.excel.exportProject(id);
    res.setHeader('Content-Type', 'application/vnd.ms-excel');
    res.setHeader('Content-Disposition', `attachment; filename=project-${id}.xls`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }
}
