import { Test, TestingModule } from '@nestjs/testing';
import { SystemService } from './system.service';
import * as si from 'systeminformation';

const mockCurrentLoad = {
  currentLoad: 42.5,
  cpus: [{ load: 40.1 }, { load: 45.0 }],
};

const mockMem = {
  total: 8 * 1024 * 1024 * 1024,
  available: 4 * 1024 * 1024 * 1024,
  active: 3.5 * 1024 * 1024 * 1024,
  swaptotal: 2 * 1024 * 1024 * 1024,
  swapfree: 1 * 1024 * 1024 * 1024,
};

jest.mock('systeminformation', () => ({
  currentLoad: jest.fn(),
  mem: jest.fn(),
}));

jest.mock('os', () => ({
  cpus: () => [{ model: 'Mock CPU 1' }, { model: 'Mock CPU 2' }],
  uptime: () => 3600,
  type: () => 'Linux',
  hostname: () => 'mock-host',
  arch: () => 'x86_64',
  loadavg: () => [1.23, 0.98, 0.75],
}));

describe('SystemService', () => {
  let service: SystemService;

  beforeAll(() => {
    (si.currentLoad as jest.Mock).mockResolvedValue(mockCurrentLoad);
    (si.mem as jest.Mock).mockResolvedValue(mockMem);
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SystemService],
    }).compile();

    service = module.get<SystemService>(SystemService);
  });

  it('should return structured system info', async () => {
    const data = await service.getSystemInfo();

    expect(data.system).toEqual({
      type: 'Linux',
      name: 'mock-host',
      machine: 'x86_64',
      processor: 'Mock CPU 1',
    });

    expect(data.cpu.total_usage).toBe(42.5);
    expect(data.cpu.usages.length).toBe(2);

    expect(data.memory.swap.total).toContain('2.00 G');
    expect(typeof data.boot.uptime.seconds).toBe('number');
  });
});
