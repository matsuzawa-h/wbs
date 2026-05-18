import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ExcelController } from './excel.controller';
import { ExcelService } from './excel.service';

@Module({
  imports: [DbModule],
  controllers: [ExcelController],
  providers: [ExcelService],
})
export class ExcelModule {}
