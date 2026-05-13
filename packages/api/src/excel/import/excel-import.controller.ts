import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CommitImportDto } from './dto/commit-import.dto';
import { ExcelImportService } from './excel-import.service';

// Minimal type to avoid pulling in @types/multer. Mirrors the runtime shape
// of multer's UploadedFile that we actually use.
interface UploadedXlsFile {
  buffer: Buffer;
  originalname: string;
  size: number;
  mimetype: string;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

@Controller('projects/import')
export class ExcelImportController {
  constructor(private readonly importService: ExcelImportService) {}

  @Post('preview')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  preview(@UploadedFile() file: UploadedXlsFile | undefined) {
    if (!file) {
      throw new BadRequestException('file パラメータが必要です');
    }
    return this.importService.preview(file.buffer);
  }

  @Post('commit')
  commit(@Body() dto: CommitImportDto) {
    return this.importService.commit(dto);
  }
}
