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
} from '@nestjs/common';
import { CreatePersonalTaskDto } from './dto/create-personal-task.dto';
import { UpdatePersonalTaskDto } from './dto/update-personal-task.dto';
import { PersonalTasksService } from './personal-tasks.service';

@Controller()
export class PersonalTasksController {
  constructor(private readonly personal: PersonalTasksService) {}

  @Get('employees/:employeeId/personal-tasks')
  listByEmployee(@Param('employeeId', ParseIntPipe) employeeId: number) {
    return this.personal.listByEmployee(employeeId);
  }

  @Post('employees/:employeeId/personal-tasks')
  create(
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: CreatePersonalTaskDto,
  ) {
    return this.personal.create(employeeId, dto);
  }

  @Patch('personal-tasks/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdatePersonalTaskDto,
  ) {
    return this.personal.update(id, dto);
  }

  @Delete('personal-tasks/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): void {
    this.personal.remove(id);
  }
}
