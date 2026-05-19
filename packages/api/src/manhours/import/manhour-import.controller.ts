import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CommitManhourImportDto } from './dto/commit-import.dto';
import { PreviewImportDto } from './dto/preview-import.dto';
import { ManhourImportService } from './manhour-import.service';

// @types/multer を持ち込まないための最小型（excel 取込と同じ方針）。
interface UploadedCsvFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller('manhours/import')
export class ManhourImportController {
  constructor(private readonly importService: ManhourImportService) {}

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  preview(
    @UploadedFile() file: UploadedCsvFile | undefined,
    @Body() dto: PreviewImportDto,
  ) {
    if (!file) {
      throw new BadRequestException('file パラメータが必要です');
    }
    return this.importService.preview(file.buffer, dto.fiscalYear);
  }

  @Post('commit')
  commit(@Body() dto: CommitManhourImportDto) {
    return this.importService.commit(dto);
  }
}
