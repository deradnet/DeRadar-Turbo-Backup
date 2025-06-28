import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SystemService } from './system.service';

describe('AppController', () => {
  let appController: AppController;

  const mockAppService = {
    getHello: jest.fn().mockReturnValue('Derad Flight Server API'),
    healthCheck: jest.fn().mockReturnValue('OK'),
  };

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: mockAppService,
        },
        {
          provide: SystemService,
          useValue: {
            getSystemInfo: jest.fn().mockReturnValue({}),
          },
        },
      ],
    }).compile();

    appController = moduleRef.get<AppController>(AppController);
  });

  it('should return "Hello World!" from getHello()', () => {
    expect(appController.getHello()).toBe('Derad Flight Server API');
    expect(mockAppService.getHello).toHaveBeenCalled();
  });

  it('should return "OK" from healthCheck()', () => {
    expect(appController.healthCheck()).toBe('OK');
    expect(mockAppService.healthCheck).toHaveBeenCalled();
  });
});
