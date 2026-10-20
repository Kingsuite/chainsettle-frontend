'use client';

import { useTranslations } from 'next-intl';
import { Clock } from 'lucide-react';
import { StellarLink } from '@/components/StellarLink';
import { ContractError, TxPendingError } from '@/lib/stellar/errors';

/**
 * Renders an error from a contract call:
 *   - TxPendingError → "still pending" notice with a Stellar Expert link
 *   - ContractError  → friendly message + collapsible "Technical details"
 *   - anything else  → its message
 */
export function TransactionError({
  error,
  fallback,
  className = 'text-sm text-red-700',
}: {
  error: unknown;
  fallback?: string;
  className?: string;
}) {
  const t = useTranslations('contractErrors');

  if (error instanceof TxPendingError) {
    return (
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800">
          <Clock className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
          {t('pendingTitle')}
        </p>
        <p className="text-sm text-amber-700">
          {t('pendingDescription')}{' '}
          <StellarLink value={error.hash} type="tx" className="font-mono text-amber-800 underline hover:text-amber-900" />
        </p>
      </div>
    );
  }

  if (error instanceof ContractError) {
    return (
      <div className="space-y-1">
        <p className={className}>{t(`codes.${error.code}`)}</p>
        {error.code !== 'UserRejected' && (
          <details className="text-xs text-gray-500">
            <summary className="cursor-pointer select-none hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500">
              {t('technicalDetails')}
            </summary>
            <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-gray-50 p-2 font-mono text-[11px] text-gray-600">
              {error.raw}
            </pre>
            {error.txHash && (
              <p className="mt-1">
                {t('transaction')}{' '}
                <StellarLink value={error.txHash} type="tx" />
              </p>
            )}
          </details>
        )}
      </div>
    );
  }

  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : null;

  return <p className={className}>{message || fallback || t('codes.Unknown')}</p>;
}

/** True for a timeout where the transaction may still land */
export function isTxPending(error: unknown): error is TxPendingError {
  return error instanceof TxPendingError;
}
