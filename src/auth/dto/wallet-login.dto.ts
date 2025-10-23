import { IsString, IsNotEmpty, Matches } from 'class-validator';

export class WalletLoginDto {
  @IsString({ message: 'Wallet address must be a string' })
  @IsNotEmpty({ message: 'Wallet address is required' })
  @Matches(/^[a-zA-Z0-9_-]{43}$/, {
    message: 'Invalid Arweave wallet address format',
  })
  walletAddress: string;

  @IsString({ message: 'Signature must be a string' })
  @IsNotEmpty({ message: 'Signature is required' })
  signature: string;

  @IsString({ message: 'Nonce must be a string' })
  @IsNotEmpty({ message: 'Nonce is required' })
  nonce: string;
}
