import { Test, TestingModule } from '@nestjs/testing';
import { FlightDataModule } from './flight-data.module';
import { ConfigModule } from '@nestjs/config';

describe('FlightDataModule', () => {
  it('should compile without error', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true }), FlightDataModule],
    }).compile();

    expect(module).toBeDefined();
  });
});
