export enum OpticalFrameKind {
  EncryptedMessage = 0x01,
  ChannelKeyShare = 0x02,
}

export interface DecodedOpticalFrame {
  kind: OpticalFrameKind;
  payload: Uint8Array;
}

export function computeCrc8(data: Uint8Array): number {
  let crc = 0x00;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc & 0x80) !== 0 ? ((crc << 1) ^ 0x07) & 0xff : (crc << 1) & 0xff;
    }
  }
  return crc;
}

/**
 * Encodes a payload into a Differential-Manchester chip sequence (0 | 1 per half-bit).
 * Frame: [0xAA, 0x55] + [kind] + [len] + [payload...] + [crc8(kind, len, payload)]
 */
export function encodeOpticalChips(kind: OpticalFrameKind, payload: Uint8Array): number[] {
  const safeLen = Math.min(240, payload.length);
  const body = new Uint8Array(2 + safeLen);
  body[0] = kind;
  body[1] = safeLen;
  body.set(payload.slice(0, safeLen), 2);
  const crc = computeCrc8(body);

  const frame = new Uint8Array(2 + body.length + 1);
  frame[0] = 0xaa;
  frame[1] = 0x55;
  frame.set(body, 2);
  frame[frame.length - 1] = crc;

  // Lead-in clock training pulses so adaptive threshold locks before preamble
  const chips: number[] = [1, 0, 1, 0, 1, 0, 1, 0];
  for (let i = 0; i < frame.length; i++) {
    const byte = frame[i];
    for (let bit = 7; bit >= 0; bit--) {
      const b = (byte >> bit) & 1;
      if (b === 1) {
        chips.push(1, 0);
      } else {
        chips.push(0, 1);
      }
    }
  }
  // Trailing low guard
  chips.push(0, 0);
  return chips;
}

export interface OpticalDecoderMetrics {
  luma: number;
  contrastDelta: number;
  signalLocked: boolean;
  syncFound: boolean;
  bitsReceived: number;
  expectedBytes: number;
}

/**
 * Stateful camera-luminance Manchester decoder.
 * Samples luminance over time, adapts to ambient light, detects chip transitions,
 * locks onto 0xAA55 preamble, and validates CRC-8.
 */
export class OpticalStreamDecoder {
  private readonly chipMs: number;
  private lumaWindow: number[] = [];
  private lastSampleTime = 0;
  private accumulatedChipTime = 0;
  private currentLevel = 0;
  private chipBuffer: number[] = [];
  private onFrame: (frame: DecodedOpticalFrame) => void;
  private onError: (reason: string) => void;

  private syncLocked = false;
  private expectedPayloadLen = 0;
  private contrastDelta = 0;
  private lastLuma = 0;

  constructor(
    baudRateBps: number,
    onFrame: (frame: DecodedOpticalFrame) => void,
    onError: (reason: string) => void,
  ) {
    this.chipMs = 1000 / (baudRateBps * 2);
    this.onFrame = onFrame;
    this.onError = onError;
  }

  reset(): void {
    this.lumaWindow = [];
    this.lastSampleTime = 0;
    this.accumulatedChipTime = 0;
    this.chipBuffer = [];
    this.syncLocked = false;
    this.expectedPayloadLen = 0;
  }

  pushLumaSample(luma: number, timestampMs: number): OpticalDecoderMetrics {
    this.lastLuma = luma;
    this.lumaWindow.push(luma);
    if (this.lumaWindow.length > 48) {
      this.lumaWindow.shift();
    }

    let minL = 255;
    let maxL = 0;
    for (let i = 0; i < this.lumaWindow.length; i++) {
      if (this.lumaWindow[i] < minL) minL = this.lumaWindow[i];
      if (this.lumaWindow[i] > maxL) maxL = this.lumaWindow[i];
    }

    this.contrastDelta = maxL - minL;
    const threshold = (minL + maxL) * 0.5;
    const signalLocked = this.contrastDelta >= 14;
    const level = luma >= threshold ? 1 : 0;

    if (this.lastSampleTime === 0) {
      this.lastSampleTime = timestampMs;
      this.currentLevel = level;
      return this.getMetrics(signalLocked);
    }

    const dt = timestampMs - this.lastSampleTime;
    this.lastSampleTime = timestampMs;

    if (!signalLocked) {
      this.accumulatedChipTime = 0;
      this.currentLevel = level;
      return this.getMetrics(false);
    }

    // Re-align phase gently on clean edge transitions
    if (level !== this.currentLevel) {
      const remainder = this.accumulatedChipTime % this.chipMs;
      if (remainder > this.chipMs * 0.65 || remainder < this.chipMs * 0.35) {
        this.accumulatedChipTime = 0;
      }
      this.currentLevel = level;
    }

    this.accumulatedChipTime += dt;
    while (this.accumulatedChipTime >= this.chipMs) {
      this.accumulatedChipTime -= this.chipMs;
      this.ingestChip(this.currentLevel);
    }

    return this.getMetrics(true);
  }

