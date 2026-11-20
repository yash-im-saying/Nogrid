import {arrayBufferToBase64, base64ToUint8Array} from './crypto';

let sharedAudioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ||
    (window as unknown as {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
  if (!Ctor) return null;
  if (!sharedAudioCtx) {
    sharedAudioCtx = new Ctor();
  }
  if (sharedAudioCtx.state === 'suspended') {
    void sharedAudioCtx.resume();
  }
  return sharedAudioCtx;
}

export function playRadioTone(kind: 'key_up' | 'squelch' | 'rx_beep'): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  if (kind === 'key_up') {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1180, now);
    osc.frequency.exponentialRampToValueAtTime(1480, now + 0.055);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.start(now);
    osc.stop(now + 0.075);
  } else if (kind === 'squelch') {
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.setValueAtTime(660, now + 0.045);
    gain.gain.setValueAtTime(0.07, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    osc.start(now);
    osc.stop(now + 0.12);
  } else {
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1320, now);
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
    osc.start(now);
    osc.stop(now + 0.09);
  }
}

export async function playEncryptedAudioClip(audioB64: string, mimeType = 'audio/webm'): Promise<void> {
  const bytes = base64ToUint8Array(audioB64);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy.buffer], {type: mimeType});
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.onended = () => {
    URL.revokeObjectURL(url);
    playRadioTone('squelch');
  };
  audio.onerror = () => {
    URL.revokeObjectURL(url);
  };
  await audio.play();
}

export interface PttRecorderSession {
  stop: () => Promise<{audioB64: string; mimeType: string; durationMs: number} | null>;
  getLevel: () => number;
}

export async function startPttCapture(): Promise<PttRecorderSession> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone API unavailable in this browser context');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    },
  });

  const preferredMime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
    ? 'audio/webm;codecs=opus'
    : MediaRecorder.isTypeSupported('audio/mp4')
      ? 'audio/mp4'
      : 'audio/webm';

  const recorder = new MediaRecorder(stream, {
    mimeType: preferredMime,
    audioBitsPerSecond: 16000, // Low-bandwidth tactical voice compression
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  const ctx = getAudioContext();
  let analyser: AnalyserNode | null = null;
  let dataArr: Uint8Array<ArrayBuffer> | null = null;
  let sourceNode: MediaStreamAudioSourceNode | null = null;

  if (ctx) {
    sourceNode = ctx.createMediaStreamSource(stream);
    analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    sourceNode.connect(analyser);
    dataArr = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
  }

  const startedAt = Date.now();
  recorder.start(100);
  playRadioTone('key_up');

  return {
    getLevel: () => {
      if (!analyser || !dataArr) return 0;
      analyser.getByteFrequencyData(dataArr);
      let sum = 0;
      for (let i = 0; i < dataArr.length; i++) sum += dataArr[i];
      return Math.min(1, sum / (dataArr.length * 140));
    },
    stop: () =>
      new Promise((resolve) => {
        const elapsed = Date.now() - startedAt;
        recorder.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          sourceNode?.disconnect();
          playRadioTone('squelch');

          if (chunks.length === 0 || elapsed < 250) {
            resolve(null);
            return;
          }
          const blob = new Blob(chunks, {type: preferredMime});
          const buf = await blob.arrayBuffer();
          resolve({
            audioB64: arrayBufferToBase64(buf),
            mimeType: preferredMime,
            durationMs: elapsed,
          });
        };
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          resolve(null);
        }
      }),
  };
}
