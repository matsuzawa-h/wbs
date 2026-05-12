import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { DbModule } from './db/db.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [DbModule, ProjectsModule],
  controllers: [HealthController],
  providers: [],
})
export class AppModule {}
