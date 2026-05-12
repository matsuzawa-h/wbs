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
import { HolidaysService } from './holidays.service';
import { CreateHolidayDto } from './dto/create-holiday.dto';
import { UpdateHolidayDto } from './dto/update-holiday.dto';
import { BulkHolidaysDto } from './dto/bulk-holidays.dto';

@Controller('holidays')
export class HolidaysController {
  constructor(private readonly svc: HolidaysService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Post()
  create(@Body() dto: CreateHolidayDto) {
    return this.svc.create(dto);
  }

  @Post('bulk')
  bulkCreate(@Body() dto: BulkHolidaysDto) {
    return this.svc.bulkCreate(dto.items);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHolidayDto) {
    return this.svc.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): void {
    this.svc.remove(id);
  }
}
