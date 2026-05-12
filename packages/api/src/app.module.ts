import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DbModule } from './db/db.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { EmployeesModule } from './employees/employees.module';
import { HolidaysModule } from './holidays/holidays.module';

@Module({
  imports: [DbModule, HolidaysModule, ProjectsModule, TasksModule, EmployeesModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
