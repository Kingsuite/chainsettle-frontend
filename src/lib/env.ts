/**
 * lib/env.ts
 *
 * Validates every NEXT_PUBLIC_* environment variable once, at module load,
 * and exports a typed `env` object. Import `env` instead of reading
 * `process.env` directly.
 *
 * Each variable is read with a literal `process.env.NEXT_PUBLIC_*` access so
 * Next.js can inline it into the client bundle.
 */

export type StellarNetwork = 'testnet' | 'mainnet';

export interface Env {
  apiUrl: string;
  stellarNetwork: StellarNetwork;
  contractId: string;
  usdcAddress: string;
  stellarRpcUrl: string;
  horizonUrl: string;
  ipfsGateway: string;
}

const NETWORKS: readonly StellarNetwork[] = ['testnet', 'mainnet'];
const CONTRACT_ID_PATTERN = /^C[A-Z2-7]{55}$/;

const raw = {
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_STELLAR_NETWORK: process.env.NEXT_PUBLIC_STELLAR_NETWORK,
  NEXT_PUBLIC_CONTRACT_ID: process.env.NEXT_PUBLIC_CONTRACT_ID,
  NEXT_PUBLIC_USDC_ADDRESS: process.env.NEXT_PUBLIC_USDC_ADDRESS,
  NEXT_PUBLIC_STELLAR_RPC_URL: process.env.NEXT_PUBLIC_STELLAR_RPC_URL,
  NEXT_PUBLIC_HORIZON_URL: process.env.NEXT_PUBLIC_HORIZON_URL,
  NEXT_PUBLIC_IPFS_GATEWAY: process.env.NEXT_PUBLIC_IPFS_GATEWAY,
};

type EnvKey = keyof typeof raw;

function isUrl(value: string, protocols: string[]): boolean {
  try {
    return protocols.includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function validateEnv(): Env {
  const errors: string[] = [];

  const read = (key: EnvKey): string | undefined => {
    const value = raw[key]?.trim();
    return value ? value : undefined;
  };

  const required = (key: EnvKey): string => {
    const value = read(key);
    if (!value) errors.push(`${key} is missing`);
    return value ?? '';
  };

  const checkUrl = (key: EnvKey, value: string | undefined, protocols = ['http:', 'https:']) => {
    if (value && !isUrl(value, protocols)) {
      errors.push(`${key} must be a valid ${protocols.join(' or ').replace(/:/g, '')} URL (got "${value}")`);
    }
  };

  const checkContractId = (key: EnvKey, value: string) => {
    if (value && !CONTRACT_ID_PATTERN.test(value)) {
      errors.push(`${key} must be a 56-character Stellar contract ID starting with "C" (got "${value}")`);
    }
  };

  const network = read('NEXT_PUBLIC_STELLAR_NETWORK') ?? 'testnet';
  if (!NETWORKS.includes(network as StellarNetwork)) {
    errors.push(`NEXT_PUBLIC_STELLAR_NETWORK must be one of ${NETWORKS.join(' | ')} (got "${network}")`);
  }

  const apiUrl = read('NEXT_PUBLIC_API_URL') ?? 'http://localhost:3000/api/v1';
  checkUrl('NEXT_PUBLIC_API_URL', apiUrl);

  const contractId = required('NEXT_PUBLIC_CONTRACT_ID');
  checkContractId('NEXT_PUBLIC_CONTRACT_ID', contractId);

  const usdcAddress = required('NEXT_PUBLIC_USDC_ADDRESS');
  checkContractId('NEXT_PUBLIC_USDC_ADDRESS', usdcAddress);

  const stellarRpcUrl = required('NEXT_PUBLIC_STELLAR_RPC_URL');
  checkUrl('NEXT_PUBLIC_STELLAR_RPC_URL', stellarRpcUrl);

  const horizonUrl =
    read('NEXT_PUBLIC_HORIZON_URL') ??
    (network === 'mainnet' ? 'https://horizon.stellar.org' : 'https://horizon-testnet.stellar.org');
  checkUrl('NEXT_PUBLIC_HORIZON_URL', horizonUrl);

  const ipfsGateway = read('NEXT_PUBLIC_IPFS_GATEWAY') ?? 'https://ipfs.io/ipfs/';
  checkUrl('NEXT_PUBLIC_IPFS_GATEWAY', ipfsGateway, ['https:']);

  if (errors.length > 0) {
    throw new Error(
      `Invalid environment configuration:\n${errors.map((e) => `  - ${e}`).join('\n')}\n` +
        'See .env.example for the expected variables.',
    );
  }

  return {
    apiUrl,
    stellarNetwork: network as StellarNetwork,
    contractId,
    usdcAddress,
    stellarRpcUrl,
    horizonUrl,
    ipfsGateway: ipfsGateway.endsWith('/') ? ipfsGateway : `${ipfsGateway}/`,
  };
}

export const env: Env = validateEnv();
