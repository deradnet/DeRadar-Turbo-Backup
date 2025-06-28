import { Test, TestingModule } from '@nestjs/testing';
import { ArchiveModule } from './archive.module';

describe('ArchiveModule', () => {
  it('should compile without error', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [ArchiveModule],
    }).compile();

    expect(module).toBeDefined();
  });
});
