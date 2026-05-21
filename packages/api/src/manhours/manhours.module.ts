import { Module } from '@nestjs/common';
import { ManhoursController } from './manhours.controller';
import { ManhoursService } from './manhours.service';
import { ManhourImportController } from './import/manhour-import.controller';
import { ManhourImportService } from './import/manhour-import.service';

@Module({
  controllers: [ManhoursController, ManhourImportController],
  providers: [ManhoursService, ManhourImportService],
  exports: [ManhoursService, ManhourImportService],
})
export class ManhoursModule {}
