import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsInt, IsString, IsUUID, Matches, Max, Min } from 'class-validator';

export class CreatePaymentIntentDto {
  @ApiProperty({ example: '93b1d465-7ed7-4fd0-b734-e092c7f2c67e' })
  @IsUUID('4')
  orderId!: string;

  @ApiProperty({ example: 'f91f5ea2-9481-4ea7-952f-dc5f6792766e' })
  @IsUUID('4')
  contractorId!: string;

  @ApiProperty({
    example: 25000,
    description: 'Amount in the smallest currency unit (for example, cents)',
  })
  @Type(() => Number)
  @IsInt()
  @Min(50)
  @Max(99_999_999)
  amount!: number;

  @ApiProperty({ example: 'cad' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsString()
  @Matches(/^[a-z]{3}$/)
  currency!: string;
}
