import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { DateCascadeService } from './date-cascade.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService, DateCascadeService],
  exports: [TasksService, DateCascadeService],
})
export class TasksModule {}
