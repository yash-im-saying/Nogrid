import React, {useEffect, useRef, useState} from 'react';
import {
  Camera,
  CameraOff,
  CheckCircle2,
  Flashlight,
  KeyRound,
  Send,
  Sun,
} from 'lucide-react';
import {base64ToUint8Array, arrayBufferToBase64} from '../lib/crypto';
import {
  encodeOpticalChips,
  OpticalFrameKind,
  OpticalStreamDecoder,
  type OpticalDecoderMetrics,
} from '../lib/opticalModem';
import type {ChannelKeyState} from '../types/tactical';

interface OpticalPanelProps {
  channelKey: ChannelKeyState | null;
  onEncryptMessage: (text: string) => Promise<Uint8Array | null>;
  onDecryptMessage: (bytes: Uint8Array) => Promise<{callsign: string; body: string} | null>;
  onImportChannelKey: (keyBase64: string) => Promise<void>;
}

export const OpticalPanel: React.FC<OpticalPanelProps> = ({
  channelKey,
  onEncryptMessage,
  onDecryptMessage,
  onImportChannelKey,
}) => {
  const [mode, setMode] = useState<'rx' | 'tx'>('rx');
  const [baudRate, setBaudRate] = useState<number>(8);

  // TX state
  const [txPayloadType, setTxPayloadType] = useState<'msg' | 'key'>('msg');
  const [txMessage, setTxMessage] = useState('');
  const [txChips, setTxChips] = useState<number[]>([]);
  const [txIndex, setTxIndex] = useState<number>(0);
  const [txActive, setTxActive] = useState(false);
  const [txLevel, setTxLevel] = useState<0 | 1>(0);
  const [useTorch, setUseTorch] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [txStatus, setTxStatus] = useState<string>('Ready to modulate AES-GCM optical frame');

  // RX state
  const [rxActive, setRxActive] = useState(false);
  const [rxError, setRxError] = useState<string | null>(null);
  const [rxMetrics, setRxMetrics] = useState<OpticalDecoderMetrics>({
    luma: 0,
    contrastDelta: 0,
    signalLocked: false,
    syncFound: false,
    bitsReceived: 0,
    expectedBytes: 0,
  });
  const [rxDecodedResult, setRxDecodedResult] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const rxStreamRef = useRef<MediaStream | null>(null);
  const txTorchStreamRef = useRef<MediaStream | null>(null);
  const rxRafRef = useRef<number | null>(null);
  const txTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const decoderRef = useRef<OpticalStreamDecoder | null>(null);

  const stopRxCamera = () => {
    if (rxRafRef.current) {
      cancelAnimationFrame(rxRafRef.current);
      rxRafRef.current = null;
    }
    if (rxStreamRef.current) {
      rxStreamRef.current.getTracks().forEach((t) => t.stop());
      rxStreamRef.current = null;
    }
    setRxActive(false);
  };

  const stopTxStrobe = () => {
    if (txTimerRef.current) {
      clearInterval(txTimerRef.current);
      txTimerRef.current = null;
    }
    if (txTorchStreamRef.current) {
      txTorchStreamRef.current.getTracks().forEach((t) => t.stop());
      txTorchStreamRef.current = null;
    }
    setTxActive(false);
    setTxLevel(0);
    setTxIndex(0);
  };

  useEffect(() => {
    return () => {
      stopRxCamera();
      stopTxStrobe();
    };
  }, []);

  const startRxCamera = async () => {
    setRxError(null);
    setRxDecodedResult(null);

    if (!navigator.mediaDevices?.getUserMedia) {
      setRxError('Camera API unavailable in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: {ideal: 'environment'},
          width: {ideal: 640},
          height: {ideal: 480},
        },
        audio: false,
      });

      rxStreamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      const decoder = new OpticalStreamDecoder(
        baudRate,
        async (frame) => {
          try {
            if (frame.kind === OpticalFrameKind.ChannelKeyShare) {
              const keyB64 = arrayBufferToBase64(frame.payload);
              await onImportChannelKey(keyB64);
              setRxDecodedResult('Channel key synchronized and verified via Light-Link.');
            } else {
              const res = await onDecryptMessage(frame.payload);
              if (res) {
                setRxDecodedResult(`${res.callsign}: "${res.body}"`);
              } else {
                setRxError('Frame received, but AES-GCM key verification failed.');
              }
            }
          } catch {
            setRxError('AES-GCM decryption failed — mutually agreed key mismatch.');
          }
        },
        (reason) => setRxError(reason),
      );
      decoderRef.current = decoder;
      setRxActive(true);

      const offscreen = sampleCanvasRef.current || document.createElement('canvas');
      sampleCanvasRef.current = offscreen;
      offscreen.width = 32;
      offscreen.height = 32;
      const ctx = offscreen.getContext('2d', {willReadFrequently: true});

      const sampleLoop = () => {
        const video = videoRef.current;
        if (!video || !rxStreamRef.current || !ctx || !decoderRef.current) return;

        if (video.readyState >= 2 && video.videoWidth > 0) {
          const sx = Math.max(0, Math.floor(video.videoWidth / 2 - 24));
          const sy = Math.max(0, Math.floor(video.videoHeight / 2 - 24));
          ctx.drawImage(video, sx, sy, 48, 48, 0, 0, 32, 32);
          const pixels = ctx.getImageData(0, 0, 32, 32).data;
          let lumaSum = 0;
          const total = pixels.length / 4;
          for (let i = 0; i < pixels.length; i += 4) {
            lumaSum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
          }
          const avgLuma = lumaSum / total;
          const metrics = decoderRef.current.pushLumaSample(avgLuma, performance.now());
          setRxMetrics(metrics);
        }

        rxRafRef.current = requestAnimationFrame(sampleLoop);
      };

      rxRafRef.current = requestAnimationFrame(sampleLoop);
    } catch (err) {
      setRxError(
        err instanceof Error
          ? err.message
          : 'Camera permission denied — allow camera to decode optical signals.',
      );
      setRxActive(false);
    }
  };

  const setHardwareTorch = async (track: MediaStreamTrack | null, enabled: boolean) => {
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{torch: enabled} as MediaTrackConstraintSet],
      });
    } catch {
      // Fallback silently to screen strobe
    }
  };

  const startTxStrobe = async () => {
    stopRxCamera();
    stopTxStrobe();
    setTxStatus('Encrypting optical packet...');

    let payloadBytes: Uint8Array | null = null;
    let kind = OpticalFrameKind.EncryptedMessage;

    if (txPayloadType === 'key') {
      if (!channelKey?.keyBase64) {
        setTxStatus('No channel key available.');
        return;
      }
      payloadBytes = base64ToUint8Array(channelKey.keyBase64);
      kind = OpticalFrameKind.ChannelKeyShare;
    } else {
      const clean = txMessage.trim();
      if (!clean) {
        setTxStatus('Enter a short message to strobe.');
        return;
      }
      payloadBytes = await onEncryptMessage(clean);
    }

    if (!payloadBytes) {
      setTxStatus('Encryption failed.');
      return;
    }

    const chips = encodeOpticalChips(kind, payloadBytes);
    setTxChips(chips);
    setTxIndex(0);
    setTxActive(true);
    setTxStatus(
      `Transmitting ${payloadBytes.length}B AES-GCM payload (${chips.length} chips @ ${baudRate} bps)`,
    );

    let torchTrack: MediaStreamTrack | null = null;
    if (useTorch && navigator.mediaDevices?.getUserMedia) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({
          video: {facingMode: {ideal: 'environment'}},
        });
        txTorchStreamRef.current = s;
        const track = s.getVideoTracks()[0];
        const caps = track?.getCapabilities?.() as {torch?: boolean} | undefined;
        if (caps?.torch) {
          torchTrack = track;
          setTorchSupported(true);
        } else {
          setTorchSupported(false);
          s.getTracks().forEach((t) => t.stop());
          txTorchStreamRef.current = null;
        }
      } catch {
        setTorchSupported(false);
      }
    }

    const chipPeriodMs = 1000 / (baudRate * 2);
    let idx = 0;

    txTimerRef.current = setInterval(() => {
      if (idx >= chips.length) {
        void setHardwareTorch(torchTrack, false);
        stopTxStrobe();
        setTxStatus('Optical frame transmission complete');
        return;
      }
      const bit = (chips[idx] ? 1 : 0) as 0 | 1;
      setTxLevel(bit);
      setTxIndex(idx + 1);
      if (torchTrack) {
        void setHardwareTorch(torchTrack, bit === 1);
      }
      idx++;
    }, chipPeriodMs);
  };

  return (
    <section
      aria-label="Optical Light-Link Transceiver"
      className="flex flex-col h-full min-h-0 rounded-xl border border-[#32382B] bg-[#161914] overflow-hidden"
    >
      {/* Header + Mode Switch */}
      <div className="shrink-0 px-3.5 py-2.5 border-b border-[#32382B] bg-[#1B1E18] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold tracking-wide text-[#E6E8E1] truncate">
            Optical Light-Link
          </h2>
          <p className="text-[11px] text-[#9AA28E] font-mono-tabular truncate">
            Manchester OOK · CRC-8 · AES-256-GCM
          </p>
        </div>

        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#111310] border border-[#32382B] shrink-0">
          <button
            type="button"
            onClick={() => {
              stopTxStrobe();
              setMode('rx');
            }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'rx'
                ? 'bg-[#4E5A3E] text-[#E6E8E1]'
                : 'text-[#9AA28E] hover:text-[#E6E8E1]'
            }`}
          >
            Camera RX
          </button>
          <button
            type="button"
            onClick={() => {
              stopRxCamera();
              setMode('tx');
            }}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
              mode === 'tx'
                ? 'bg-[#D99B26] text-[#111310] font-semibold'
                : 'text-[#9AA28E] hover:text-[#E6E8E1]'
            }`}
          >
            Strobe TX
          </button>
        </div>
      </div>

      {mode === 'rx' ? (
        <div className="flex-1 min-h-0 p-3 flex flex-col justify-between gap-2.5">
          {/* Camera Sensor Reticle Viewport */}
          <div className="flex-1 min-h-0 relative rounded-lg border border-[#32382B] bg-[#0C0D0B] overflow-hidden flex items-center justify-center">
            <video
              ref={videoRef}
              playsInline
              muted
              className={`w-full h-full object-cover ${rxActive ? 'opacity-100' : 'opacity-20'}`}
            />

            {/* Center Luminance Reticle */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className={`w-20 h-20 rounded-lg border-2 flex items-center justify-center ${
                  rxMetrics.syncFound
                    ? 'border-[#D99B26]'
                    : rxMetrics.signalLocked
                      ? 'border-[#6F8F5C]'
                      : 'border-[#E6E8E1]/50'
                }`}
              >
                <div className="w-2 h-2 rounded-full bg-[#D99B26]" />
              </div>
            </div>

            {!rxActive && (
              <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center">
                <Camera className="w-8 h-8 text-[#9AA28E] mb-2" aria-hidden="true" />
                <p className="text-xs text-[#E6E8E1] font-medium">
                  Aim camera reticle at peer flashlight or screen strobe
                </p>
                <p className="text-[11px] text-[#9AA28E] mt-1">
                  Decodes encrypted text bursts or shared 256-bit keys air-gapped.
                </p>
              </div>
            )}
          </div>

          {/* Real-Time Optical Telemetry */}
          <div className="shrink-0 grid grid-cols-3 gap-2 text-[11px] font-mono-tabular border border-[#32382B] rounded-lg bg-[#1B1E18] px-2.5 py-2">
            <div>
              <span className="text-[#9AA28E] block">Luma</span>
              <span className="text-[#E6E8E1] font-semibold">{rxMetrics.luma}</span>
            </div>
            <div>
              <span className="text-[#9AA28E] block">Contrast</span>
              <span className="text-[#E6E8E1] font-semibold">
                {rxMetrics.contrastDelta} {rxMetrics.signalLocked ? '(LOCK)' : ''}
              </span>
            </div>
            <div>
              <span className="text-[#9AA28E] block">Frame</span>
              <span className="text-[#D99B26] font-semibold">
                {rxMetrics.syncFound
                  ? `${rxMetrics.bitsReceived}b`
                  : 'Waiting'}
              </span>
            </div>
          </div>

          {rxDecodedResult && (
            <div className="shrink-0 p-2 rounded-lg border border-[#6F8F5C] bg-[#1D2618] text-xs text-[#E6E8E1] flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[#9FC28A] shrink-0" aria-hidden="true" />
              <span className="truncate">{rxDecodedResult}</span>
            </div>
          )}

          {rxError && (
            <p className="shrink-0 text-xs text-[#C84B31] truncate">{rxError}</p>
          )}

          <div className="shrink-0 flex items-center gap-2">
            <select
              value={baudRate}
              onChange={(e) => setBaudRate(Number(e.target.value))}
              aria-label="Optical baud rate"
              className="min-h-[44px] px-2.5 rounded-lg border border-[#32382B] bg-[#1B1E18] font-mono-tabular text-xs text-[#E6E8E1]"
            >
              <option value={8}>8 bps</option>
              <option value={16}>16 bps</option>
            </select>

            <button
              type="button"
              onClick={() => (rxActive ? stopRxCamera() : void startRxCamera())}
              className={`flex-1 min-h-[44px] px-4 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 transition-colors ${
                rxActive
                  ? 'bg-[#2F1915] border border-[#C84B31] text-[#F2A696]'
                  : 'bg-[#4E5A3E] text-[#E6E8E1] hover:bg-[#5B6949]'
              }`}
            >
              {rxActive ? (
                <>
                  <CameraOff className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Stop Camera RX</span>
                </>
              ) : (
                <>
                  <Camera className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Arm Camera RX</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 p-3 flex flex-col justify-between gap-2.5">
          {/* Payload Selector */}
          <div className="shrink-0 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setTxPayloadType('msg')}
                className={`min-h-[38px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                  txPayloadType === 'msg'
                    ? 'border-[#D99B26] bg-[#2B2415] text-[#D99B26]'
                    : 'border-[#32382B] bg-[#1B1E18] text-[#9AA28E]'
                }`}
              >
                <Send className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Encrypted Text</span>
              </button>
              <button
                type="button"
                onClick={() => setTxPayloadType('key')}
                className={`min-h-[38px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                  txPayloadType === 'key'
                    ? 'border-[#D99B26] bg-[#2B2415] text-[#D99B26]'
                    : 'border-[#32382B] bg-[#1B1E18] text-[#9AA28E]'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Share Net Key</span>
              </button>
            </div>

            {txPayloadType === 'msg' ? (
              <input
                type="text"
                value={txMessage}
                onChange={(e) => setTxMessage(e.target.value)}
                maxLength={120}
                placeholder="Short encrypted light-link text..."
                className="w-full min-h-[42px] px-3 rounded-lg border border-[#32382B] bg-[#111310] text-sm text-[#E6E8E1] placeholder-[#6B7261] focus:outline-none focus:border-[#D99B26]"
              />
            ) : (
              <div className="px-3 py-2 rounded-lg border border-[#32382B] bg-[#1B1E18] text-xs font-mono-tabular text-[#9AA28E]">
                Transmits 256-bit key #{channelKey?.keyHash ?? '0000'} optically for zero-RF pairing.
              </div>
            )}
          </div>

          {/* Optical Strobe Emitter Panel */}
          <div
            className={`flex-1 min-h-[110px] rounded-xl border-2 flex flex-col items-center justify-center p-4 transition-none ${
              txActive
                ? txLevel === 1
                  ? 'border-white bg-white text-black'
                  : 'border-[#32382B] bg-black text-[#9AA28E]'
                : 'border-[#32382B] bg-[#0D0E0C] text-[#9AA28E]'
            }`}
          >
            <Sun
              className={`w-10 h-10 mb-2 ${
                txActive && txLevel === 1 ? 'text-black' : 'text-[#D99B26]'
              }`}
              aria-hidden="true"
            />
            <p className="font-mono-tabular text-xs font-semibold text-center">
              {txActive
                ? `STROBE ${txLevel === 1 ? 'HIGH' : 'LOW'} · ${txIndex}/${txChips.length}`
                : txStatus}
            </p>
          </div>

          {/* TX Controls */}
          <div className="shrink-0 space-y-2">
            <div className="flex items-center justify-between gap-2 text-xs">
              <label className="flex items-center gap-2 text-[#9AA28E] cursor-pointer">
                <input
                  type="checkbox"
                  checked={useTorch}
                  onChange={(e) => setUseTorch(e.target.checked)}
                  className="accent-[#D99B26] w-4 h-4"
                />
                <Flashlight className="w-3.5 h-3.5 text-[#D99B26]" aria-hidden="true" />
                <span>
                  Hardware Torch {useTorch && !torchSupported ? '(if supported)' : ''}
                </span>
              </label>

              <select
                value={baudRate}
                onChange={(e) => setBaudRate(Number(e.target.value))}
                aria-label="Strobe baud rate"
                className="px-2 py-1 rounded border border-[#32382B] bg-[#1B1E18] font-mono-tabular text-xs text-[#E6E8E1]"
              >
                <option value={8}>8 bps</option>
                <option value={16}>16 bps</option>
              </select>
            </div>

            <button
              type="button"
              onClick={() => (txActive ? stopTxStrobe() : void startTxStrobe())}
              className={`w-full min-h-[44px] px-4 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 ${
                txActive
                  ? 'bg-[#2F1915] border border-[#C84B31] text-[#F2A696]'
                  : 'bg-[#D99B26] text-[#111310] hover:bg-[#E5AA38]'
              }`}
            >
              <Sun className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{txActive ? 'Abort Transmission' : 'Transmit Optical Strobe'}</span>
            </button>
          </div>
        </div>
      )}
    </section>
  );
};
