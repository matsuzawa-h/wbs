import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { ProjectsService } from '../../projects/projects.service';
import { ProjectMembersService } from '../../projects/project-members.service';
import { IdParam, ProjectIdParam } from '../schemas/common.schema';
import {
  CreateProjectSchema,
  SetMembersSchema,
  UpdateProjectSchema,
} from '../schemas/project.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class ProjectsTool {
  private readonly logger = new Logger(ProjectsTool.name);

  constructor(
    private readonly projects: ProjectsService,
    private readonly members: ProjectMembersService,
  ) {}

  @Tool({
    name: 'project_list',
    description: 'WBS プロジェクトを一覧取得する（顧客名を含む）。',
    parameters: z.object({}),
  })
  list() {
    return asJson(this.projects.list());
  }

  @Tool({
    name: 'project_get',
    description: '指定 ID のプロジェクトを取得する。',
    parameters: IdParam,
  })
  get(input: z.infer<typeof IdParam>) {
    return asJson(this.projects.findById(input.id));
  }

  @Tool({
    name: 'project_create',
    description:
      'プロジェクトを新規作成する。customerId を指定すると既存顧客に紐付く（先に customer_list で ID を取得すること）。',
    parameters: CreateProjectSchema,
  })
  create(input: z.infer<typeof CreateProjectSchema>) {
    this.logger.log(`project_create name="${input.name}" customerId=${input.customerId ?? 'null'}`);
    return asJson(this.projects.create(input));
  }

  @Tool({
    name: 'project_update',
    description: 'プロジェクトを部分更新する（name または customerId）。',
    parameters: UpdateProjectSchema,
  })
  update(input: z.infer<typeof UpdateProjectSchema>) {
    const { id, ...patch } = input;
    this.logger.log(`project_update id=${id}`);
    return asJson(this.projects.update(id, patch));
  }

  @Tool({
    name: 'project_delete',
    description: 'プロジェクトを削除する（配下の全タスク・メンバーもカスケード削除される）。',
    parameters: IdParam,
  })
  remove(input: z.infer<typeof IdParam>) {
    this.logger.warn(`project_delete id=${input.id}`);
    this.projects.remove(input.id);
    return asJson({ deleted: input.id });
  }

  @Tool({
    name: 'project_members_list',
    description: '指定プロジェクトに割り当てられた社員（メンバー）一覧を取得する。',
    parameters: ProjectIdParam,
  })
  listMembers(input: z.infer<typeof ProjectIdParam>) {
    return asJson(this.members.listMembers(input.projectId));
  }

  @Tool({
    name: 'project_members_set',
    description:
      'プロジェクトのメンバーを完全に置き換える（差分ではなく全置換）。配列の順序が表示順になる。',
    parameters: SetMembersSchema,
  })
  setMembers(input: z.infer<typeof SetMembersSchema>) {
    this.logger.log(
      `project_members_set projectId=${input.projectId} count=${input.employeeIds.length}`,
    );
    return asJson(this.members.setMembers(input.projectId, input.employeeIds));
  }
}
