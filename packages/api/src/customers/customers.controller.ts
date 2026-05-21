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
  Query,
} from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  list(@Query('organizationId') organizationId?: string) {
    return this.customers.list(parseOrgQuery(organizationId));
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customers.findById(id);
  }

  @Post()
  create(@Body() dto: CreateCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerDto) {
    return this.customers.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id', ParseIntPipe) id: number): void {
    this.customers.remove(id);
  }
}

// 'null'/'' → null (=未設定で絞込) / 数値 → number / undefined/その他 → undefined (=絞込なし)
export function parseOrgQuery(v: string | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === '' || v === 'null') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
