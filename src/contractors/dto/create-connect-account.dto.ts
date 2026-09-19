import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, Matches } from 'class-validator';

export class CreateConnectAccountDto {
  @ApiPropertyOptional({
    example: 'CA',
    default: 'CA',
    description: 'ISO 3166-1 alpha-2 country of the contractor',
  })
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @Matches(/^[A-Z]{2}$/)
  country = 'CA';
}
