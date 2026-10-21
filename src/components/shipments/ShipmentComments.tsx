'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  Loader2,
  RefreshCw,
  AlertCircle,
  Lock,
} from 'lucide-react';
import { commentsApi } from '@/lib/api/services';
import { usePolling } from '@/lib/hooks/use-polling';
import {
  deriveUserRole,
  roleBadge,
  timeAgo,
  formatDate,
  cn,
} from '@/lib/utils';
import { StellarLink } from '@/components/StellarLink';
import type { Shipment, Comment } from '@/types';

interface ShipmentCommentsProps {
  shipment: Shipment;
  userRole: string;
  currentUserAddress?: string | null;
  pollInterval?: number;
}

export function ShipmentComments({
  shipment,
  userRole,
  currentUserAddress,
  pollInterval = 15_000,
}: ShipmentCommentsProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [content, setContent] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [postError, setPostError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Determine if the current user is an authorized participant of this shipment
  const isParticipant =
    (userRole !== 'observer' && Boolean(currentUserAddress)) ||
    (Boolean(currentUserAddress) &&
      (currentUserAddress === shipment.buyerAddress ||
        currentUserAddress === shipment.supplierAddress ||
        currentUserAddress === shipment.logisticsAddress ||
        currentUserAddress === shipment.arbiterAddress));

  const fetchComments = useCallback(
    async (isBackground = false) => {
      if (!isBackground) {
        setLoading(true);
      } else {
        setRefreshing(true);
      }
      setError(null);

      try {
        const data = await commentsApi.list(shipment.id);
        // Sort chronologically (oldest first, newest at bottom of discussion thread)
        const sorted = [...(data || [])].sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setComments(sorted);
      } catch (err: unknown) {
        console.error('Failed to load shipment comments:', err);
        if (!isBackground) {
          setError('Failed to load discussion notes. Please try again.');
        }
      } finally {
        if (!isBackground) setLoading(false);
        setRefreshing(false);
      }
    },
    [shipment.id],
  );

  // Initial fetch on mount or shipment ID change
  useEffect(() => {
    fetchComments(false);
  }, [fetchComments]);

  usePolling(() => fetchComments(true), pollInterval, {
    enabled: shipment.status === 'Active',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isParticipant) {
      setPostError('Only shipment participants can post comments.');
      return;
    }

    const trimmed = content.trim();
    if (!trimmed) {
      setPostError('Comment cannot be empty.');
      return;
    }

    if (trimmed.length > 1000) {
      setPostError('Comment exceeds 1,000 characters limit.');
      return;
    }

    setSubmitting(true);
    setPostError(null);

    try {
      const newComment = await commentsApi.create(shipment.id, trimmed);
      setContent('');
      // Optimistically append the created comment if returned
      if (newComment && newComment.id) {
        setComments((prev) => {
          if (prev.some((c) => c.id === newComment.id)) return prev;
          return [...prev, newComment];
        });
      }
      // Re-fetch to ensure complete synchronization
      await fetchComments(true);
    } catch (err: unknown) {
      console.error('Failed to post comment:', err);
      const msg =
        err instanceof Error ? err.message : 'Failed to post comment. Please try again.';
      setPostError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Ctrl+Enter or Cmd+Enter to submit
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!submitting && content.trim() && content.length <= 1000) {
        handleSubmit(e);
      }
    }
  };

  const charCount = content.length;
  const isOverLimit = charCount > 1000;

  return (
    <div className="card p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <MessageSquare className="w-4 h-4 text-brand-600" aria-hidden="true" />
          <h2 className="text-sm font-semibold text-gray-900">
            Discussion &amp; Notes
          </h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
            {comments.length}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => fetchComments(true)}
            disabled={refreshing || loading}
            aria-label={refreshing ? 'Refreshing comments' : 'Refresh comments'}
            className="p-1 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
            title="Refresh comments"
          >
            <RefreshCw
              className={cn('w-3.5 h-3.5', refreshing && 'animate-spin text-brand-600')}
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div
          className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 flex items-center justify-between"
          role="alert"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
          <button
            type="button"
            onClick={() => fetchComments(false)}
            className="font-medium underline hover:text-red-800 ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading ? (
        <div
          className="space-y-3 py-2"
          role="status"
          aria-label="Loading comments"
        >
          {[1, 2].map((i) => (
            <div
              key={i}
              className="flex items-start gap-3 p-3.5 rounded-xl bg-gray-50/70 border border-gray-100 animate-pulse"
            >
              <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-3.5 bg-gray-200 rounded w-16" />
                  <div className="h-3.5 bg-gray-200 rounded w-28" />
                </div>
                <div className="h-3 bg-gray-200 rounded w-full" />
                <div className="h-3 bg-gray-200 rounded w-2/3" />
              </div>
            </div>
          ))}
        </div>
      ) : comments.length === 0 ? (
        /* Empty state */
        <div className="text-center py-8 px-4 rounded-xl bg-gray-50/60 border border-dashed border-gray-200 mb-4">
          <MessageSquare className="w-7 h-7 text-gray-300 mx-auto mb-2" aria-hidden="true" />
          <p className="text-xs font-semibold text-gray-700">No notes or comments yet</p>
          <p className="text-[11px] text-gray-400 max-w-sm mx-auto mt-1 leading-normal">
            {isParticipant
              ? 'Leave updates or coordinate milestone deliveries with counterparties and the arbiter.'
              : 'No notes have been posted on this shipment yet.'}
          </p>
        </div>
      ) : (
        /* Comments list */
        <div
          className="space-y-3 mb-5 max-h-[480px] overflow-y-auto pr-1"
          role="log"
          aria-label="Shipment comments"
          aria-live="polite"
        >
          {comments.map((comment) => {
            const derivedRole = deriveUserRole(comment.authorAddress, shipment);
            const roleInfo = roleBadge(derivedRole);
            const isCurrentUser =
              Boolean(currentUserAddress) &&
              comment.authorAddress.toLowerCase() ===
                currentUserAddress?.toLowerCase();

            return (
              <div
                key={comment.id}
                className={cn(
                  'p-3.5 rounded-xl border transition-colors text-xs',
                  isCurrentUser
                    ? 'bg-blue-50/30 border-blue-100'
                    : 'bg-gray-50/60 border-gray-100',
                )}
              >
                {/* Comment Header: Role badge, Author address, Timestamp */}
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                        roleInfo.className,
                      )}
                    >
                      {roleInfo.label}
                    </span>

                    <StellarLink
                      value={comment.authorAddress}
                      type="account"
                      className="font-mono text-xs text-gray-600 hover:text-brand-600 truncate max-w-[150px] sm:max-w-none"
                    />

                    {isCurrentUser && (
                      <span className="text-[10px] font-medium bg-gray-200/80 text-gray-600 px-1.5 py-0.5 rounded">
                        You
                      </span>
                    )}
                  </div>

                  <span
                    className="text-[11px] text-gray-400 whitespace-nowrap ml-auto"
                    title={formatDate(comment.createdAt)}
                  >
                    {timeAgo(comment.createdAt)}
                  </span>
                </div>

                {/* Plain text content with line breaks preserved safely (no HTML injection) */}
                <p className="text-xs sm:text-sm text-gray-800 whitespace-pre-wrap break-words leading-relaxed font-sans">
                  {comment.content}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {/* Composer Section */}
      {isParticipant ? (
        <form onSubmit={handleSubmit} className="mt-4 pt-3 border-t border-gray-100">
          {postError && (
            <div
              className="mb-3 p-2.5 rounded-lg bg-red-50 border border-red-100 text-xs text-red-700 flex items-center gap-2"
              role="alert"
            >
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
              <span>{postError}</span>
            </div>
          )}

          <div className="relative">
            <label htmlFor="comment-input" className="sr-only">
              Add note or comment
            </label>
            <textarea
              id="comment-input"
              ref={textareaRef}
              rows={3}
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                if (postError) setPostError(null);
              }}
              onKeyDown={handleKeyDown}
              placeholder="Add a note or update for counterparties (plain text, max 1000 chars)..."
              disabled={submitting}
              maxLength={1000}
              className={cn(
                'w-full text-xs sm:text-sm rounded-xl border border-gray-200 bg-white p-3 text-gray-900 placeholder:text-gray-400',
                'focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 transition-colors resize-y min-h-[72px]',
                isOverLimit && 'border-red-300 focus:border-red-500 focus:ring-red-500',
              )}
            />
          </div>

          <div className="flex items-center justify-between mt-2.5">
            <span
              className={cn(
                'text-[11px] tabular-nums',
                isOverLimit
                  ? 'text-red-600 font-medium'
                  : charCount >= 900
                  ? 'text-amber-600'
                  : 'text-gray-400',
              )}
            >
              {charCount} / 1000 characters
            </span>

            <button
              type="submit"
              disabled={submitting || !content.trim() || isOverLimit}
              className="btn-primary text-xs py-1.5 px-3.5 inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Posting...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" aria-hidden="true" />
                  Post note
                </>
              )}
            </button>
          </div>
        </form>
      ) : (
        /* Read-only view for non-participants */
        <div className="mt-4 pt-3 border-t border-gray-100">
          <div className="flex items-center gap-2 rounded-xl bg-gray-50 border border-gray-200/80 px-3.5 py-2.5 text-xs text-gray-500">
            <Lock className="w-4 h-4 text-gray-400 flex-shrink-0" aria-hidden="true" />
            <span>
              Only verified shipment counterparties (Buyer, Supplier, Logistics) and the
              Arbiter can post notes. You are in read-only mode.
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
