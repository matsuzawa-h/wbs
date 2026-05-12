import { Module } from '@nestjs/common';
import { ProjectMembersService } from './project-members.service';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService, ProjectMembersService],
  exports: [ProjectsService, ProjectMembersService],
})
export class ProjectsModule {}
