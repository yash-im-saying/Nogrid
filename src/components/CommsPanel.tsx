import React, {useEffect, useRef, useState} from 'react';
import {
  Clock,
  Eye,
  Flame,
  Lock,
  MapPin,
  Send,
  Trash2,
  Volume2,
} from 'lucide-react';
import {playEncryptedAudioClip} from '../lib/audioCodec';
import {
  BurnTimerOption,
  type ChannelKeyState,
  type IdentityProfile,
  PacketType,
  SyncState,
  type TacticalMessage,
} from '../types/tactical';

interface CommsPanelProps {
  identity: IdentityProfile | null;
  channelKey: ChannelKeyState | null;
  messages: TacticalMessage[];
  onSendText: (text: string, burn: BurnTimerOption) => Promise<void>;
  onRevealBurnMessage: (id: string) => Promise<void>;
  onWipeHistory: () => Promise<void>;
  onFocusMapFix?: () => void;
}

const BURN_OPTIONS: Array<{label: string; value: BurnTimerOption}> = [
  {label: '10s', value: BurnTimerOption.TenSeconds},
  {label: '30s', value: BurnTimerOption.ThirtySeconds},
  {label: '5m', value: BurnTimerOption.FiveMinutes},
  {label: 'Read', value: BurnTimerOption.BurnOnRead},
  {label: 'Keep', value: BurnTimerOption.Persistent},
];

