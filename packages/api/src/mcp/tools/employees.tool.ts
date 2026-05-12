import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { EmployeesService } from '../../employees/employees.service';
import { IdParam } from '../schemas/common.schema';
import {
  CreateEmployeeSchema,
  ListAssignmentsSchema,
  UpdateEmployeeSchema,
} from '../schemas/employee.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class EmployeesTool {
  private readonly logger = new Logger(EmployeesTool.name);

  constructor(private readonly employees: EmployeesService) {}

  @Tool({
    name: 'employee_list',
    description: '社員（担当者）マスタを一覧取得する。',
    parameters: z.object({}),
  })
  list() {
    return asJson(this.employees.list());
  }

  @Tool({
    name: 'employee_get',
    description: '指定 ID の社員を取得する。',
    parameters: IdParam,
  })
  get(input: z.infer<typeof IdParam>) {
    return asJson(this.employees.findById(input.id));
  }

  @Tool({
    name: 'employee_create',
    description:
      '社員を新規作成する。code を省略すると E### 形式で自動採番される。雇用期間日付は YYYY-MM-DD。',
    parameters: CreateEmployeeSchema,
  })
  create(input: z.infer<typeof CreateEmployeeSchema>) {
    this.logger.log(`employee_create name="${input.name}"`);
    return asJson(this.employees.create(input));
  }

  @Tool({
    name: 'employee_update',
    description: '社員情報を部分更新する。',
    parameters: UpdateEmployeeSchema,
  })
  update(input: z.infer<typeof UpdateEmployeeSchema>) {
    const { id, ...patch } = input;
    this.logger.log(`employee_update id=${id}`);
    return asJson(this.employees.update(id, patch));
  }

  @Tool({
    name: 'employee_delete',
    description: '社員を削除する。',
    parameters: IdParam,
  })
  remove(input: z.infer<typeof IdParam>) {
    this.logger.warn(`employee_delete id=${input.id}`);
    this.employees.remove(input.id);
    return asJson({ deleted: input.id });
  }

  @Tool({
    name: 'employee_list_assignments',
    description:
      '指定社員に割り当てられた level=3 タスクを全プロジェクト横断で取得する。from/to (YYYY-MM-DD) で startDate を範囲フィルタ可能。',
    parameters: ListAssignmentsSchema,
  })
  listAssignments(input: z.infer<typeof ListAssignmentsSchema>) {
    return asJson(
      this.employees.listAssignments(input.employeeId, input.from, input.to),
    );
  }
}
