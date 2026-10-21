'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { ArrowLeft, RefreshCw, Loader2, Printer, XCircle, Copy } from 'lucide-react';
import Link from 'next/link';
import { shipmentsApi } from '@/lib/api/services';
import { cancelShipment } from '@/lib/stellar/contract';
import { useAuthStore } from '@/lib/hooks/use-auth-store';
import { MilestoneTimeline } from '@/components/milestones/MilestoneTimeline';
import { ShipmentMeta } from '@/components/shipments/ShipmentMeta';
import { ShipmentProgress } from '@/components/shipments/ShipmentProgress';
import { ShipmentComments } from '@/components/shipments/ShipmentComments';
import { EscrowBalanceCard } from '@/components/shipments/EscrowBalanceCard';
import { shipmentStatusBadge, timeAgo, deriveUserRole, roleBadge, stroopsToUsdc } from '@/lib/utils';
import { usePolling } from '@/lib/hooks/use-polling';
import type { Shipment } from '@/types';

const POLL_INTERVAL_MS = 15_000;

/** Freighter surfaces a declined signature as an error, e.g. "Freighter: The user rejected this request." */
function isWalletRejection(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /reject|declin|denied|cancell?ed by (the )?user/i.test(message);
}

/** Remaining escrow (total - released) formatted as USDC; never NaN */
function remainingEscrowUsdc(shipment: Shipment): string {
  try {
    const remaining = BigInt(shipment.totalAmount) - BigInt(shipment.releasedAmount);
    return stroopsToUsdc(remaining > 0n ? remaining : 0n);
  } catch {
    return stroopsToUsdc(0n);
  }
}

