'use client';

import { shortAddress } from '@/lib/utils';
import { env } from '@/lib/env';

type StellarLinkProps = {
  value: string;
  type: 'account' | 'tx';
  className?: string;
};

const STELLAR_NETWORK =
  env.stellarNetwork === 'mainnet' ? 'public' : 'testnet';

const BASE_URL = `https://stellar.expert/explorer/${STELLAR_NETWORK}`;

export function StellarLink({ value, type, className }: StellarLinkProps) {
  const href = `${BASE_URL}/${type === 'account' ? 'account' : 'tx'}/${value}`;
  const label = type === 'account' ? 'View account on Stellar Expert' : 'View transaction on Stellar Expert';

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className ?? 'font-mono text-blue-600 hover:text-blue-800 underline'}
      aria-label={`${label} (opens in new tab)`}
    >
      {shortAddress(value, 6)}
    </a>
  );
}
