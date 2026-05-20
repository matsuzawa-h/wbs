import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

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
}