export const CommsPanel: React.FC<CommsPanelProps> = ({
  identity,
  channelKey,
  messages,
  onSendText,
  onRevealBurnMessage,
  onWipeHistory,
  onFocusMapFix,
}) => {
  const [draft, setDraft] = useState('');
  const [burn, setBurn] = useState<BurnTimerOption>(BurnTimerOption.ThirtySeconds);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending) return;
    setSending(true);
    try {
      await onSendText(trimmed, burn);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  const formatRemaining = (msg: TacticalMessage): string | null => {
    if (msg.burnOnRead && msg.readAt === null) return 'Burn on read';
    if (msg.expiresAt === null) return null;
    const sec = Math.max(0, Math.ceil((msg.expiresAt - nowMs) / 1000));
    if (sec >= 60) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return `${m}m ${s.toString().padStart(2, '0')}s`;
    }
    return `${sec}s`;
  };

  return (
    <section
      aria-label="Encrypted Comms"
      className="flex flex-col h-full min-h-0 rounded-xl border border-[#32382B] bg-[#161914] overflow-hidden"
    >
      {/* Panel Header */}
      <div className="shrink-0 px-3.5 py-2.5 border-b border-[#32382B] flex items-center justify-between gap-2 bg-[#1B1E18]">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold tracking-wide text-[#E6E8E1] truncate">
            Encrypted Comms
          </h2>
          <p className="text-[11px] text-[#9AA28E] font-mono-tabular truncate">
            {channelKey?.label ?? 'ALPHA-NET'} · Key #{channelKey?.keyHash ?? '0000'} · AES-256
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            if (!confirmWipe) {
              setConfirmWipe(true);
              setTimeout(() => setConfirmWipe(false), 3000);
            } else {
              setConfirmWipe(false);
              void onWipeHistory();
            }
          }}
          className={`min-h-[36px] px-2.5 py-1.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
            confirmWipe
              ? 'border-[#C84B31] bg-[#2F1915] text-[#F2A696]'
              : 'border-[#32382B] bg-[#161914] text-[#9AA28E] hover:text-[#E6E8E1]'
          }`}
          title="Securely wipe local encrypted history"
        >
          <Trash2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{confirmWipe ? 'Confirm Wipe' : 'Purge'}</span>
        </button>
      </div>

      {/* Message Feed */}
      <div
        ref={listRef}
        className="flex-1 min-h-0 overflow-y-auto tactical-scroll p-3 space-y-2.5"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-4">
            <Lock className="w-7 h-7 text-[#4E5A3E] mb-2" aria-hidden="true" />
            <p className="text-sm font-medium text-[#E6E8E1]">Channel Clear · End-to-End Encrypted</p>
            <p className="text-xs text-[#9AA28E] mt-1 max-w-xs">
              Messages encrypt locally with AES-256-GCM before transmission and purge automatically when burn timers expire.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const isSelf = msg.senderId === identity?.id;
            const remaining = formatRemaining(msg);
            const isHiddenBurn = msg.burnOnRead && msg.readAt === null && !isSelf;
            const isUrgent =
              msg.expiresAt !== null && msg.expiresAt - nowMs <= 10000;

            return (
              <div
                key={msg.id}
                className={`rounded-lg border p-2.5 ${
                  isSelf
                    ? 'border-[#4E5A3E] bg-[#1E231A] ml-4'
                    : 'border-[#32382B] bg-[#1B1E18] mr-4'
                }`}
              >
                {/* Unboxed metadata header */}
                <div className="flex items-center justify-between gap-2 text-[11px] text-[#9AA28E] mb-1">
                  <div className="flex items-center gap-1.5 min-w-0 truncate">
                    <span className="font-mono-tabular font-semibold text-[#E6E8E1]">
                      {isSelf ? `${msg.senderCallsign} (You)` : msg.senderCallsign}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono-tabular">
                      {new Date(msg.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      {msg.syncState === SyncState.Queued
                        ? 'Queued Offline'
                        : msg.transportTag === 'optical-rx'
                          ? 'Optical RX'
                          : msg.transportTag === 'local-tab'
                            ? 'Local Mesh'
                            : 'Synced'}
                    </span>
                  </div>

                  {remaining && (
                    <span
                      className={`font-mono-tabular flex items-center gap-1 shrink-0 ${
                        isUrgent ? 'text-[#C84B31] font-semibold' : 'text-[#D99B26]'
                      }`}
                    >
                      <Flame className="w-3 h-3 shrink-0" aria-hidden="true" />
                      <span>{remaining}</span>
                    </span>
                  )}
                </div>

                {/* Payload Body */}
                {msg.decryptionError ? (
                  <p className="text-xs text-[#C84B31]">
                    Decryption failed — channel key mismatch.
                  </p>
                ) : isHiddenBurn ? (
                  <button
                    type="button"
                    onClick={() => void onRevealBurnMessage(msg.id)}
                    className="w-full min-h-[40px] rounded-md border border-[#D99B26]/60 bg-[#252116] px-3 py-1.5 text-xs font-medium text-[#D99B26] flex items-center justify-center gap-2 hover:bg-[#302919]"
                  >
                    <Eye className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>Tap to Decrypt (Burns in 5s)</span>
                  </button>
                ) : msg.type === PacketType.PTT && msg.audioB64 ? (
                  <button
                    type="button"
                    onClick={() => void playEncryptedAudioClip(msg.audioB64!, msg.mimeType)}
                    className="min-h-[40px] px-3 py-1.5 rounded-md border border-[#4E5A3E] bg-[#161914] text-xs font-medium text-[#E6E8E1] flex items-center gap-2 hover:bg-[#23271F]"
                  >
                    <Volume2 className="w-4 h-4 text-[#D99B26] shrink-0" aria-hidden="true" />
                    <span>
                      Voice Burst · {((msg.durationMs ?? 1000) / 1000).toFixed(1)}s
                    </span>
                  </button>
                ) : msg.type === PacketType.Beacon && msg.coords ? (
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs text-[#E6E8E1] font-mono-tabular">
                      <span className="text-[#9AA28E] mr-1.5">GRID</span>
                      {msg.coords.mgrs}
                    </div>
                    {onFocusMapFix && (
                      <button
                        type="button"
                        onClick={onFocusMapFix}
                        className="min-h-[34px] px-2.5 py-1 rounded border border-[#32382B] text-xs text-[#D99B26] flex items-center gap-1 hover:bg-[#252920] whitespace-nowrap shrink-0"
                      >
                        <MapPin className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Plot</span>
                      </button>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-[#E6E8E1] leading-snug break-words">
                    {msg.body}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Burn Timer + Composer */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="shrink-0 p-2.5 border-t border-[#32382B] bg-[#1B1E18] space-y-2"
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#9AA28E] flex items-center gap-1 whitespace-nowrap shrink-0">
            <Clock className="w-3.5 h-3.5 text-[#D99B26]" aria-hidden="true" />
            <span>Self-Destruct</span>
          </span>
          <div className="flex items-center gap-1 bg-[#111310] p-0.5 rounded-lg border border-[#32382B]">
            {BURN_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setBurn(opt.value)}
                className={`px-2 py-1 rounded-md text-[11px] font-mono-tabular font-medium transition-colors whitespace-nowrap shrink-0 ${
                  burn === opt.value
                    ? 'bg-[#4E5A3E] text-[#E6E8E1]'
                    : 'text-[#9AA28E] hover:text-[#E6E8E1]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Encrypted tactical brief..."
            maxLength={500}
            className="flex-1 min-w-0 min-h-[44px] px-3 rounded-lg border border-[#32382B] bg-[#111310] text-sm text-[#E6E8E1] placeholder-[#6B7261] focus:outline-none focus:border-[#D99B26]"
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending}
            className="min-h-[44px] min-w-[44px] px-4 rounded-lg bg-[#D99B26] text-[#111310] text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-40 hover:bg-[#E5AA38] active:scale-[0.98] transition-all whitespace-nowrap shrink-0"
            aria-label="Send encrypted message"
          >
            <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="hidden sm:inline">Send</span>
          </button>
        </div>
      </form>
    </section>
  );
};
