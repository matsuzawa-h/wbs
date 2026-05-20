import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { SetMembersDto } from './dto/set-members.dto';
import { ProjectMembersService } from './project-members.service';
import { ProjectsService } from './projects.service';
import { parseOrgQuery } from '../customers/customers.controller';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projects: ProjectsService,
    private readonly members: ProjectMembersService,
  ) {}

  @Get()
  list(
    @Query('organizationId') organizationId?: string,
    @Query('memberEmployeeId') memberEmployeeId?: string,
  ) {
    const memberId =
      memberEmployeeId !== undefined && memberEmployeeId !== ''
        ? Number(memberEmployeeId)
        : undefined;
    return this.projects.list({
      organizationId: parseOrgQuery(organizationId),
      memberEmployeeId:
        memberId !== undefined && Number.isFinite(memberId) ? memberId : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.projects.findById(id);
  }

  @Post()
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProjectDto) {
    return this.projects.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): void {
    this.projects.remove(id);
  }

  @Get(':id/members')
  listMembers(@Param('id', ParseIntPipe) id: number) {
    return this.members.listMembers(id);
  }

  @Put(':id/members')
  setMembers(@Param('id', ParseIntPipe) id: number, @Body() dto: SetMembersDto) {
    return this.members.setMembers(id, dto.employeeIds);
  }
}
