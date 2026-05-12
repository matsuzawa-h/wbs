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
} from '@nestjs/common';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReorderTasksDto } from './dto/reorder-tasks.dto';
import { TasksService } from './tasks.service';

@Controller()
export class TasksController {
  constructor(private readonly tasks: TasksService) {}

  @Get('projects/:projectId/tasks')
  listByProject(@Param('projectId', ParseIntPipe) projectId: number) {
    return this.tasks.listByProject(projectId);
  }

  @Post('projects/:projectId/tasks')
  create(
    @Param('projectId', ParseIntPipe) projectId: number,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasks.create(projectId, dto);
  }

  @Get('tasks/:id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.tasks.findById(id);
  }

  @Patch('tasks/:id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateTaskDto) {
    return this.tasks.update(id, dto);
  }

  @Delete('tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): void {
    this.tasks.remove(id);
  }

  @Put('tasks/reorder')
  reorder(@Body() dto: ReorderTasksDto) {
    return this.tasks.reorder(dto);
  }
}
