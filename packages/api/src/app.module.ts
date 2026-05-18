import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DbModule } from './db/db.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { PersonalTasksModule } from './personal-tasks/personal-tasks.module';
import { EmployeesModule } from './employees/employees.module';
import { HolidaysModule } from './holidays/holidays.module';
import { CustomersModule } from './customers/customers.module';
import { McpModule } from './mcp/mcp.module';
import { ExcelModule } from './excel/excel.module';
import { ExcelImportModule } from './excel/import/excel-import.module';
import { DownloadsModule } from './downloads/downloads.module';
import { HelpModule } from './help/help.module';

@Module({
  imports: [
    DbModule,
    HolidaysModule,
    ProjectsModule,
    TasksModule,
    PersonalTasksModule,
    EmployeesModule,
    CustomersModule,
    ExcelModule,
    ExcelImportModule,
    DownloadsModule,
    HelpModule,
    McpModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
