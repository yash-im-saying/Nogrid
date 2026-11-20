import React, {useState} from 'react';
import {
  BatteryCharging,
  Bluetooth,
  KeyRound,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UserCheck,
} from 'lucide-react';
import type {ChannelKeyState, IdentityProfile, PeerNode} from '../types/tactical';

interface MeshPanelProps {
  identity: IdentityProfile | null;
  channelKey: ChannelKeyState | null;
  peers: PeerNode[];
  outboxCount: number;
  wsConnected: boolean;
  wakeLockActive: boolean;
  onUpdateIdentity: (
    patch: Partial<Pick<IdentityProfile, 'callsign' | 'batterySaver' | 'wakeLockEnabled'>>,
  ) => Promise<void>;
  onRotateChannelKey: (label: string, passphrase: string) => Promise<void>;
  onFlushOutbox: () => Promise<void>;
}

export const MeshPanel: React.FC<MeshPanelProps> = ({
  identity,
  channelKey,
  peers,
  outboxCount,
  wsConnected,
  wakeLockActive,
  onUpdateIdentity,
  onRotateChannelKey,
  onFlushOutbox,
}) => {
  const [callsignDraft, setCallsignDraft] = useState(identity?.callsign ?? '');
  const [netLabelDraft, setNetLabelDraft] = useState(channelKey?.label ?? 'ALPHA-NET');
  const [passphraseDraft, setPassphraseDraft] = useState('');
  const [bleStatus, setBleStatus] = useState<string>('Bluetooth peer discovery ready');
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);

  const handleSaveCallsign = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = callsignDraft.trim().toUpperCase().slice(0, 16);
    if (!clean) return;
    await onUpdateIdentity({callsign: clean});
    setStatusFeedback(`Callsign set to ${clean}`);
    setTimeout(() => setStatusFeedback(null), 2500);
  };

  const handleRotateKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphraseDraft.trim().length < 6) {
      setStatusFeedback('Passphrase must be at least 6 characters');
      return;
    }
    await onRotateChannelKey(netLabelDraft || 'ALPHA-NET', passphraseDraft.trim());
    setPassphraseDraft('');
    setStatusFeedback('AES-256 channel key rotated');
    setTimeout(() => setStatusFeedback(null), 3000);
  };

  const scanBluetoothPeer = async () => {
    const nav = navigator as Navigator & {
      bluetooth?: {
        requestDevice: (opts: {acceptAllDevices: boolean}) => Promise<{name?: string; id: string}>;
      };
    };

    if (!nav.bluetooth) {
      setBleStatus('Web Bluetooth API unavailable — use Local Tab / Wi-Fi / Optical');
      return;
    }

    try {
      setBleStatus('Scanning nearby BLE hardware...');
      const device = await nav.bluetooth.requestDevice({acceptAllDevices: true});
      setBleStatus(`Paired BLE node: ${device.name || device.id.slice(0, 8)}`);
    } catch (err) {
      setBleStatus(
        err instanceof Error ? err.message : 'Bluetooth scan cancelled',
      );
    }
  };

  return (
    <section
      aria-label="Mesh, Encryption and Power"
      className="flex flex-col h-full min-h-0 rounded-xl border border-[#32382B] bg-[#161914] overflow-hidden"
    >
      <div className="shrink-0 px-3.5 py-2.5 border-b border-[#32382B] bg-[#1B1E18] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-display text-base font-bold tracking-wide text-[#E6E8E1] truncate">
            Mesh & Encryption
          </h2>
          <p className="text-[11px] text-[#9AA28E] font-mono-tabular truncate">
            ECDH P-256 · {identity?.fingerprint ?? 'KEY-INIT'}
          </p>
        </div>

        <span className="font-mono-tabular text-xs text-[#9FC28A] shrink-0">
          {peers.length} {peers.length === 1 ? 'Peer' : 'Peers'}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto tactical-scroll p-3 space-y-3">
        {/* Callsign Identity */}
        <form onSubmit={(e) => void handleSaveCallsign(e)} className="space-y-1.5">
          <label className="text-xs font-medium text-[#9AA28E] flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-[#D99B26]" aria-hidden="true" />
            <span>Operator Callsign</span>
          </label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={callsignDraft}
              onChange={(e) => setCallsignDraft(e.target.value)}
              placeholder={identity?.callsign ?? 'OP-01'}
              maxLength={16}
              className="flex-1 min-w-0 min-h-[40px] px-3 rounded-lg border border-[#32382B] bg-[#111310] font-mono-tabular text-sm text-[#E6E8E1] focus:outline-none focus:border-[#D99B26]"
            />
            <button
              type="submit"
              className="min-h-[40px] px-3 rounded-lg bg-[#4E5A3E] text-xs font-semibold text-[#E6E8E1] hover:bg-[#5B6949] whitespace-nowrap shrink-0"
            >
              Save
            </button>
          </div>
        </form>

        {/* Channel Key Derivation */}
        <form
          onSubmit={(e) => void handleRotateKey(e)}
          className="p-2.5 rounded-lg border border-[#32382B] bg-[#1B1E18] space-y-2"
        >
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium text-[#E6E8E1] flex items-center gap-1.5">
              <KeyRound className="w-3.5 h-3.5 text-[#D99B26]" aria-hidden="true" />
              <span>Shared Channel Key</span>
            </span>
            <span className="font-mono-tabular text-[#D99B26]">
              #{channelKey?.keyHash ?? '0000'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={netLabelDraft}
              onChange={(e) => setNetLabelDraft(e.target.value)}
              placeholder="Channel (ALPHA-NET)"
              className="min-h-[38px] px-2.5 rounded border border-[#32382B] bg-[#111310] font-mono-tabular text-xs text-[#E6E8E1]"
            />
            <input
              type="password"
              value={passphraseDraft}
              onChange={(e) => setPassphraseDraft(e.target.value)}
              placeholder="Mutual passphrase"
              className="min-h-[38px] px-2.5 rounded border border-[#32382B] bg-[#111310] text-xs text-[#E6E8E1]"
            />
          </div>

          <button
            type="submit"
            className="w-full min-h-[38px] rounded-lg border border-[#4E5A3E] bg-[#161914] text-xs font-medium text-[#E6E8E1] hover:bg-[#23271F]"
          >
            Derive AES-256 Key (PBKDF2)
          </button>
        </form>

        {/* Hardware Transports & Power */}
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void scanBluetoothPeer()}
            className="w-full min-h-[42px] px-3 rounded-lg border border-[#32382B] bg-[#1B1E18] text-xs font-medium text-[#E6E8E1] flex items-center justify-between gap-2 hover:bg-[#23271F]"
          >
            <span className="flex items-center gap-2">
              <Bluetooth className="w-4 h-4 text-[#D99B26] shrink-0" aria-hidden="true" />
              <span>Pair Direct Bluetooth Device</span>
            </span>
            <span className="text-[11px] text-[#9AA28E]">Scan</span>
          </button>
          <p className="text-[11px] text-[#9AA28E] px-1">{bleStatus}</p>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() =>
                void onUpdateIdentity({batterySaver: !(identity?.batterySaver ?? false)})
              }
              className={`min-h-[42px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                identity?.batterySaver
                  ? 'border-[#D99B26] bg-[#2B2415] text-[#D99B26]'
                  : 'border-[#32382B] bg-[#1B1E18] text-[#9AA28E]'
              }`}
            >
              <BatteryCharging className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{identity?.batterySaver ? 'Battery Eco On' : 'Battery Standard'}</span>
            </button>

            <button
              type="button"
              onClick={() =>
                void onUpdateIdentity({wakeLockEnabled: !(identity?.wakeLockEnabled ?? false)})
              }
              className={`min-h-[42px] px-2.5 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 ${
                wakeLockActive
                  ? 'border-[#6F8F5C] bg-[#1D2618] text-[#9FC28A]'
                  : 'border-[#32382B] bg-[#1B1E18] text-[#9AA28E]'
              }`}
            >
              <Smartphone className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>{wakeLockActive ? 'Wake Lock Active' : 'Keep Awake Off'}</span>
            </button>
          </div>
        </div>

        {/* Outbox & Active Mesh Nodes */}
        <div className="p-2.5 rounded-lg border border-[#32382B] bg-[#1B1E18] space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-[#9AA28E] flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5 text-[#6F8F5C]" aria-hidden="true" />
              <span>{wsConnected ? 'Relay Online' : 'Offline Outbox Mode'}</span>
            </span>
            <button
              type="button"
              onClick={() => void onFlushOutbox()}
              className="text-[#D99B26] font-mono-tabular flex items-center gap-1 hover:underline"
            >
              <RefreshCw className="w-3 h-3" aria-hidden="true" />
              <span>Sync ({outboxCount})</span>
            </button>
          </div>

          {peers.length > 0 && (
            <div className="space-y-1 pt-1 border-t border-[#252920]">
              {peers.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between text-[11px] font-mono-tabular text-[#E6E8E1]"
                >
                  <span>{p.callsign}</span>
                  <span className="text-[#9AA28E]">{p.fingerprint || 'LOCAL'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {statusFeedback && (
          <p className="text-xs text-[#D99B26] text-center">{statusFeedback}</p>
        )}
      </div>
    </section>
  );
};
