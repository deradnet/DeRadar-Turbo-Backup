import { Injectable } from '@nestjs/common';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TurboFactory } from '@ardrive/turbo-sdk';
import { InjectRepository } from '@nestjs/typeorm';
import { ArchiveRecord } from './entities/archive-record.entity';
import { Repository } from 'typeorm';
import Arweave from 'arweave';
import { paginate } from '../common/utils/paginate';
import { Request } from 'express';
import { TurboAuthenticatedClient } from '@ardrive/turbo-sdk/lib/types/common/turbo';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ArchiveService {
  private readonly turbo: TurboAuthenticatedClient;
  private arweave: Arweave;

  constructor(
    @InjectRepository(ArchiveRecord)
    private readonly archiveRepo: Repository<ArchiveRecord>,
    private readonly configService: ConfigService,
  ) {
    this.arweave = Arweave.init({
      host: 'arweave.net',
      port: 443,
      protocol: 'https',
    });
    this.turbo = TurboFactory.authenticated({
      privateKey: configService.get<string>('wallet.private_key'),
      paymentServiceConfig: {
        url: 'https://payment.ardrive.io/',
      },
    });
  }

  async uploadJson(json: any): Promise<string> {
    const tmpDir = os.tmpdir();
    const filePath = path.join(tmpDir, 'aircraft.json');

    fs.writeFileSync(filePath, JSON.stringify(json, null, 2), 'utf-8');
    const fileSize = fs.statSync(filePath).size;

    const utcTimestamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '');

    const { id: txId } = await this.turbo.uploadFile({
      fileStreamFactory: () => fs.createReadStream(filePath),
      fileSizeFactory: () => fileSize,
      dataItemOpts: {
        tags: [
          { name: 'Content-Type', value: 'application/json' },
          { name: 'App-Name', value: 'DeradNetworkBackup' },
          { name: 'Timestamp', value: utcTimestamp },
        ],
      },
    });

    await this.create({
      txId,
      source: 'aircraft',
      timestamp: utcTimestamp,
    });

    fs.unlinkSync(filePath);
    return txId;
  }

  async findAll({
    offset = 0,
    limit = 10,
    req,
  }: {
    offset?: number;
    limit?: number;
    req: Request;
  }) {
    return paginate(this.archiveRepo, { offset, limit, req });
  }

  async create(record: Partial<ArchiveRecord>): Promise<ArchiveRecord> {
    const newRecord = this.archiveRepo.create(record);
    return this.archiveRepo.save(newRecord);
  }

  async getDataByTX(id: string): Promise<string> {
    const data = await this.arweave.transactions.getData(id, {
      decode: true,
      string: true,
    });

    return data as string;
  }
}
