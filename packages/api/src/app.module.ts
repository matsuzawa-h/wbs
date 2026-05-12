import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DbModule } from './db/db.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { AssigneesModule } from './assignees/assignees.module';

@Module({
  imports: [DbModule, ProjectsModule, TasksModule, AssigneesModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
