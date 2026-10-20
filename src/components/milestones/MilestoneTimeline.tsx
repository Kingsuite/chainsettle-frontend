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
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  submitProof,
  confirmMilestone,
  raiseDispute,
} from '@/lib/stellar/contract';
import { ArbiterPanel } from './ArbiterPanel';
import { ProofDocumentDropzone } from './ProofDocumentDropzone';
import { TransactionError, isTxPending } from '@/components/TransactionError';
import { normalizeProofHash } from '@/lib/proof-hash';
import { useAuthStore } from '@/lib/hooks/use-auth-store';
import { milestoneStatusBadge, milestoneStatusLabel, stroopsToUsdc, proofHashHref, cn } from '@/lib/utils';
import type { Shipment, Milestone, MilestoneStatus } from '@/types';

interface Props {
  shipment: Shipment;
  userRole: string;
  onUpdate: () => void;
}

export function MilestoneTimeline({ shipment, userRole, onUpdate }: Props) {
  const t = useTranslations('milestones');
  const [error, setError] = useState<unknown>(null);
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
          onError={(err) => setError(err)}
        />
      ))}
      {error != null && (
        <div
          ref={errorRef}
          tabIndex={-1}
          className={cn(
            'p-4 border-t',
            isTxPending(error) ? 'bg-amber-50 border-amber-100' : 'bg-red-50 border-red-100',
          )}
          role="alert"
          aria-live="assertive"
        >
          <TransactionError error={error} fallback={t('transactionFailed')} />
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
  onError: (err: unknown) => void;
}) {
  const t = useTranslations('milestones');
  const { address } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [proofInput, setProofInput] = useState('');
  const [showProofInput, setShowProofInput] = useState(false);
  const [proofMode, setProofMode] = useState<'upload' | 'manual'>('upload');
  const [showVerify, setShowVerify] = useState(false);
  const [verifyResult, setVerifyResult] = useState<'match' | 'mismatch' | null>(null);
  const tProof = useTranslations('proofDocument');
  const tabsId = useId();

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
    } catch (err) {
      onError(err);
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
      closeProofInput();
    });

  const closeProofInput = () => {
    setShowProofInput(false);
    setProofInput('');
    setProofMode('upload');
  };

  const closeVerify = () => {
    setShowVerify(false);
    setVerifyResult(null);
  };

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
              {proofHashHref(milestone.proofHash) ? (
                <a
                  href={proofHashHref(milestone.proofHash)!}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-brand-600 hover:underline font-mono truncate max-w-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                  aria-label={t('viewProofAria')}
                >
                  {milestone.proofHash}
                </a>
              ) : (
                <span className="text-xs text-gray-600 font-mono truncate max-w-xs" title={milestone.proofHash}>
                  {milestone.proofHash}
                </span>
              )}
              {!showVerify && (
                <button
                  type="button"
                  onClick={() => setShowVerify(true)}
                  className="btn-ghost text-xs px-2 py-0.5 flex items-center gap-1"
                >
                  <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                  {tProof('verifyDocument')}
                </button>
              )}
            </div>
          )}

          {/* Verify a document against the submitted proof */}
          {milestone.proofHash && showVerify && (
            <div className="mb-3 rounded-xl border border-gray-100 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-gray-700">{tProof('verifyTitle')}</p>
                <button
                  type="button"
                  onClick={closeVerify}
                  aria-label={tProof('close')}
                  className="p-1 text-gray-400 hover:text-gray-600 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
              <ProofDocumentDropzone
                ariaLabel={tProof('verifyDropzoneLabel')}
                onHashed={({ hash }) =>
                  setVerifyResult(
                    hash === normalizeProofHash(milestone.proofHash ?? '') ? 'match' : 'mismatch',
                  )
                }
              />
              {verifyResult && (
                <p
                  role="status"
                  className={cn(
                    'flex items-center gap-1.5 text-xs font-medium',
                    verifyResult === 'match' ? 'text-green-700' : 'text-red-600',
                  )}
                >
                  {verifyResult === 'match' ? (
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  {tProof(verifyResult)}
                </p>
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
                  <div className="w-full space-y-3">
                    <div role="tablist" aria-label={tProof('proofMethod')} className="flex gap-1">
                      {(['upload', 'manual'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="tab"
                          id={`${tabsId}-${mode}-tab`}
                          aria-selected={proofMode === mode}
                          aria-controls={`${tabsId}-${mode}-panel`}
                          onClick={() => setProofMode(mode)}
                          className={cn(
                            'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500',
                            proofMode === mode
                              ? 'bg-slate-900 text-white'
                              : 'bg-slate-100 text-slate-700 hover:bg-slate-200',
                          )}
                        >
                          {mode === 'upload' ? tProof('uploadTab') : tProof('manualTab')}
                        </button>
                      ))}
                    </div>

                    <div
                      role="tabpanel"
                      id={`${tabsId}-${proofMode}-panel`}
                      aria-labelledby={`${tabsId}-${proofMode}-tab`}
                    >
                      {proofMode === 'upload' ? (
                        <ProofDocumentDropzone onHashed={({ hash }) => setProofInput(hash)} />
                      ) : (
                        <input
                          type="text"
                          placeholder={t('proofPlaceholder')}
                          value={proofInput}
                          onChange={(e) => setProofInput(e.target.value)}
                          className="input w-full text-sm"
                          aria-label={t('proofInputAria')}
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleSubmitProof}
                        disabled={loading || !proofInput.trim()}
                        className="btn-primary text-xs px-3 py-1.5"
                      >
                        {t('submit')}
                      </button>
                      <button
                        onClick={closeProofInput}
                        className="btn-secondary text-xs px-3 py-1.5"
                      >
                        {t('cancel')}
                      </button>
                    </div>
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
