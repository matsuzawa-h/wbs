import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { HolidaysService } from '../../holidays/holidays.service';
import { IdParam } from '../schemas/common.schema';
import {
  BulkHolidaysSchema,
  CreateHolidaySchema,
  UpdateHolidaySchema,
} from '../schemas/holiday.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class HolidaysTool {
  private readonly logger = new Logger(HolidaysTool.name);

  constructor(private readonly holidays: HolidaysService) {}

  @Tool({
    name: 'holiday_list',
    description: '登録済みの休日を全件取得する（日付昇順）。',
    parameters: z.object({}),
  })
  list() {
    return asJson(this.holidays.list());
  }

  @Tool({
    name: 'holiday_create',
    description:
      '休日を 1 件登録する。日付は YYYY-MM-DD。同じ日付が既に存在する場合は ConflictException。',
    parameters: CreateHolidaySchema,
  })
  create(input: z.infer<typeof CreateHolidaySchema>) {
    this.logger.log(`holiday_create date=${input.date}`);
    return asJson(this.holidays.create(input));
  }

  @Tool({
    name: 'holiday_bulk_create',
    description:
      '休日を一括登録する。既存日付はスキップされる。最大 500 件まで。{inserted, skipped} を返す。',
    parameters: BulkHolidaysSchema,
  })
  bulkCreate(input: z.infer<typeof BulkHolidaysSchema>) {
    this.logger.log(`holiday_bulk_create count=${input.items.length}`);
    return asJson(this.holidays.bulkCreate(input.items));
  }

  @Tool({
    name: 'holiday_update',
    description: '休日を部分更新する（date または name）。',
    parameters: UpdateHolidaySchema,
  })
  update(input: z.infer<typeof UpdateHolidaySchema>) {
    const { id, ...patch } = input;
    this.logger.log(`holiday_update id=${id}`);
    return asJson(this.holidays.update(id, patch));
  }

  @Tool({
    name: 'holiday_delete',
    description: '休日を削除する。',
    parameters: IdParam,
  })
  remove(input: z.infer<typeof IdParam>) {
    this.logger.warn(`holiday_delete id=${input.id}`);
    this.holidays.remove(input.id);
    return asJson({ deleted: input.id });
  }
}
