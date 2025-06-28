import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { configValidationSchema } from '../../config/config.schema';

export default () => {
  const file = fs.readFileSync('./config.yaml', 'utf8');
  const parsed = yaml.load(file) as Record<string, any>;

  if (Array.isArray(parsed.antennas)) {
    parsed.antennas = parsed.antennas.map((antenna) => {
      if (
        typeof antenna.url === 'string' &&
        /^http:\/\/(localhost|127\.0\.0\.1|::1)/.test(antenna.url)
      ) {
        antenna.url = antenna.url.replace(
          /^http:\/\/(localhost|127\.0\.0\.1|::1)/,
          'http://host.docker.internal',
        );
      }
      return antenna;
    });
  }

  const keyName = parsed.wallet?.private_key_name;
  if (typeof keyName !== 'string') {
    throw new Error('wallet.private_key_name must be defined in config.yaml');
  }

  const absKeyPath = path.resolve('./keys', keyName);
  if (!fs.existsSync(absKeyPath)) {
    throw new Error(`Private key file not found at: ${absKeyPath}`);
  }

  const privateKeyRaw = fs.readFileSync(absKeyPath, 'utf8');

  let privateKey: { kty: string; n: string; e: string; [key: string]: unknown };
  try {
    privateKey = JSON.parse(privateKeyRaw);
  } catch (e) {
    throw new Error(
      'Failed to parse private key JSON: ' + (e as Error).message,
    );
  }

  if (!privateKey.kty || !privateKey.n || !privateKey.e) {
    throw new Error(
      'Invalid private key file. Must include kty, n, and e fields.',
    );
  }

  const publicKey = keyName
    .replace(/^arweave-keyfile-/, '')
    .replace(/\.json$/, '');

  const finalConfig = {
    ...parsed,
    wallet: {
      ...parsed.wallet,
      private_key: privateKey,
      public_key: publicKey,
    },
  };

  const { error, value } = configValidationSchema.validate(finalConfig, {
    abortEarly: false,
  });

  if (error) {
    console.error('Config validation error:\n', error.message);
    process.exit(1);
  }

  return value;
};
