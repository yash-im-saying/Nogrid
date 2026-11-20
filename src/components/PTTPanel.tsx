import React, {useEffect, useRef, useState} from 'react';
import {Headphones, Mic, MicOff, Radio, Volume2} from 'lucide-react';
import {
  playEncryptedAudioClip,
  type PttRecorderSession,
  startPttCapture,
} from '../lib/audioCodec';
import {
  BurnTimerOption,
  type ChannelKeyState,
  PacketType,
  type TacticalMessage,
} from '../types/tactical';

interface PTTPanelProps {
  channelKey: ChannelKeyState | null;
  messages: TacticalMessage[];
  pttAutoMonitor: boolean;
  onToggleMonitor: () => void;
  onSendVoice: (
    audioB64: string,
    mimeType: string,
    durationMs: number,
    burn: BurnTimerOption,
  ) => Promise<void>;
  compact?: boolean;
}

export const PTTPanel: React.FC<PTTPanelProps> = ({
  channelKey,
  messages,
  pttAutoMonitor,
  onToggleMonitor,
  onSendVoice,
  compact = false,
}) => {
  const [transmitting, setTransmitting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [vuLevel, setVuLevel] = useState(0);
  const [micError, setMicError] = useState<string | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);

  const sessionRef = useRef<PttRecorderSession | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTsRef = useRef<number>(0);

  const pttClips = messages
    .filter((m) => m.type === PacketType.PTT && m.audioB64 && !m.decryptionError)
    .slice(-3)
    .reverse();

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (sessionRef.current) {
        void sessionRef.current.stop();
        sessionRef.current = null;
      }
    };
  }, []);

  const beginTx = async () => {
    if (transmitting) return;
    setMicError(null);
    try {
      const session = await startPttCapture();
      sessionRef.current = session;
      startTsRef.current = Date.now();
      setTransmitting(true);

      const tick = () => {
        if (!sessionRef.current) return;
        setElapsedMs(Date.now() - startTsRef.current);
        setVuLevel(sessionRef.current.getLevel());
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } catch (err) {
      setMicError(
        err instanceof Error ? err.message : 'Microphone access required for PTT voice.',
      );
      setTransmitting(false);
    }
  };

  const endTx = async () => {
    if (!sessionRef.current) return;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const session = sessionRef.current;
    sessionRef.current = null;
    setTransmitting(false);
    setVuLevel(0);
    setElapsedMs(0);

    const result = await session.stop();
    if (result) {
      await onSendVoice(
        result.audioB64,
        result.mimeType,
        result.durationMs,
        BurnTimerOption.FiveMinutes,
      );
    }
  };

  const handlePlay = async (msg: TacticalMessage) => {
    if (!msg.audioB64) return;
    setPlayingId(msg.id);
    try {
      await playEncryptedAudioClip(msg.audioB64, msg.mimeType);
    } finally {
      setTimeout(() => setPlayingId(null), msg.durationMs ?? 1200);
    }
  };

  const meterBars = 18;
  const activeBars = Math.round(vuLevel * meterBars);

  return (
    <section
      aria-label="Push-to-Talk Radio"
      className="flex flex-col h-full min-h-0 rounded-xl border border-[#32382B] bg-[#161914] overflow-hidden"
    >
      {/* Header */}
      <div className="shrink-0 px-3.5 py-2 border-b border-[#32382B] bg-[#1B1E18] flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Radio className="w-4 h-4 text-[#D99B26] shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <h2 className="font-display text-base font-bold tracking-wide text-[#E6E8E1] truncate">
              Push-to-Talk Radio
            </h2>
            {!compact && (
              <p className="text-[11px] text-[#9AA28E] font-mono-tabular truncate">
                {channelKey?.label ?? 'ALPHA-NET'} · 16 kbps Opus · E2EE
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={onToggleMonitor}
          className={`min-h-[36px] px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
            pttAutoMonitor
              ? 'border-[#6F8F5C] bg-[#1D2618] text-[#9FC28A]'
              : 'border-[#32382B] bg-[#161914] text-[#9AA28E]'
          }`}
          aria-pressed={pttAutoMonitor}
        >
          <Headphones className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>{pttAutoMonitor ? 'Squelch On' : 'Muted'}</span>
        </button>
      </div>

      {/* Main Walkie-Talkie Body */}
      <div className="flex-1 min-h-0 p-3 flex flex-col justify-between gap-2.5">
        {/* VU Meter Strip */}
        <div className="shrink-0 space-y-1.5">
          <div className="flex items-center justify-between text-[11px] font-mono-tabular text-[#9AA28E]">
            <span>{transmitting ? 'TRANSMITTING ENCRYPTED VOICE' : 'STANDBY · SQUELCH READY'}</span>
            <span className={transmitting ? 'text-[#D99B26] font-semibold' : ''}>
              {(elapsedMs / 1000).toFixed(1)}s
            </span>
          </div>
          <div className="grid grid-cols-18 gap-1 h-2.5" aria-hidden="true">
            {Array.from({length: meterBars}).map((_, idx) => {
              const lit = transmitting && idx < activeBars;
              const isPeak = idx >= meterBars - 4;
              return (
                <div
                  key={idx}
                  className={`rounded-xs transition-colors ${
                    lit
                      ? isPeak
                        ? 'bg-[#C84B31]'
                        : 'bg-[#D99B26]'
                      : 'bg-[#252920]'
                  }`}
                />
              );
            })}
          </div>
        </div>

        {/* Center Hold-to-Talk Trigger */}
        <div className="flex-1 min-h-0 flex items-center justify-center">
          <button
            type="button"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              void beginTx();
            }}
            onPointerUp={() => void endTx()}
            onPointerCancel={() => void endTx()}
            onKeyDown={(e) => {
              if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                void beginTx();
              }
            }}
            onKeyUp={(e) => {
              if (e.code === 'Space') {
                e.preventDefault();
                void endTx();
              }
            }}
            className={`w-full max-w-[260px] ${
              compact ? 'h-[78px]' : 'h-[136px]'
            } rounded-2xl border-2 flex flex-col items-center justify-center gap-1.5 font-display tracking-wider transition-all select-none touch-none focus-visible:outline-2 focus-visible:outline-[#D99B26] ${
              transmitting
                ? 'border-[#D99B26] bg-[#302410] text-[#D99B26] scale-[0.98]'
                : 'border-[#4E5A3E] bg-[#1E231A] text-[#E6E8E1] hover:border-[#6F8F5C] active:scale-[0.98]'
            }`}
          >
            {transmitting ? (
              <Mic className="w-7 h-7 text-[#D99B26]" aria-hidden="true" />
            ) : (
              <MicOff className="w-7 h-7 text-[#9AA28E]" aria-hidden="true" />
            )}
            <span className="text-lg font-bold">
              {transmitting ? 'RELEASE TO SEND' : 'HOLD TO TALK'}
            </span>
          </button>
        </div>

        {micError && (
          <p className="text-xs text-[#C84B31] text-center shrink-0">{micError}</p>
        )}

        {/* Recent Voice Bursts */}
        <div className="shrink-0 space-y-1">
          <div className="flex items-center justify-between text-[11px] text-[#9AA28E]">
            <span>Recent Voice Bursts</span>
            <span className="font-mono-tabular">{pttClips.length} Cached</span>
          </div>
          {pttClips.length === 0 ? (
            <p className="text-xs text-[#6B7261] py-1">
              Hold button above or press Spacebar to transmit encrypted audio.
            </p>
          ) : (
            <div className="space-y-1">
              {pttClips.slice(0, compact ? 2 : 3).map((clip) => (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => void handlePlay(clip)}
                  className={`w-full min-h-[38px] px-2.5 py-1 rounded-lg border text-xs flex items-center justify-between gap-2 transition-colors ${
                    playingId === clip.id
                      ? 'border-[#D99B26] bg-[#2B2415] text-[#D99B26]'
                      : 'border-[#32382B] bg-[#1B1E18] text-[#E6E8E1] hover:bg-[#23271F]'
                  }`}
                >
                  <span className="flex items-center gap-2 min-w-0 truncate">
                    <Volume2 className="w-3.5 h-3.5 text-[#D99B26] shrink-0" aria-hidden="true" />
                    <span className="font-mono-tabular truncate">{clip.senderCallsign}</span>
                  </span>
                  <span className="font-mono-tabular text-[#9AA28E] shrink-0">
                    {((clip.durationMs ?? 1000) / 1000).toFixed(1)}s ·{' '}
                    {new Date(clip.createdAt).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
