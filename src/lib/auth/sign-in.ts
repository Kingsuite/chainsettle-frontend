/**
 * lib/auth/sign-in.ts
 *
 * The Sign-In With Stellar flow: connect Freighter → fetch nonce → sign →
 * exchange for a JWT. Shared by the login page and the session timeout
 * modal ("Stay signed in") so both renew tokens the same way.
 */

import { Networks } from '@stellar/stellar-sdk';
import { connectFreighter, signNonce } from '@/lib/stellar/freighter';
import { authApi } from '@/lib/api/services';
import { env } from '@/lib/env';
import type { User } from '@/types';

export type SignInStep = 'connecting' | 'signing' | 'verifying';

export interface SignInResult {
  address: string;
  accessToken: string;
  user: User;
}

export async function signInWithStellar(
  onStep?: (step: SignInStep) => void,
): Promise<SignInResult> {
  onStep?.('connecting');
  const address = await connectFreighter();
  const nonce = await authApi.getNonce(address);

  onStep?.('signing');
  const networkPassphrase =
    env.stellarNetwork === 'mainnet' ? Networks.PUBLIC : Networks.TESTNET;
  const signedNonce = await signNonce(nonce, networkPassphrase);

  onStep?.('verifying');
  const { accessToken, user } = await authApi.login({
    stellarAddress: address,
    signedNonce,
    signature: signedNonce, // backend verifies the XDR
  });

  return { address, accessToken, user };
}
