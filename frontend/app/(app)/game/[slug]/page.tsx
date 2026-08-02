'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useGameBySlug } from '@/hooks/useGames';
import { useBalance } from '@/hooks/useWallet';
import { useAuthStore } from '@/store/auth';
import { api, apiError } from '@/lib/api';
import { Spinner } from '@/components/ui/spinner';

const PROVIDER = 'html5';

// Messages the iframe can post to us
type GameMessage =
  | { type: 'PLACE_BET'; roundId: string; amount: string }
  | { type: 'GAME_WIN'; roundId: string; amount: string }
  | { type: 'REFUND_ROUND'; roundId: string; amount: string }
  | { type: 'GET_BALANCE' }
  | { type: 'GAME_OVER' };

export default function GamePage({ params }: { params: { slug: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sessionId = searchParams.get('session');
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const { data: game, isLoading: gameLoading } = useGameBySlug(params.slug);
  const { data: balance, refetch: refetchBalance } = useBalance();

  const [launchUrl, setLaunchUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadingIframe, setLoadingIframe] = useState(true);

  // Resolve launch URL from existing session
  useEffect(() => {
    if (!sessionId || !user) return;
    api
      .post(`/provider/${PROVIDER}/sessions/${sessionId}/launch`)
      .then((r) => setLaunchUrl(r.data.iframeUrl ?? r.data.launchUrl ?? r.data.url ?? ''))
      .catch((e) => setError(apiError(e)));
  }, [sessionId, user]);

  const postToGame = useCallback((msg: object) => {
    iframeRef.current?.contentWindow?.postMessage(msg, '*');
  }, []);

  const handleExit = useCallback(async () => {
    router.push('/lobby');
    queryClient.invalidateQueries({ queryKey: ['balance', user?.id] });
  }, [router, queryClient, user?.id]);

  // PostMessage bridge
  useEffect(() => {
    const handler = async (event: MessageEvent) => {
      const msg = event.data as GameMessage;
      if (!msg?.type) return;

      try {
        switch (msg.type) {
          case 'GET_BALANCE': {
            const res = await api.get(`/wallets/user/${user!.id}/balance`);
            postToGame({ type: 'BALANCE_UPDATE', balance: res.data.balance, currency: res.data.currency });
            break;
          }
          case 'PLACE_BET': {
            const res = await api.post(`/provider/${PROVIDER}/events/bet`, {
              sessionId,
              roundId: msg.roundId,
              amount: msg.amount,
            });
            const bal = await refetchBalance();
            postToGame({
              type: 'BET_CONFIRMED',
              roundId: msg.roundId,
              balance: bal.data?.balance,
              transactionId: res.data?.transactionId,
            });
            break;
          }
          case 'GAME_WIN': {
            await api.post(`/provider/${PROVIDER}/events/win`, {
              sessionId,
              roundId: msg.roundId,
              amount: msg.amount,
            });
            const bal = await refetchBalance();
            postToGame({
              type: 'WIN_CONFIRMED',
              roundId: msg.roundId,
              balance: bal.data?.balance,
            });
            break;
          }
          case 'REFUND_ROUND': {
            await api.post(`/provider/${PROVIDER}/events/refund`, {
              sessionId,
              roundId: msg.roundId,
              amount: msg.amount,
            });
            const bal = await refetchBalance();
            postToGame({ type: 'REFUND_CONFIRMED', roundId: msg.roundId, balance: bal.data?.balance });
            break;
          }
          case 'GAME_OVER': {
            await handleExit();
            break;
          }
        }
      } catch (err) {
        postToGame({ type: 'ERROR', message: apiError(err) });
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [sessionId, user, postToGame, refetchBalance, handleExit]);

  if (gameLoading || (!launchUrl && !error)) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black">
        <Spinner className="h-12 w-12" />
        <p className="text-sm text-gray-400">Loading game…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-black px-4">
        <p className="text-center text-red-400">{error}</p>
        <button onClick={() => router.push('/lobby')} className="text-sm text-amber-400 hover:underline">
          Back to Lobby
        </button>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black">
      {/* HUD */}
      <div className="flex items-center justify-between border-b border-white/10 bg-[#141414] px-4 py-2">
        <button
          onClick={handleExit}
          className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-1.5 text-xs text-gray-400 hover:border-white/30 hover:text-white transition"
        >
          ← Exit
        </button>

        <div className="text-center">
          <p className="text-xs text-gray-500">Now Playing</p>
          <p className="text-sm font-semibold text-white">{game?.name}</p>
        </div>

        <div className="text-right">
          <p className="text-xs text-gray-500">Balance</p>
          <p className="text-base font-bold text-amber-400">
            {balance
  ? `৳ ${parseFloat(balance.balance).toFixed(2)}`
  : '—'}
          </p>
        </div>
      </div>

      {/* Game iframe */}
      <div className="relative flex-1">
        {loadingIframe && (
          <div className="absolute inset-0 flex items-center justify-center bg-black z-10">
            <Spinner className="h-12 w-12" />
          </div>
        )}
        {launchUrl && (
          <iframe
            ref={iframeRef}
            src={launchUrl}
            className="h-full w-full border-0"
            allow="autoplay; fullscreen"
            onLoad={() => setLoadingIframe(false)}
            title={game?.name ?? 'Game'}
          />
        )}
      </div>
    </div>
  );
}
