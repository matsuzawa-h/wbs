import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { TasksService } from '../../tasks/tasks.service';
import { IdParam, ProjectIdParam } from '../schemas/common.schema';
import {
  CreateTaskSchema,
  ReorderTasksSchema,
  UpdateTaskSchema,
} from '../schemas/task.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class TasksTool {
  private readonly logger = new Logger(TasksTool.name);

  constructor(private readonly tasks: TasksService) {}

  @Tool({
    name: 'task_list_by_project',
    description: '指定プロジェクトの全 WBS タスクを sortOrder 昇順で取得する。',
    parameters: ProjectIdParam,
  })
  list(input: z.infer<typeof ProjectIdParam>) {
    return asJson(this.tasks.listByProject(input.projectId));
  }

  @Tool({
    name: 'task_get',
    description: '指定 ID のタスクを取得する。',
    parameters: IdParam,
  })
  get(input: z.infer<typeof IdParam>) {
    return asJson(this.tasks.findById(input.id));
  }

  @Tool({
    name: 'task_create',
    description:
      'WBS タスクを新規作成する。level=1 (大項目) は parentId=null、level=2 (中項目) は level=1 の親、level=3 (小項目) は level=2 の親が必要。日付は全て YYYY-MM-DD。startDate と duration を指定すると endDate は土日休日をスキップして自動計算される（level=3 のみ）。',
    parameters: CreateTaskSchema,
  })
  create(input: z.infer<typeof CreateTaskSchema>) {
    const { projectId, ...dto } = input;
    this.logger.log(`task_create projectId=${projectId} level=${dto.level} name="${dto.name}"`);
    return asJson(this.tasks.create(projectId, dto));
  }

  @Tool({
    name: 'task_update',
    description:
      'タスクを部分更新する。日付は全て YYYY-MM-DD。level=3 タスクの endDate 変更時はデフォルトで後続兄弟タスクがシフト（カスケード）される。cascade=false を渡すとそのタスクのみ更新し兄弟は動かない。level=1/2 (集計行) には startDate/duration/actual* を直接設定不可。',
    parameters: UpdateTaskSchema,
  })
  update(input: z.infer<typeof UpdateTaskSchema>) {
    const { id, ...patch } = input;
    this.logger.log(`task_update id=${id}`);
    return asJson(this.tasks.update(id, patch));
  }

  @Tool({
    name: 'task_delete',
    description: 'タスクを削除する。子タスクがある場合はカスケード削除される。',
    parameters: IdParam,
  })
  remove(input: z.infer<typeof IdParam>) {
    this.logger.warn(`task_delete id=${input.id}`);
    this.tasks.remove(input.id);
    return asJson({ deleted: input.id });
  }

  @Tool({
    name: 'task_reorder',
    description:
      'タスクの並び順を一括更新する。items の各要素は {id, sortOrder} のペア。最大 200 件まで。',
    parameters: ReorderTasksSchema,
  })
  reorder(input: z.infer<typeof ReorderTasksSchema>) {
    this.logger.log(`task_reorder count=${input.items.length}`);
    return asJson(this.tasks.reorder(input));
  }

  @Tool({
    name: 'task_duplicate',
    description:
      '指定タスクとその配下（子孫）をまるごと複製する。複製は元の直後に同じ親・同じ階層で挿入され、進捗・実績も含めて全フィールドをコピーする。新しいルートタスクを返す。',
    parameters: IdParam,
  })
  duplicate(input: z.infer<typeof IdParam>) {
    this.logger.log(`task_duplicate id=${input.id}`);
    return asJson(this.tasks.duplicate(input.id));
  }
}
