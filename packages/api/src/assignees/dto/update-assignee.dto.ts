import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateAssigneeDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
