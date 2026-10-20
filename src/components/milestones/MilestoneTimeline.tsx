'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  CheckCircle2,
  Clock,
  AlertTriangle,
  Upload,
  ThumbsUp,
  XCircle,
  Loader2,
  Copy,
} from 'lucide-react';
import {
  submitProof,
  confirmMilestone,
  raiseDispute,
} from '@/lib/stellar/contract';
import { ArbiterPanel } from './ArbiterPanel';
import { useAuthStore } from '@/lib/hooks/use-auth-store';
import {
  milestoneStatusBadge,
  milestoneStatusLabel,
  stroopsToUsdc,
  cn,
  toSafeProofUrl,
  copyToClipboard,
} from '@/lib/utils';
import { env } from '@/lib/env';
import type { Shipment, Milestone, MilestoneStatus } from '@/types';

interface Props {
  shipment: Shipment;
  userRole: string;
  onUpdate: () => void;
}

export function MilestoneTimeline({ shipment, userRole, onUpdate }: Props) {
  const t = useTranslations('milestones');
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  return (
    <div className="card divide-y divide-gray-50">
      {shipment.milestones.map((milestone, i) => (
        <MilestoneRow
          key={milestone.id}
          milestone={milestone}
          shipment={shipment}
          userRole={userRole}
          onUpdate={onUpdate}
          isLast={i === shipment.milestones.length - 1}
          onError={(msg) => setError(msg)}
        />
      ))}
      {error && (
        <div ref={errorRef} tabIndex={-1} className="p-4 bg-red-50 border-t border-red-100" role="alert" aria-live="assertive">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}
    </div>
  );
}

function stepStatusIcon(status: MilestoneStatus) {
  if (status === 'Confirmed' || status === 'Resolved') {
    return <CheckCircle2 className="h-4 w-4 text-green-600" />;
  }
  if (status === 'ProofSubmitted') return <Upload className="h-4 w-4 text-amber-600" />;
  if (status === 'Disputed') return <AlertTriangle className="h-4 w-4 text-red-600" />;
  return <Clock className="h-4 w-4 text-gray-500" />;
}

function MilestoneRow({
  milestone,
  shipment,
  userRole,
  onUpdate,
  isLast,
  onError,
}: {
  milestone: Milestone;
  shipment: Shipment;
  userRole: string;
  onUpdate: () => void;
  isLast: boolean;
  onError: (msg: string) => void;
}) {
  const t = useTranslations('milestones');
  const { address } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [proofInput, setProofInput] = useState('');
  const [showProofInput, setShowProofInput] = useState(false);

  const percent = milestone.paymentPercent;
  const totalUsdc = parseFloat(stroopsToUsdc(shipment.totalAmount));
  const milestoneUsdc = ((totalUsdc * percent) / 100).toFixed(2);

  const isActive = shipment.status === 'Active';
  const proofUrl = milestone.proofHash
    ? toSafeProofUrl(milestone.proofHash, env.ipfsGateway)
    : null;

  const statusIcon: Record<MilestoneStatus, JSX.Element> = {
    Pending:        <Clock className="w-4 h-4 text-gray-400" />,
    ProofSubmitted: <Upload className="w-4 h-4 text-amber-500" />,
    Confirmed:      <CheckCircle2 className="w-4 h-4 text-green-500" />,
    Disputed:       <AlertTriangle className="w-4 h-4 text-red-500" />,
    Resolved:       <CheckCircle2 className="w-4 h-4 text-purple-500" />,
  };

  const wrap = async (fn: () => Promise<unknown>) => {
    if (!address || loading) return;
    setLoading(true);
    try {
      await fn();
      onUpdate();
    } catch (err: any) {
      onError(err?.message ?? t('transactionFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitProof = () =>
    wrap(async () => {
      if (!proofInput.trim()) throw new Error(t('proofRequired'));
      await submitProof({
        callerAddress: address!,
        shipmentId: shipment.id,
        milestoneIndex: milestone.milestoneIndex,
        proofHash: proofInput.trim(),
      });
      setShowProofInput(false);
      setProofInput('');
    });

  const handleConfirm = () =>
    wrap(() =>
      confirmMilestone({
        callerAddress: address!,
        shipmentId: shipment.id,
        milestoneIndex: milestone.milestoneIndex,
      }),
    );

  const handleDispute = () =>
    wrap(() =>
      raiseDispute({
        callerAddress: address!,
        shipmentId: shipment.id,
        milestoneIndex: milestone.milestoneIndex,
      }),
    );

  const canSubmitProof =
    isActive &&
    milestone.status === 'Pending' &&
    (userRole === 'supplier' || userRole === 'logistics');

  const canConfirm =
    isActive &&
    milestone.status === 'ProofSubmitted' &&
    userRole === 'buyer';

  const canDispute =
    isActive &&
    milestone.status === 'ProofSubmitted' &&
    userRole === 'buyer';

  const isArbiterOnDisputed =
    isActive &&
    milestone.status === 'Disputed' &&
    address === shipment.arbiterAddress;

  return (
    <div
      id={`milestone-${milestone.id}`}
      className="p-5 transition-colors duration-500"
    >
      <div className="flex items-start gap-4">
        {/* Status icon */}
        <div
          className={cn(
            'w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5',
            milestone.status === 'Confirmed' || milestone.status === 'Resolved'
              ? 'bg-green-50'
              : milestone.status === 'Disputed'
              ? 'bg-red-50'
              : milestone.status === 'ProofSubmitted'
              ? 'bg-amber-50'
              : 'bg-gray-50',
          )}
          aria-hidden="true"
        >
          {statusIcon[milestone.status]}
        </div>

        <div className="flex-1 min-w-0">
          {/* Milestone header */}
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-medium text-gray-900">{milestone.name}</span>
            <span className={milestoneStatusBadge(milestone.status)}>
              {milestoneStatusLabel(milestone.status)}
            </span>
          </div>

          <p className="text-xs text-gray-400 mb-2">
            {t('percentOfTotal', { percent })} — <span className="font-medium text-gray-600">${milestoneUsdc} USDC</span>
          </p>

          {/* Proof hash (if submitted) */}
          {milestone.proofHash && (
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-xs text-gray-400">{t('proofLabel')}</span>
              {proofUrl ? (
                <a
                  href={proofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-600 hover:underline font-mono truncate max-w-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={t('viewProofAria')}
                >
                  {milestone.proofHash}
                </a>
              ) : (
                <>
                  <span className="text-xs text-gray-700 font-mono truncate max-w-xs">
                    {milestone.proofHash}
                  </span>
                  <button
                    onClick={() => copyToClipboard(milestone.proofHash!)}
                    aria-label="Copy proof to clipboard"
                    className="text-gray-300 hover:text-gray-600 transition-colors flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
                  >
                    <Copy className="w-3 h-3" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          )}

          {/* Payment released */}
          {milestone.paymentReleased && (
            <p className="text-xs text-green-600 font-medium mb-2">
              {t('paymentReleased', { amount: stroopsToUsdc(milestone.paymentReleased) })}
            </p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap gap-2 mt-3">
            {loading && (
              <div className="flex items-center gap-1.5 text-xs text-gray-500" aria-live="polite" aria-label={t('transactionInProgressAria')}>
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                {t('waitingForFreighter')}
              </div>
            )}

            {/* Submit proof */}
            {canSubmitProof && !loading && (
              <>
                {showProofInput ? (
                  <div className="flex items-center gap-2 w-full">
                    <input
                      type="text"
                      placeholder={t('proofPlaceholder')}
                      value={proofInput}
                      onChange={(e) => setProofInput(e.target.value)}
                      className="input flex-1 text-sm"
                      aria-label={t('proofInputAria')}
                    />
                    <button
                      onClick={handleSubmitProof}
                      disabled={loading}
                      className="btn-primary text-xs px-3 py-1.5"
                    >
                      {t('submit')}
                    </button>
                    <button
                      onClick={() => {
                        setShowProofInput(false);
                        setProofInput('');
                      }}
                      className="btn-secondary text-xs px-3 py-1.5"
                    >
                      {t('cancel')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowProofInput(true)}
                    className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    {t('submitProof')}
                  </button>
                )}
              </>
            )}

            {/* Confirm */}
            {canConfirm && !loading && (
              <button
                onClick={handleConfirm}
                className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5"
              >
                <ThumbsUp className="w-3.5 h-3.5" aria-hidden="true" />
                {t('confirmReceipt')}
              </button>
            )}

            {/* Dispute */}
            {canDispute && !loading && (
              <button
                onClick={handleDispute}
                className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5 text-red-600 hover:text-red-700"
              >
                <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                {t('raiseDispute')}
              </button>
            )}
          </div>

          {/* Arbiter panel */}
          {isArbiterOnDisputed && (
            <ArbiterPanel
              shipment={shipment}
              milestone={milestone}
              onUpdate={onUpdate}
              onError={onError}
            />
          )}
        </div>
      </div>
    </div>
  );
}