  private ingestChip(chip: number): void {
    this.chipBuffer.push(chip);
    if (this.chipBuffer.length > 4500) {
      this.chipBuffer.shift();
    }

    if (!this.syncLocked) {
      // Search tail for 32-chip Manchester representation of [0xAA, 0x55]
      if (this.chipBuffer.length >= 32) {
        const tail = this.chipBuffer.slice(this.chipBuffer.length - 32);
        const bytes = decodeManchesterChips(tail);
        if (bytes && bytes[0] === 0xaa && bytes[1] === 0x55) {
          this.syncLocked = true;
          this.chipBuffer = [];
          this.expectedPayloadLen = 0;
        }
      }
      return;
    }

    // Wait for header [kind, length] = 2 bytes = 32 chips
    if (this.expectedPayloadLen === 0 && this.chipBuffer.length >= 32) {
      const hdr = decodeManchesterChips(this.chipBuffer.slice(0, 32));
      if (!hdr || hdr[1] === 0 || hdr[1] > 240) {
        this.syncLocked = false;
        this.chipBuffer = [];
        this.onError('Optical sync lost — realign transmitter');
        return;
      }
      this.expectedPayloadLen = hdr[1];
    }

    // Total needed after preamble: (2 + expectedPayloadLen + 1) bytes * 16 chips
    if (this.expectedPayloadLen > 0) {
      const totalNeededChips = (2 + this.expectedPayloadLen + 1) * 16;
      if (this.chipBuffer.length >= totalNeededChips) {
        const frameChips = this.chipBuffer.slice(0, totalNeededChips);
        const decoded = decodeManchesterChips(frameChips);
        this.syncLocked = false;
        this.expectedPayloadLen = 0;
        this.chipBuffer = [];

        if (!decoded) {
          this.onError('Manchester clock error — hold steady and retry');
          return;
        }

        const body = decoded.slice(0, decoded.length - 1);
        const rxCrc = decoded[decoded.length - 1];
        const calcCrc = computeCrc8(body);
        if (rxCrc !== calcCrc) {
          this.onError('Optical checksum mismatch — ambient glare interference');
          return;
        }

        const kind = body[0] as OpticalFrameKind;
        const payload = body.slice(2);
        this.onFrame({kind, payload});
      }
    }
  }

  private getMetrics(signalLocked: boolean): OpticalDecoderMetrics {
    return {
      luma: Math.round(this.lastLuma),
      contrastDelta: Math.round(this.contrastDelta),
      signalLocked,
      syncFound: this.syncLocked,
      bitsReceived: Math.floor(this.chipBuffer.length / 2),
      expectedBytes: this.expectedPayloadLen,
    };
  }
}

export function decodeManchesterChips(chips: number[]): Uint8Array | null {
  if (chips.length % 16 !== 0) return null;
  const byteCount = chips.length / 16;
  const out = new Uint8Array(byteCount);

  for (let b = 0; b < byteCount; b++) {
    let val = 0;
    for (let bit = 0; bit < 8; bit++) {
      const idx = b * 16 + bit * 2;
      const c0 = chips[idx];
      const c1 = chips[idx + 1];
      if (c0 === 1 && c1 === 0) {
        val = (val << 1) | 1;
      } else if (c0 === 0 && c1 === 1) {
        val = (val << 1) | 0;
      } else {
        return null;
      }
    }
    out[b] = val;
  }
  return out;
}
