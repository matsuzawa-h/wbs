import { Module } from '@nestjs/common';
import { McpModule as RekogMcpModule, McpTransportType } from '@rekog/mcp-nest';
import { CustomersModule } from '../customers/customers.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { EmployeesModule } from '../employees/employees.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { McpAuthGuard } from './auth/mcp-auth.guard';
import { CustomersTool } from './tools/customers.tool';
import { ProjectsTool } from './tools/projects.tool';
import { TasksTool } from './tools/tasks.tool';
import { EmployeesTool } from './tools/employees.tool';
import { HolidaysTool } from './tools/holidays.tool';

@Module({
  imports: [
    CustomersModule,
    ProjectsModule,
    TasksModule,
    EmployeesModule,
    HolidaysModule,
    RekogMcpModule.forRoot({
      name: 'wbs-mcp',
      version: '0.1.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      mcpEndpoint: 'mcp',
      guards: [McpAuthGuard],
      streamableHttp: {
        statelessMode: true,
      },
    }),
  ],
  providers: [
    McpAuthGuard,
    CustomersTool,
    ProjectsTool,
    TasksTool,
    EmployeesTool,
    HolidaysTool,
  ],
})
export class McpModule {}
