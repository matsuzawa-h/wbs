import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DbModule } from './db/db.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';
import { EmployeesModule } from './employees/employees.module';
import { HolidaysModule } from './holidays/holidays.module';
import { CustomersModule } from './customers/customers.module';
import { McpModule } from './mcp/mcp.module';
import { ExcelModule } from './excel/excel.module';
import { ExcelImportModule } from './excel/import/excel-import.module';

@Module({
  imports: [
    DbModule,
    HolidaysModule,
    ProjectsModule,
    TasksModule,
    EmployeesModule,
    CustomersModule,
    ExcelModule,
    ExcelImportModule,
    McpModule,
  ],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
