import React from 'react';
import {BatteryCharging, Lock, ShieldAlert, Wifi, WifiOff} from 'lucide-react';
import type {ChannelKeyState, IdentityProfile} from '../types/tactical';
import {PWAInstallButton} from './PWAInstallButton';

interface TopTacticalBarProps {
  identity: IdentityProfile | null;
  channelKey: ChannelKeyState | null;
  isOnline: boolean;
  wsConnected: boolean;
  outboxCount: number;
  peerCount: number;
  onToggleBatterySaver: () => void;
  onOpenMeshTab: () => void;
}

export const TopTacticalBar: React.FC<TopTacticalBarProps> = ({
  identity,
  channelKey,
  isOnline,
  wsConnected,
  outboxCount,
  peerCount,
  onToggleBatterySaver,
  onOpenMeshTab,
}) => {
  const batterySaver = identity?.batterySaver ?? false;

  let syncLabel = 'Offline Local';
  let SyncIcon = WifiOff;
  let syncColor = 'text-[#D99B26]';

  if (wsConnected) {
    syncLabel = `Mesh Sync · ${peerCount} ${peerCount === 1 ? 'Unit' : 'Units'}`;
    SyncIcon = Wifi;
    syncColor = 'text-[#6F8F5C]';
  } else if (isOnline) {
    syncLabel = 'Reconnecting';
    SyncIcon = ShieldAlert;
    syncColor = 'text-[#D99B26]';
  }

  return (
    <header className="h-[52px] shrink-0 px-3 lg:px-4 border-b border-[#32382B] bg-[#161914] flex items-center justify-between gap-4">
      {/* Zone 1: Brand + Active Callsign */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="font-display text-xl font-bold tracking-wider text-[#E6E8E1] whitespace-nowrap shrink-0">
          VANGUARD
        </span>
        <button
          type="button"
          onClick={onOpenMeshTab}
          className="hidden sm:flex items-center gap-1.5 text-xs text-[#9AA28E] hover:text-[#E6E8E1] transition-colors truncate"
          title="Configure callsign and E2EE channel keys"
        >
          <Lock className="w-3.5 h-3.5 text-[#6F8F5C] shrink-0" aria-hidden="true" />
          <span className="font-mono-tabular text-[#E6E8E1]">{identity?.callsign ?? 'INIT'}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular">{channelKey?.label ?? 'NET'}</span>
          <span aria-hidden="true">·</span>
          <span className="font-mono-tabular">#{channelKey?.keyHash ?? '0000'}</span>
        </button>
      </div>

      {/* Zone 2: Real Connectivity & Outbox Status */}
      <div className="flex items-center gap-2 text-xs whitespace-nowrap shrink-0">
        <SyncIcon className={`w-4 h-4 shrink-0 ${syncColor}`} aria-hidden="true" />
        <span className={`font-medium ${syncColor}`}>{syncLabel}</span>
        {outboxCount > 0 && (
          <>
            <span className="text-[#9AA28E]" aria-hidden="true">·</span>
            <span className="font-mono-tabular text-[#D99B26]">{outboxCount} Queued</span>
          </>
        )}
      </div>

      {/* Zone 3: Battery Saver + PWA Install */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={onToggleBatterySaver}
          className={`min-h-[36px] px-2.5 py-1 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-[#D99B26] ${
            batterySaver
              ? 'border-[#D99B26] bg-[#2B2415] text-[#D99B26]'
              : 'border-[#32382B] bg-[#1B1E18] text-[#9AA28E] hover:text-[#E6E8E1]'
          }`}
          aria-pressed={batterySaver}
          title="Toggle low-power polling and reduced canvas refresh"
        >
          <BatteryCharging className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>{batterySaver ? 'Eco On' : 'Eco Off'}</span>
        </button>
        <PWAInstallButton />
      </div>
    </header>
  );
};
