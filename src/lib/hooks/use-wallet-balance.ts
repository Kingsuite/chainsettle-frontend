'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getWalletBalances, type WalletBalances } from '@/lib/stellar/balance';
import { usePolling } from '@/lib/hooks/use-polling';

const BALANCE_POLL_INTERVAL_MS = 30_000;

export function useWalletBalance(address: string | null) {
  const [balances, setBalances] = useState<WalletBalances | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addressRef = useRef(address);
  addressRef.current = address;

  const refresh = useCallback(async () => {
    if (!address) return;

    setLoading(true);
    setError(null);
    try {
      const nextBalances = await getWalletBalances(address);
      if (addressRef.current === address) setBalances(nextBalances);
    } catch (err) {
      if (addressRef.current === address) {
        setError(err instanceof Error ? err.message : 'Unable to load wallet balance.');
      }
    } finally {
      if (addressRef.current === address) setLoading(false);
    }
  }, [address]);

  usePolling(refresh, BALANCE_POLL_INTERVAL_MS, { enabled: Boolean(address) });

  useEffect(() => {
    if (!address) {
      setBalances(null);
      setError(null);
      setLoading(false);
      return;
    }

    const handleTransaction = () => {
      if (document.visibilityState !== 'hidden') {
        void refresh();
      }
    };
    window.addEventListener('chainsettle:transaction-complete', handleTransaction);
    void refresh();

    return () => {
      window.removeEventListener('chainsettle:transaction-complete', handleTransaction);
    };
  }, [address, refresh]);

  return { balances, loading, error };
}