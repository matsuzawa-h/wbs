import { Module } from '@nestjs/common';
import { PersonalTasksController } from './personal-tasks.controller';
import { PersonalTasksService } from './personal-tasks.service';

@Module({
  controllers: [PersonalTasksController],
  providers: [PersonalTasksService],
  exports: [PersonalTasksService],
})
export class PersonalTasksModule {}