export default function ShipmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { address } = useAuthStore();
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelStep, setCancelStep] = useState<'signing' | 'syncing' | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const loadingRef = useRef<HTMLDivElement>(null);
  const fetchShipment = useCallback(async (isBackground = false) => {
    if (!isBackground) setLoading(true);
    try {
      const data = await shipmentsApi.get(id);
      setShipment(data);
      setLastUpdated(new Date());
      setSecondsAgo(0);
      return data;
    } catch (err) {
      console.error(err);
      return null;
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, [id]);

  usePolling(async () => {
    await fetchShipment(true);
  }, POLL_INTERVAL_MS, {
    enabled: shipment?.status === 'Active',
  });

  useEffect(() => {
    void fetchShipment(false);
  }, [fetchShipment]);

  useEffect(() => {
    if (!lastUpdated) return;
    const tick = setInterval(() => {
      setSecondsAgo(Math.floor((Date.now() - lastUpdated.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(tick);
  }, [lastUpdated]);

  useEffect(() => {
    if (loading && loadingRef.current) {
      loadingRef.current.focus();
    }
  }, [loading]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await shipmentsApi.sync(id);
      await fetchShipment(true);
      setBalanceRefreshKey((k) => k + 1);
    } finally {
      setSyncing(false);
    }
  };

  const onMilestoneUpdate = () => {
    fetchShipment(true);
    setBalanceRefreshKey((k) => k + 1);
  };

  const openCancelModal = () => {
    setCancelError(null);
    setShowCancelModal(true);
  };

  const handleConfirmCancel = async () => {
    if (cancelStep) return;
    if (!address) {
      setCancelError('Connect your Freighter wallet to cancel this shipment.');
      return;
    }
    setCancelError(null);
    setCancelStep('signing');
    try {
      // Sign and submit cancel_shipment via Freighter; resolves once confirmed on-chain
      await cancelShipment({ callerAddress: address, shipmentId: id });
    } catch (err) {
      console.error(err);
      setCancelStep(null);
      if (isWalletRejection(err)) {
        setCancelError('Transaction rejected in Freighter. The shipment was not cancelled.');
      } else {
        const detail = err instanceof Error ? err.message : null;
        setCancelError(
          `Failed to cancel shipment on-chain${detail ? `: ${detail}` : '.'} Please try again.`,
        );
      }
      return;
    }

    setCancelStep('syncing');
    try {
      await shipmentsApi.sync(id);
    } catch (err) {
      // The on-chain cancellation already succeeded; the backend will catch up on the next sync
      console.error(err);
    }
    await fetchShipment(true);
    setBalanceRefreshKey((k) => k + 1);
    setCancelStep(null);
    setShowCancelModal(false);
    setToast({ type: 'success', message: 'Shipment cancelled and escrow refunded.' });
  };

  if (loading) {
    return (
      <div ref={loadingRef} className="flex items-center justify-center h-64" tabIndex={-1} role="status" aria-live="polite" aria-label="Loading shipment details">
        <Loader2 className="w-6 h-6 text-gray-400 animate-spin" aria-hidden="true" />
      </div>
    );
  }

  if (!shipment) {
    return (
      <div className="text-center py-16">
        <p className="text-gray-500">Shipment not found.</p>
        <Link
          href="/dashboard/shipments"
          className="btn-secondary mt-4 inline-flex"
        >
          Back to shipments
        </Link>
      </div>
    );
  }

  const userRole = deriveUserRole(address, shipment);
  const role = roleBadge(userRole);

  const isBuyer = userRole === 'buyer';
  const isActive = shipment.status === 'Active';
  const blockingMilestone = shipment.milestones?.find(
    (m) => m.status === 'ProofSubmitted' || m.status === 'Disputed'
  );
  const cancelDisabledReason = blockingMilestone
    ? `Cannot cancel while a milestone is ${blockingMilestone.status}.`
    : null;
  const canCancel = isBuyer && isActive && !cancelDisabledReason;
  const refundAmount = remainingEscrowUsdc(shipment);
  const cancelling = cancelStep !== null;

  return (
    <div>
      {/* Back nav */}
      <Link
        href="/dashboard/shipments"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 mb-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
      >
        <ArrowLeft className="w-4 h-4" />
        All shipments
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-5">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <h1 className="text-xl font-semibold text-gray-900">
              {shipment.id}
            </h1>
            <span className={shipmentStatusBadge(shipment.status)}>
              {shipment.status}
            </span>
            <span
              className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${role.className}`}
            >
              {userRole === "observer"
                ? role.label
                : `Your role: ${role.label}`}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-xs text-gray-400">
              Created {timeAgo(shipment.createdAt)}
            </p>
            {lastUpdated && (
              <p className="text-xs text-gray-300">
                Last updated:{" "}
                {secondsAgo < 5 ? "just now" : `${secondsAgo}s ago`}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href={`/dashboard/shipments/create?from=${encodeURIComponent(shipment.id)}`}
            title="Create a new shipment prefilled with this shipment's parties, amount and milestones"
            className="btn-secondary text-xs"
          >
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            Duplicate
          </Link>
          {isBuyer && isActive && (
            <button
              onClick={openCancelModal}
              disabled={!canCancel}
              title={cancelDisabledReason ?? 'Cancel this shipment and refund the remaining escrow'}
              aria-label="Cancel shipment"
              className="btn-secondary text-xs text-red-600 hover:text-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
              Cancel shipment
            </button>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            aria-label={syncing ? 'Syncing from chain' : 'Sync from chain'}
            className="btn-secondary text-xs"
          >
            {syncing ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Sync from chain
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <ShipmentProgress shipment={shipment} />

      {/* Live on-chain escrow balance */}
      <div className="mt-5">
        <EscrowBalanceCard
          shipment={shipment}
          refreshKey={balanceRefreshKey}
          onSynced={() => fetchShipment(true)}
        />
      </div>

      {/* Milestones */}
      <div className="mt-5">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">Milestones</h2>
        <MilestoneTimeline
          shipment={shipment}
          userRole={userRole}
          onUpdate={onMilestoneUpdate}
        />
      </div>

      {/* Discussion & Notes Thread */}
      <div className="mt-5">
        <ShipmentComments
          shipment={shipment}
          userRole={userRole}
          currentUserAddress={address}
        />
      </div>

      {/* Meta */}
      <div className="mt-5">
        <ShipmentMeta shipment={shipment} />
      </div>

      {/* Cancel confirmation modal */}
      {showCancelModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-shipment-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2 id="cancel-shipment-title" className="text-base font-semibold text-gray-900">
              Cancel shipment?
            </h2>
            <p className="mt-2 text-sm text-gray-600">
              This will cancel the shipment and refund the remaining escrow balance to you.
            </p>
            <div className="mt-4 rounded-md bg-gray-50 p-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Refund amount</span>
                <span className="font-semibold text-gray-900">
                  {refundAmount} USDC
                </span>
              </div>
            </div>
            {cancelError && (
              <p className="mt-3 text-sm text-red-600" role="alert">
                {cancelError}
              </p>
            )}
            <div className="mt-5 flex items-center justify-end gap-2">
              {cancelStep && (
                <span className="mr-auto text-xs text-gray-500" aria-live="polite">
                  {cancelStep === 'signing' ? 'Waiting for Freighter…' : 'Syncing shipment…'}
                </span>
              )}
              <button
                onClick={() => setShowCancelModal(false)}
                disabled={cancelling}
                className="btn-secondary text-xs"
              >
                Keep shipment
              </button>
              <button
                onClick={handleConfirmCancel}
                disabled={cancelling}
                className="btn-primary text-xs bg-red-600 hover:bg-red-700"
              >
                {cancelling ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                Confirm cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 rounded-md px-4 py-2 text-sm text-white shadow-lg ${
            toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
