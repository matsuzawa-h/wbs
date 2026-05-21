import { Module } from '@nestjs/common';
import { McpModule as RekogMcpModule, McpTransportType } from '@rekog/mcp-nest';
import { CustomersModule } from '../customers/customers.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { PersonalTasksModule } from '../personal-tasks/personal-tasks.module';
import { EmployeesModule } from '../employees/employees.module';
import { HolidaysModule } from '../holidays/holidays.module';
import { ManhoursModule } from '../manhours/manhours.module';
// TODO(auth): MCP は現状無認証で動作させる方針（社内 LAN 前提、Web API も同様に
//   無認証）。将来、認証を導入する際は Web API と MCP の両方を同じ仕組みで保護する。
//   そのときに以下の McpAuthGuard を再有効化し、`MCP_TOKEN` 環境変数の必須化を戻す。
//   詳細は docs/release.html の「セキュリティ方針」セクション参照。
// import { McpAuthGuard } from './auth/mcp-auth.guard';
import { CustomersTool } from './tools/customers.tool';
import { ProjectsTool } from './tools/projects.tool';
import { TasksTool } from './tools/tasks.tool';
import { PersonalTasksTool } from './tools/personal-tasks.tool';
import { EmployeesTool } from './tools/employees.tool';
import { HolidaysTool } from './tools/holidays.tool';
import { ManhoursTool } from './tools/manhours.tool';

@Module({
  imports: [
    CustomersModule,
    ProjectsModule,
    TasksModule,
    PersonalTasksModule,
    EmployeesModule,
    HolidaysModule,
    ManhoursModule,
    RekogMcpModule.forRoot({
      name: 'wbs-mcp',
      version: '0.1.0',
      transport: McpTransportType.STREAMABLE_HTTP,
      mcpEndpoint: 'mcp',
      // TODO(auth): 認証導入時はここに guards: [McpAuthGuard] を戻す。
      // guards: [McpAuthGuard],
      streamableHttp: {
        statelessMode: true,
      },
    }),
  ],
  providers: [
    // TODO(auth): 認証導入時はここに McpAuthGuard を戻す。
    // McpAuthGuard,
    CustomersTool,
    ProjectsTool,
    TasksTool,
    PersonalTasksTool,
    EmployeesTool,
    HolidaysTool,
    ManhoursTool,
  ],
})
export class McpModule {}
