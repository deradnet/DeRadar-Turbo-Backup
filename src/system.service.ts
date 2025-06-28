import { Injectable } from '@nestjs/common';
import * as os from 'os';
import * as si from 'systeminformation';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SystemService {
  constructor(private readonly config: ConfigService) {}

  private getSize(bytes: number, suffix = 'B') {
    const factor = 1024;
    const units = ['', 'K', 'M', 'G', 'T', 'P'];
    let i = 0;
    while (bytes >= factor && i < units.length - 1) {
      bytes /= factor;
      i++;
    }
    return `${bytes.toFixed(2)} ${units[i]}${suffix}`;
  }

  async getSystemInfo() {
    const cpus = os.cpus();
    const uptimeSec = os.uptime();
    const now = new Date();
    const bootTime = new Date(Date.now() - uptimeSec * 1000);

    const system = {
      type: os.type(),
      name: os.hostname(),
      machine: os.arch(),
      processor: cpus?.[0]?.model || 'Unknown',
    };

    const boot = {
      system: now.toISOString(),
      time: `${bootTime.getFullYear()}-${bootTime.getMonth() + 1}-${bootTime.getDate()} ${bootTime.getHours()}:${bootTime.getMinutes()}:${bootTime.getSeconds()}`,
      uptime: {
        days: Math.floor(uptimeSec / 86400),
        hours: Math.floor((uptimeSec % 86400) / 3600),
        minutes: Math.floor((uptimeSec % 3600) / 60),
        seconds: Math.floor(uptimeSec % 60),
      },
    };

    const cpuLoad = await si.currentLoad();

    const cpu = {
      count: os.cpus().length,
      virtual_count: os.cpus().length,
      usages: cpuLoad.cpus.map((c) => c.load),
      total_usage: cpuLoad.currentLoad,
      load_avg: os.loadavg(),
    };

    const memInfo = await si.mem();

    const memory = {
      total: this.getSize(memInfo.total),
      available: this.getSize(memInfo.available),
      used: this.getSize(memInfo.active),
      percentage: (memInfo.active / memInfo.total) * 100,
      swap: {
        total: this.getSize(memInfo.swaptotal),
        free: this.getSize(memInfo.swapfree),
        used: this.getSize(memInfo.swaptotal - memInfo.swapfree),
        percentage: memInfo.swaptotal
          ? ((memInfo.swaptotal - memInfo.swapfree) / memInfo.swaptotal) * 100
          : 0,
      },
    };

    return {
      version: process.env.APP_VERSION || 'Unknown',
      system: system,
      boot: boot,
      cpu: cpu,
      memory: memory,
      wallet: this.config.get<string>('wallet.public_key') || 'Not configured',
    };
  }
}
