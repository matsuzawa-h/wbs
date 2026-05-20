import { IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsInt()
  customerId?: number | null;

  @IsOptional()
  @IsInt()
  organizationId?: number | null;
}
