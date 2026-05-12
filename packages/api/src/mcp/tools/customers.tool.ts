import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { CustomersService } from '../../customers/customers.service';
import { IdParam } from '../schemas/common.schema';
import {
  CreateCustomerSchema,
  UpdateCustomerSchema,
} from '../schemas/customer.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class CustomersTool {
  private readonly logger = new Logger(CustomersTool.name);

  constructor(private readonly customers: CustomersService) {}

  @Tool({
    name: 'customer_list',
    description: '顧客マスタを一覧取得する。',
    parameters: z.object({}),
  })
  list() {
    return asJson(this.customers.list());
  }

  @Tool({
    name: 'customer_get',
    description: '指定 ID の顧客を取得する。',
    parameters: IdParam,
  })
  get(input: z.infer<typeof IdParam>) {
    return asJson(this.customers.findById(input.id));
  }

  @Tool({
    name: 'customer_create',
    description:
      '顧客を新規作成する。code を省略すると C### 形式で自動採番される。',
    parameters: CreateCustomerSchema,
  })
  create(input: z.infer<typeof CreateCustomerSchema>) {
    this.logger.log(`customer_create name="${input.name}"`);
    return asJson(this.customers.create(input));
  }

  @Tool({
    name: 'customer_update',
    description: '顧客情報を部分更新する。指定されたフィールドのみ更新する。',
    parameters: UpdateCustomerSchema,
  })
  update(input: z.infer<typeof UpdateCustomerSchema>) {
    const { id, ...patch } = input;
    this.logger.log(`customer_update id=${id}`);
    return asJson(this.customers.update(id, patch));
  }

  @Tool({
    name: 'customer_delete',
    description:
      '顧客を削除する。紐付くプロジェクトの customer_id は NULL になる（DB スキーマ依存）。',
    parameters: IdParam,
  })
  remove(input: z.infer<typeof IdParam>) {
    this.logger.warn(`customer_delete id=${input.id}`);
    this.customers.remove(input.id);
    return asJson({ deleted: input.id });
  }
}
