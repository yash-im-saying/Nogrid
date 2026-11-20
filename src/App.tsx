import React, {useState} from 'react';
import {
  Compass,
  MessageSquareLock,
  Radio,
  Shield,
  Sun,
} from 'lucide-react';
import {CommsPanel} from './components/CommsPanel';
import {MeshPanel} from './components/MeshPanel';
import {OpticalPanel} from './components/OpticalPanel';
import {PTTPanel} from './components/PTTPanel';
import {RadarPanel} from './components/RadarPanel';
import {TopTacticalBar} from './components/TopTacticalBar';
import {useMeshSync} from './hooks/useMeshSync';
import {
  BurnTimerOption,
  type GeoFix,
  PacketType,
  TacticalTab,
} from './types/tactical';

const NAV_ITEMS: Array<{tab: TacticalTab; label: string; Icon: React.ComponentType<{className?: string}>}> = [
  {tab: TacticalTab.Comms, label: 'Comms', Icon: MessageSquareLock},
  {tab: TacticalTab.PTT, label: 'PTT', Icon: Radio},
  {tab: TacticalTab.Radar, label: 'Radar', Icon: Compass},
  {tab: TacticalTab.Light, label: 'Light', Icon: Sun},
  {tab: TacticalTab.Mesh, label: 'Mesh', Icon: Shield},
];

