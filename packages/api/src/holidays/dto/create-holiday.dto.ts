import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateHolidayDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
  date!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}
