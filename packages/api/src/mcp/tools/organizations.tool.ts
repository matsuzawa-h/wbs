import { Injectable, Logger } from '@nestjs/common';
import { Tool } from '@rekog/mcp-nest';
import { z } from 'zod';
import { OrganizationsService } from '../../organizations/organizations.service';
import { IdParam } from '../schemas/common.schema';
import {
  CreateOrganizationSchema,
  UpdateOrganizationSchema,
} from '../schemas/organization.schema';

function asJson(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
}

@Injectable()
export class OrganizationsTool {
  private readonly logger = new Logger(OrganizationsTool.name);

  constructor(private readonly organizations: OrganizationsService) {}

  @Tool({
    name: 'organization_list',
    description:
      '組織マスタを一覧取得する（自己参照階層。parentId で親組織を表現）。',
    parameters: z.object({}),
  })
  list() {
    return asJson(this.organizations.list());
  }

  @Tool({
    name: 'organization_get',
    description: '指定 ID の組織を取得する。',
    parameters: IdParam,
  })
  get(input: z.infer<typeof IdParam>) {
    return asJson(this.organizations.findById(input.id));
  }

  @Tool({
    name: 'organization_create',
    description:
      '組織を新規作成する。code を省略すると O### で自動採番。parentId で親組織に紐付け可能。',
    parameters: CreateOrganizationSchema,
  })
  create(input: z.infer<typeof CreateOrganizationSchema>) {
    this.logger.log(`organization_create name="${input.name}"`);
    return asJson(this.organizations.create(input));
  }

  @Tool({
    name: 'organization_update',
    description:
      '組織を部分更新する。parentId 変更時は自分自身や子孫を親にできない（循環防止）。',
    parameters: UpdateOrganizationSchema,
  })
  update(input: z.infer<typeof UpdateOrganizationSchema>) {
    const { id, ...patch } = input;
    this.logger.log(`organization_update id=${id}`);
    return asJson(this.organizations.update(id, patch));
  }

  @Tool({
    name: 'organization_delete',
    description:
      '組織を削除する。子組織の parent_id および紐付く projects/assignees/customers.organization_id は NULL になる。',
    parameters: IdParam,
  })
  remove(input: z.infer<typeof IdParam>) {
    this.logger.warn(`organization_delete id=${input.id}`);
    this.organizations.remove(input.id);
    return asJson({ deleted: input.id });
  }
}