export default function App() {
  const [activeTab, setActiveTab] = useState<TacticalTab>(TacticalTab.Comms);
  const [desktopRightTab, setDesktopRightTab] = useState<'light' | 'mesh'>('light');

  const {
    ready,
    isOnline,
    wsConnected,
    identity,
    channelKey,
    messages,
    peers,
    waypoints,
    outboxCount,
    pttAutoMonitor,
    setPttAutoMonitor,
    wakeLockActive,
    sendEncryptedPacket,
    triggerBurnOnRead,
    updateIdentitySettings,
    rotateChannelPassphrase,
    importSharedChannelKey,
    encryptForOpticalTx,
    decryptFromOpticalRx,
    addWaypoint,
    deleteWaypointPin,
    flushOutbox,
    wipeLocalHistory,
  } = useMeshSync();

  const handleSendText = async (text: string, burn: BurnTimerOption) => {
    await sendEncryptedPacket(PacketType.Text, {body: text}, burn);
  };

  const handleSendVoice = async (
    audioB64: string,
    mimeType: string,
    durationMs: number,
    burn: BurnTimerOption,
  ) => {
    await sendEncryptedPacket(
      PacketType.PTT,
      {audioB64, mimeType, durationMs},
      burn,
    );
  };

  const handleBroadcastBeacon = async (fix: GeoFix, burn: BurnTimerOption) => {
    await sendEncryptedPacket(PacketType.Beacon, {coords: fix}, burn);
  };

  if (!ready) {
    return (
      <div className="h-[100dvh] w-full bg-[#111310] text-[#E6E8E1] flex flex-col items-center justify-center p-6">
        <Shield className="w-8 h-8 text-[#D99B26] mb-3" aria-hidden="true" />
        <p className="font-display text-xl font-bold tracking-wider">
          INITIALIZING E2EE MESH
        </p>
        <p className="text-xs text-[#9AA28E] mt-1 font-mono-tabular">
          Provisioning ECDH P-256 identity & IndexedDB vault
        </p>
      </div>
    );
  }

  return (
    <div className="h-[100dvh] w-full overflow-hidden flex flex-col bg-[#111310] text-[#E6E8E1]">
      <TopTacticalBar
        identity={identity}
        channelKey={channelKey}
        isOnline={isOnline}
        wsConnected={wsConnected}
        outboxCount={outboxCount}
        peerCount={peers.length}
        onToggleBatterySaver={() =>
          void updateIdentitySettings({batterySaver: !(identity?.batterySaver ?? false)})
        }
        onOpenMeshTab={() => {
          setActiveTab(TacticalTab.Mesh);
          setDesktopRightTab('mesh');
        }}
      />

      {/* Mobile Single-Panel Zero-Scroll Stage */}
      <main className="flex-1 min-h-0 overflow-hidden lg:hidden p-2">
        {activeTab === TacticalTab.Comms && (
          <CommsPanel
            identity={identity}
            channelKey={channelKey}
            messages={messages}
            onSendText={handleSendText}
            onRevealBurnMessage={triggerBurnOnRead}
            onWipeHistory={wipeLocalHistory}
            onFocusMapFix={() => setActiveTab(TacticalTab.Radar)}
          />
        )}
        {activeTab === TacticalTab.PTT && (
          <PTTPanel
            channelKey={channelKey}
            messages={messages}
            pttAutoMonitor={pttAutoMonitor}
            onToggleMonitor={() => setPttAutoMonitor((v) => !v)}
            onSendVoice={handleSendVoice}
          />
        )}
        {activeTab === TacticalTab.Radar && (
          <RadarPanel
            peers={peers}
            waypoints={waypoints}
            batterySaver={identity?.batterySaver ?? false}
            onBroadcastBeacon={handleBroadcastBeacon}
            onAddWaypoint={addWaypoint}
            onDeleteWaypoint={deleteWaypointPin}
          />
        )}
        {activeTab === TacticalTab.Light && (
          <OpticalPanel
            channelKey={channelKey}
            onEncryptMessage={encryptForOpticalTx}
            onDecryptMessage={decryptFromOpticalRx}
            onImportChannelKey={importSharedChannelKey}
          />
        )}
        {activeTab === TacticalTab.Mesh && (
          <MeshPanel
            identity={identity}
            channelKey={channelKey}
            peers={peers}
            outboxCount={outboxCount}
            wsConnected={wsConnected}
            wakeLockActive={wakeLockActive}
            onUpdateIdentity={updateIdentitySettings}
            onRotateChannelKey={rotateChannelPassphrase}
            onFlushOutbox={flushOutbox}
          />
        )}
      </main>

      {/* Desktop Multi-Column Zero-Scroll Command Grid */}
      <main className="hidden lg:grid lg:grid-cols-12 gap-3 p-3 flex-1 min-h-0 overflow-hidden">
        <div className="col-span-4 flex flex-col gap-3 min-h-0 overflow-hidden">
          <div className="flex-1 min-h-0 overflow-hidden">
            <CommsPanel
              identity={identity}
              channelKey={channelKey}
              messages={messages}
              onSendText={handleSendText}
              onRevealBurnMessage={triggerBurnOnRead}
              onWipeHistory={wipeLocalHistory}
            />
          </div>
          <div className="h-[250px] shrink-0 overflow-hidden">
            <PTTPanel
              channelKey={channelKey}
              messages={messages}
              pttAutoMonitor={pttAutoMonitor}
              onToggleMonitor={() => setPttAutoMonitor((v) => !v)}
              onSendVoice={handleSendVoice}
              compact
            />
          </div>
        </div>

        <div className="col-span-4 min-h-0 overflow-hidden">
          <RadarPanel
            peers={peers}
            waypoints={waypoints}
            batterySaver={identity?.batterySaver ?? false}
            onBroadcastBeacon={handleBroadcastBeacon}
            onAddWaypoint={addWaypoint}
            onDeleteWaypoint={deleteWaypointPin}
          />
        </div>

        <div className="col-span-4 flex flex-col gap-2 min-h-0 overflow-hidden">
          <div className="shrink-0 grid grid-cols-2 gap-1 p-1 rounded-xl border border-[#32382B] bg-[#161914]">
            <button
              type="button"
              onClick={() => setDesktopRightTab('light')}
              className={`min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                desktopRightTab === 'light'
                  ? 'bg-[#4E5A3E] text-[#E6E8E1]'
                  : 'text-[#9AA28E] hover:text-[#E6E8E1]'
              }`}
            >
              <Sun className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Optical Light-Link</span>
            </button>
            <button
              type="button"
              onClick={() => setDesktopRightTab('mesh')}
              className={`min-h-[38px] rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                desktopRightTab === 'mesh'
                  ? 'bg-[#4E5A3E] text-[#E6E8E1]'
                  : 'text-[#9AA28E] hover:text-[#E6E8E1]'
              }`}
            >
              <Shield className="w-4 h-4 shrink-0" aria-hidden="true" />
              <span>Mesh & Keys</span>
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {desktopRightTab === 'light' ? (
              <OpticalPanel
                channelKey={channelKey}
                onEncryptMessage={encryptForOpticalTx}
                onDecryptMessage={decryptFromOpticalRx}
                onImportChannelKey={importSharedChannelKey}
              />
            ) : (
              <MeshPanel
                identity={identity}
                channelKey={channelKey}
                peers={peers}
                outboxCount={outboxCount}
                wsConnected={wsConnected}
                wakeLockActive={wakeLockActive}
                onUpdateIdentity={updateIdentitySettings}
                onRotateChannelKey={rotateChannelPassphrase}
                onFlushOutbox={flushOutbox}
              />
            )}
          </div>
        </div>
      </main>

      {/* Mobile Ergonomic Bottom Thumb Navigation (<= 64px, >= 44px hit targets) */}
      <nav
        aria-label="Tactical Mode Switcher"
        className="lg:hidden shrink-0 h-16 border-t border-[#32382B] bg-[#161914] grid grid-cols-5 items-center px-1"
      >
        {NAV_ITEMS.map(({tab, label, Icon}) => {
          const active = activeTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`min-h-[48px] min-w-[44px] flex flex-col items-center justify-center gap-1 rounded-lg transition-colors focus-visible:outline-2 focus-visible:outline-[#D99B26] ${
                active ? 'text-[#D99B26]' : 'text-[#9AA28E] hover:text-[#E6E8E1]'
              }`}
              aria-current={active ? 'page' : undefined}
            >
              <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
              <span className="text-[11px] font-medium leading-none whitespace-nowrap">
                {label}
              </span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}
