'use client';

import { useState } from 'react';
import { AlertTriangle, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { resolveDispute } from '@/lib/stellar/contract';
import { useAuthStore } from '@/lib/hooks/use-auth-store';
import { stroopsToUsdc, proofHashHref } from '@/lib/utils';
import { parseContractError } from '@/lib/stellar/errors';
import type { Shipment, Milestone } from '@/types';

interface ArbiterPanelProps {
  milestone: Milestone;
  shipment: Shipment;
  onUpdate: () => void;
  onError?: (err: unknown) => void;
}

export function ArbiterPanel({ milestone, shipment, onUpdate, onError }: ArbiterPanelProps) {
  const { address } = useAuthStore();
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'reject' | null>(null);

  const totalUsdc = parseFloat(stroopsToUsdc(shipment.totalAmount));
  const milestoneUsdc = ((totalUsdc * milestone.paymentPercent) / 100).toFixed(2);

  const handle = async (approve: boolean) => {
    const action = approve ? 'approve' : 'reject';

    setLoading(action);
    try {
      await resolveDispute({
        callerAddress: address!,
        shipmentId: shipment.id,
        milestoneIndex: milestone.milestoneIndex,
        approve,
      });
      onUpdate();
    } catch (err) {
      if (onError) onError(err);
      else alert(parseContractError(err).message);
    } finally {
      setLoading(null);
      setConfirmAction(null);
    }
  };

  return (
    <div className="mt-4 rounded-xl border-2 border-amber-300 bg-amber-50 p-4" role="alert" aria-live="assertive">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0" aria-hidden="true" />
        <span className="text-sm font-semibold text-amber-800">Arbiter Action Required</span>
      </div>

      <div className="space-y-1.5 mb-4 text-xs text-amber-900">
        <p>
          <span className="font-medium">Milestone:</span> {milestone.name}
        </p>
        <p>
          <span className="font-medium">Value:</span> {milestone.paymentPercent}% — ${milestoneUsdc} USDC
        </p>
        {milestone.proofHash && (
          <p className="flex items-center gap-1 flex-wrap">
            <span className="font-medium">Proof:</span>
            {proofHashHref(milestone.proofHash) ? (
              <a
                href={proofHashHref(milestone.proofHash)!}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-amber-700 underline hover:text-amber-900 truncate max-w-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                aria-label="View proof hash (opens in new tab)"
              >
                {milestone.proofHash}
              </a>
            ) : (
              <span className="font-mono text-amber-700 truncate max-w-xs" title={milestone.proofHash}>
                {milestone.proofHash}
              </span>
            )}
          </p>
        )}
        <p>
          <span className="font-medium">Status:</span> Disputed — review the proof and take action below.
        </p>
      </div>

      {confirmAction === null ? (
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setConfirmAction('approve')}
            disabled={loading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 text-white hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            aria-label="Approve this milestone and release funds"
          >
            <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
            Approve milestone
          </button>

          <button
            onClick={() => setConfirmAction('reject')}
            disabled={loading !== null}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
            aria-label="Reject this milestone and reset to pending"
          >
            <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
            Reject milestone
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2" role="dialog" aria-modal="true" aria-label="Confirm arbiter action">
          <p className="text-xs font-medium text-amber-900">
            {confirmAction === 'approve'
              ? `Approve this milestone and release $${milestoneUsdc} USDC to the supplier?`
              : `Reject this milestone and reset it back to Pending?`}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handle(confirmAction === 'approve')}
              disabled={loading !== null}
              className={confirmAction === 'approve' ? 'btn-primary text-xs' : 'btn-danger text-xs'}
            >
              {loading === confirmAction ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
              ) : confirmAction === 'approve' ? (
                <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <ThumbsDown className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              {confirmAction === 'approve' ? 'Yes, approve' : 'Yes, reject'}
            </button>
            <button
              onClick={() => setConfirmAction(null)}
              disabled={loading !== null}
              className="btn-secondary text-xs"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
