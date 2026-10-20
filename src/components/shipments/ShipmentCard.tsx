// components/shipments/ShipmentCard.tsx
'use client';

import Link from 'next/link';
import { ArrowRight, Check, Copy } from 'lucide-react';
import {
  shipmentStatusBadge,
  stroopsToUsdc,
  timeAgo,
  shortAddress,
  shipmentProgress,
} from '@/lib/utils';
import type { Shipment } from '@/types';

export function ShipmentCard({
  shipment,
  selected = false,
  onSelect,
}: {
  shipment: Shipment;
  selected?: boolean;
  onSelect?: (selected: boolean) => void;
}) {
  const progress = shipmentProgress(shipment.milestones);
  const totalUsdc = stroopsToUsdc(shipment.totalAmount);
  const releasedUsdc = stroopsToUsdc(shipment.releasedAmount);

  return (
    <div className="card p-5 hover:shadow-md hover:border-gray-200 transition-all cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-start gap-3 min-w-0">
          {onSelect && (
            <button
              type="button"
              aria-label={`${selected ? 'Deselect' : 'Select'} shipment ${shipment.id}`}
              aria-pressed={selected}
              onClick={() => onSelect(!selected)}
              className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border transition-colors ${selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-gray-300 bg-white text-transparent hover:border-brand-400'}`}
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          )}
          <Link
            href={`/dashboard/shipments/${shipment.id}`}
            className="min-w-0"
          >
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-sm font-semibold text-gray-900 font-mono">
                  {shipment.id}
                </span>
                <span className={shipmentStatusBadge(shipment.status)}>
                  {shipment.status}
                </span>
              </div>
              <p className="text-xs text-gray-400">
                Supplier: {shortAddress(shipment.supplierAddress)} ·{' '}
                {timeAgo(shipment.createdAt)}
              </p>
            </div>
          </Link>
        </div>
        <div className="flex items-start gap-2">
          <Link
            href={`/dashboard/shipments/${shipment.id}`}
            className="text-right"
          >
            <p className="text-sm font-semibold text-gray-900">${totalUsdc}</p>
            <p className="text-xs text-gray-400">${releasedUsdc} released</p>
          </Link>
          <Link
            href={`/dashboard/shipments/create?from=${encodeURIComponent(shipment.id)}`}
            aria-label={`Duplicate shipment ${shipment.id}`}
            title="Duplicate shipment"
            className="p-1.5 text-gray-400 hover:text-brand-600 rounded-lg hover:bg-brand-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2"
          >
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>

      <Link href={`/dashboard/shipments/${shipment.id}`}>
        {/* Progress bar */}
        <div className="w-full bg-gray-100 rounded-full h-1.5 mb-2" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label={`${progress}% complete`}>
          <div
            className="bg-brand-600 h-1.5 rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="flex items-center justify-between">
          <p className="text-xs text-gray-400">
            {
              shipment.milestones.filter(
                (m) => m.status === 'Confirmed' || m.status === 'Resolved',
              ).length
            }
            /{shipment.milestones.length} milestones done
          </p>
          <ArrowRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-brand-600 transition-colors" aria-hidden="true" />
        </div>
      </Link>
    </div>
  );
}
