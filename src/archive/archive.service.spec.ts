import { ArchiveService } from './archive.service';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('fs');
jest.mock('path');
jest.mock('os');
jest.mock('@ardrive/turbo-sdk', () => ({
  TurboFactory: {
    authenticated: jest.fn().mockReturnValue({
      uploadFile: jest.fn().mockResolvedValue({ id: 'mock-upload-id' }),
    }),
  },
}));

describe('ArchiveService', () => {
  let service: ArchiveService;

  beforeEach(() => {
    service = new ArchiveService(
      {} as any, // Mock repository
    );
  });

  it('should write file, upload via turbo, then delete file', async () => {
    const mockJson = { foo: 'bar' };
    const mockPath = '/tmp/aircraft.json';

    (os.tmpdir as jest.Mock).mockReturnValue('/tmp');
    (path.join as jest.Mock).mockReturnValue(mockPath);
    (fs.statSync as jest.Mock).mockReturnValue({ size: 1234 });

    const unlinkSpy = jest.spyOn(fs, 'unlinkSync');

    const id = await service.uploadJson(mockJson);

    expect(id).toBe('mock-upload-id');
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      mockPath,
      JSON.stringify(mockJson, null, 2),
      'utf-8',
    );
    expect(unlinkSpy).toHaveBeenCalledWith(mockPath);
  });
});
