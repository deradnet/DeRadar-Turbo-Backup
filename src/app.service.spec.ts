import { Test, TestingModule } from '@nestjs/testing';
import { AppService } from './app.service';

describe('AppService', () => {
  let service: AppService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AppService],
    }).compile();

    service = module.get<AppService>(AppService);
  });

  it('should return "Derad Flight Server API"', () => {
    expect(service.getHello()).toBe('Derad Flight Server API');
  });
  it('should return "Derad Flight Server API is running"', () => {
    expect(service.healthCheck()).toBe('OK');
  });
});
