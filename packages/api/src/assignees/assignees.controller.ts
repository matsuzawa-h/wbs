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
import { AssigneesService } from './assignees.service';
import { CreateAssigneeDto } from './dto/create-assignee.dto';
import { UpdateAssigneeDto } from './dto/update-assignee.dto';

@Controller('assignees')
export class AssigneesController {
  constructor(private readonly assignees: AssigneesService) {}

  @Get()
  list() {
    return this.assignees.list();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.assignees.findById(id);
  }

  @Post()
  create(@Body() dto: CreateAssigneeDto) {
    return this.assignees.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAssigneeDto) {
    return this.assignees.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): void {
    this.assignees.remove(id);
  }
}
