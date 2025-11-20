import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TurboFactory } from '@ardrive/turbo-sdk';
import { TurboAuthenticatedClient } from '@ardrive/turbo-sdk/lib/types/common/turbo';
import Arweave from 'arweave';
import * as https from 'https';

@Injectable()
export class NodeRegistrationService implements OnModuleInit {
  private readonly turbo: TurboAuthenticatedClient;
  private readonly arweave: Arweave;
  private readonly privateKey: any;
  private readonly publicAddress: string;

  constructor(private readonly configService: ConfigService) {
    this.privateKey = configService.get<any>('wallet.private_key');
    this.publicAddress = configService.get<string>('wallet.public_key') || '';

    this.arweave = Arweave.init({
      host: 'arweave.net',
      port: 443,
      protocol: 'https',
    });

    this.turbo = TurboFactory.authenticated({
      privateKey: this.privateKey,
      paymentServiceConfig: {
        url: 'https://payment.ardrive.io/',
      },
    });
  }

  async onModuleInit() {
    // Register node on startup
    await this.registerNode();
  }

  /**
   * Fetch public IP address from external API
   */
  private async getPublicIP(): Promise<string> {
    return new Promise((resolve, reject) => {
      https.get('https://api.ipify.org?format=json', (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve(json.ip);
          } catch (e) {
            reject(new Error('Failed to parse IP response'));
          }
        });
      }).on('error', (err) => {
        reject(err);
      });
    });
  }

  /**
   * Register this node on Arweave network
   * Publishes node metadata with signature
   */
  async registerNode(): Promise<string> {
    try {
      console.log('🌐 [NODE REGISTRATION] Starting node registration...');

      // Get public IP
      const publicIP = await this.getPublicIP();
      console.log(`📍 [NODE REGISTRATION] Public IP: ${publicIP}`);

      // Prepare node information
      const nodeInfo = {
        version: '1.0.0',
        publicIP: publicIP,
        beastPort: 30005,
        apiPort: 1937,
        walletAddress: this.publicAddress,
        timestamp: new Date().toISOString(),
        nodeType: 'DeRadarBackupNode',
      };

      // Create message to sign (deterministic string representation)
      const messageToSign = JSON.stringify(nodeInfo, Object.keys(nodeInfo).sort());

      // Sign the message with Arweave private key
      const messageBuffer = Buffer.from(messageToSign, 'utf-8');
      const signature = await this.arweave.crypto.sign(this.privateKey, messageBuffer);
      const signatureBase64 = Buffer.from(signature).toString('base64');

      console.log(`🔐 [NODE REGISTRATION] Message signed`);

      // Prepare upload data (signature as file content)
      const uploadData = {
        nodeInfo: nodeInfo,
        signature: signatureBase64,
        message: messageToSign,
      };

      const uploadBuffer = Buffer.from(JSON.stringify(uploadData, null, 2), 'utf-8');

      // Prepare tags with all node information
      const tags = [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'App-Name', value: 'DeRadarNode' },
        { name: 'Node-Type', value: 'DeRadarBackupNode' },
        { name: 'Node-Version', value: '1.0.0' },
        { name: 'Public-IP', value: publicIP },
        { name: 'Beast-Port', value: '30005' },
        { name: 'API-Port', value: '1937' },
        { name: 'Wallet-Address', value: this.publicAddress },
        { name: 'Registration-Timestamp', value: nodeInfo.timestamp },
        { name: 'Signature', value: signatureBase64 },
      ];

      // Upload to Arweave
      const { id: txId } = await this.turbo.upload({
        data: uploadBuffer,
        dataItemOpts: {
          tags: tags,
        },
      });

      console.log(`✅ [NODE REGISTRATION] Node registered successfully!`);
      console.log(`   Transaction ID: ${txId}`);
      console.log(`   Public IP: ${publicIP}`);
      console.log(`   Beast Port: 30005`);
      console.log(`   API Port: 1937`);
      console.log(`   Wallet: ${this.publicAddress}`);
      console.log(`   View at: https://arweave.net/${txId}`);

      return txId;
    } catch (error) {
      console.error('❌ [NODE REGISTRATION] Failed to register node:', error.message);
      throw error;
    }
  }

  /**
   * Verify a node registration signature
   * Can be used to verify other nodes' registrations
   */
  async verifyNodeSignature(nodeInfo: any, signature: string, walletAddress: string): Promise<boolean> {
    try {
      const messageToVerify = JSON.stringify(nodeInfo, Object.keys(nodeInfo).sort());
      const messageBuffer = Buffer.from(messageToVerify, 'utf-8');
      const signatureBuffer = Buffer.from(signature, 'base64');

      // Note: To fully verify, you'd need the public key from the wallet address
      // This is a placeholder - actual verification requires the public modulus
      return await this.arweave.crypto.verify(
        walletAddress,
        messageBuffer,
        signatureBuffer
      );
    } catch (error) {
      console.error('Signature verification failed:', error.message);
      return false;
    }
  }
}
