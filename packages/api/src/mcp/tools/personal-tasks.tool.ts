import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { PersonalTasksService } from '../../personal-tasks/personal-tasks.service';
import { EmployeeIdParam, IdParam } from '../schemas/common.schema';
import {
  CreatePersonalTaskSchema,
  UpdatePersonalTaskSchema,
} from '../schemas/personal-task.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class PersonalTasksTool {
  private readonly logger = new Logger(PersonalTasksTool.name);

  constructor(private readonly personal: PersonalTasksService) {}

  @Tool({
    name: 'personal_task_list_by_employee',
    description:
      '指定社員の個人タスク（プロジェクトのガント/Excel には出ない、担当者専用タスク）を一覧取得する。startDate 昇順。',
    parameters: EmployeeIdParam,
  })
  list(input: z.infer<typeof EmployeeIdParam>) {
    return asJson(this.personal.listByEmployee(input.employeeId));
  }

  @Tool({
    name: 'personal_task_create',
    description:
      '個人タスクを新規作成する。projectId は任意（紐づけ可、未指定可）。日付は YYYY-MM-DD。startDate と duration があれば endDate は土日休日をスキップして自動計算。プロジェクトのガント/WBS/Excel には一切表示されない。',
    parameters: CreatePersonalTaskSchema,
  })
  create(input: z.infer<typeof CreatePersonalTaskSchema>) {
    const { employeeId, ...dto } = input;
    this.logger.log(`personal_task_create employeeId=${employeeId}`);
    return asJson(this.personal.create(employeeId, dto));
  }

  @Tool({
    name: 'personal_task_update',
    description:
      '個人タスクを部分更新する。projectId に null を渡すと紐づけ解除。日付は YYYY-MM-DD。startDate/duration 変更時は endDate を再計算。',
    parameters: UpdatePersonalTaskSchema,
  })
  update(input: z.infer<typeof UpdatePersonalTaskSchema>) {
    const { id, ...dto } = input;
    this.logger.log(`personal_task_update id=${id}`);
    return asJson(this.personal.update(id, dto));
  }

  @Tool({
    name: 'personal_task_delete',
    description: '個人タスクを削除する。',
    parameters: IdParam,
  })
  remove(input: z.infer<typeof IdParam>) {
    this.logger.warn(`personal_task_delete id=${input.id}`);
    this.personal.remove(input.id);
    return asJson({ deleted: input.id });
  }
}
