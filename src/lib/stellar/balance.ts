import { Horizon } from '@stellar/stellar-sdk';
import { env } from '@/lib/env';

export const HORIZON_URL = env.horizonUrl;
const USDC_CODE = 'USDC';

export interface WalletBalances {
  xlm: string;
  usdc: string;
}

export async function getWalletBalances(address: string): Promise<WalletBalances> {
  const account = await new Horizon.Server(HORIZON_URL).loadAccount(address);
  const xlmBalance = account.balances.find((balance) => balance.asset_type === 'native');
  const usdcBalance = account.balances.find(
    (balance) =>
      balance.asset_type === 'credit_alphanum4' &&
      balance.asset_code === USDC_CODE,
  );

  return {
    xlm: xlmBalance?.balance ?? '0',
    usdc: usdcBalance?.balance ?? '0',
  };
}
