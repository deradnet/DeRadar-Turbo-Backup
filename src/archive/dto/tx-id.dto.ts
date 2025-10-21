import { IsString, Matches, Length } from 'class-validator';

export class TxIdDto {
  @IsString({ message: 'Transaction ID must be a string' })
  @Length(43, 43, { message: 'Transaction ID must be exactly 43 characters' })
  @Matches(/^[a-zA-Z0-9_-]{43}$/, {
    message: 'Invalid Arweave transaction ID format',
  })
  txId: string;
}
