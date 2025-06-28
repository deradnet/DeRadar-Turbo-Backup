import { Test, TestingModule } from '@nestjs/testing';
import { FlightDataService } from './flight-data.service';
import { HttpService } from '@nestjs/axios';
import { ArchiveService } from '../archive/archive.service';
import { ConfigService } from '@nestjs/config';
import { of } from 'rxjs';

describe('FlightDataService', () => {
  let service: FlightDataService;

  const mockHttpService = {
    get: jest.fn(),
  };

  const mockArchiveService = {
    uploadJson: jest.fn().mockResolvedValue('mock-tx-id'),
  };

  const mockConfigService = {
    get: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    mockConfigService.get.mockReturnValue([
      {
        id: 'antenna-1',
        url: 'http://localhost:9999/data.json',
        enabled: true,
      },
      {
        id: 'antenna-2',
        url: 'http://localhost:8888/data.json',
        enabled: false,
      },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FlightDataService,
        { provide: HttpService, useValue: mockHttpService },
        { provide: ArchiveService, useValue: mockArchiveService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<FlightDataService>(FlightDataService);
  });

  it('should fetch aircraft data and upload if aircraft exist', async () => {
    mockHttpService.get.mockReturnValue(
      of({
        data: {
          now: Date.now(),
          messages: 5,
          aircraft: [{ hex: 'abc123', alt_baro: 35000 }],
        },
      }),
    );

    await service.fetchAircraftData();

    expect(mockHttpService.get).toHaveBeenCalledWith(
      'http://localhost:9999/data.json',
    );
    expect(mockArchiveService.uploadJson).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'antenna-1',
        aircraft: expect.any(Array),
      }),
    );
  });

  it('should skip upload if aircraft list is empty', async () => {
    mockHttpService.get.mockReturnValue(
      of({
        data: {
          now: Date.now(),
          messages: 5,
          aircraft: [],
        },
      }),
    );

    await service.fetchAircraftData();

    expect(mockArchiveService.uploadJson).not.toHaveBeenCalled();
  });

  it('should skip disabled antenna', async () => {
    mockConfigService.get.mockReturnValueOnce([
      {
        id: 'antenna-1',
        url: 'http://localhost:9999/data.json',
        enabled: false,
      },
    ]);

    await service.fetchAircraftData();

    expect(mockArchiveService.uploadJson).not.toHaveBeenCalled();
  });
});
