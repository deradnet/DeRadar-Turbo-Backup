import { Test, TestingModule } from '@nestjs/testing';
import { ArchiveController } from './archive.controller';
import { ArchiveService } from './archive.service';

describe('ArchiveController', () => {
  let controller: ArchiveController;
  const mockService = {
    uploadJson: jest.fn().mockResolvedValue('mock-upload-id'),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ArchiveController],
      providers: [
        {
          provide: ArchiveService,
          useValue: mockService,
        },
      ],
    }).compile();

    controller = module.get<ArchiveController>(ArchiveController);
  });

  it('should call service and return upload ID', async () => {
    const file: any = { originalname: 'file.json', buffer: Buffer.from('{}') };
    const result = await controller.uploadFile(file);
    expect(mockService.uploadJson).toHaveBeenCalledWith(file);
    expect(result).toBe('mock-upload-id');
  });
});
