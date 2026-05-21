import { IsIn, IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/** プロジェクトの状態（概要画面・一覧フィルタで使う）。 */
export const PROJECT_STATUSES = [
  'planning',
  'active',
  'on_hold',
  'completed',
  'cancelled',
] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsInt()
  organizationId?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(4000)
  description?: string | null;

  @IsOptional()
  @IsIn(PROJECT_STATUSES as unknown as string[])
  status?: ProjectStatus;
}
