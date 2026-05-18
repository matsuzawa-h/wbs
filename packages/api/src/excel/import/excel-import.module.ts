import { Module } from '@nestjs/common';
import { TasksModule } from '../../tasks/tasks.module';
import { ExcelImportController } from './excel-import.controller';
import { ExcelImportService } from './excel-import.service';

@Module({
  imports: [TasksModule],
  controllers: [ExcelImportController],
  providers: [ExcelImportService],
  exports: [ExcelImportService],
})
export class ExcelImportModule {}
