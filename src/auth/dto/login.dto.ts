import { IsString, MinLength, MaxLength, Matches } from 'class-validator';

export class LoginDto {
  @IsString({ message: 'Username must be a string' })
  @MinLength(3, { message: 'Username must be at least 3 characters long' })
  @MaxLength(10, { message: 'Username must not exceed 10 characters' })
  @Matches(/^[a-zA-Z0-9]+$/, {
    message: 'Username can only contain letters and numbers',
  })
  username: string;

  @IsString({ message: 'Password must be a string' })
  @MinLength(3, { message: 'Password must be at least 3 characters long' })
  @MaxLength(100, { message: 'Password must not exceed 100 characters' })
  @Matches(/^[^'";<>\\]+$/, {
    message: 'Password contains invalid characters',
  })
  password: string;
}
