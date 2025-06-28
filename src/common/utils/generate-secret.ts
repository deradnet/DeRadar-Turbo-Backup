import { readFileSync, writeFileSync } from 'fs';
import { randomBytes } from 'crypto';
import * as YAML from 'yaml';
import { join } from 'path';

const configPath = join('config.yaml');

export function generateOrInjectSecret(): string {
  const fileContent = readFileSync(configPath, 'utf-8');
  const config = YAML.parse(fileContent);

  if (!config.auth) config.auth = {};
  if (!config.auth.secret) {
    const newSecret = randomBytes(32).toString('hex');
    config.auth.secret = newSecret;

    const updatedYaml = YAML.stringify(config);
    writeFileSync(configPath, updatedYaml, 'utf-8');

    console.log('Generated and saved new session secret in config.yaml');
    return newSecret;
  }

  return config.auth.secret;
}
