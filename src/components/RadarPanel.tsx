import React, {useEffect, useRef, useState} from 'react';
import {
  Compass,
  Crosshair,
  LocateFixed,
  MapPin,
  RadioTower,
  Trash2,
} from 'lucide-react';
import {
  calculateBearingDegrees,
  formatDistance,
  haversineDistanceMeters,
  latLonToMGRS,
} from '../lib/mgrs';
import {
  BurnTimerOption,
  type GeoFix,
  type PeerNode,
  type WaypointPin,
} from '../types/tactical';

interface RadarPanelProps {
  peers: PeerNode[];
  waypoints: WaypointPin[];
  batterySaver: boolean;
  onBroadcastBeacon: (fix: GeoFix, burn: BurnTimerOption) => Promise<void>;
  onAddWaypoint: (label: string, fix: GeoFix) => Promise<void>;
  onDeleteWaypoint: (id: string) => Promise<void>;
}

const RANGE_OPTIONS_M = [250, 1000, 5000, 20000];

export const RadarPanel: React.FC<RadarPanelProps> = ({
  peers,
  waypoints,
  batterySaver,
  onBroadcastBeacon,
  onAddWaypoint,
  onDeleteWaypoint,
}) => {
  const [rangeM, setRangeM] = useState<number>(1000);
  const [fix, setFix] = useState<GeoFix>({
    lat: 37.7749,
    lon: -122.4194,
    mgrs: latLonToMGRS(37.7749, -122.4194),
    accuracy: 0,
    heading: null,
    updatedAt: Date.now(),
  });
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'watching' | 'locked' | 'denied'>('idle');
  const [gpsNote, setGpsNote] = useState<string>('Default datum · Tap Lock GPS');
  const [selectedTarget, setSelectedTarget] = useState<{
    label: string;
    lat: number;
    lon: number;
    mgrs: string;
  } | null>(null);
  const [manualMode, setManualMode] = useState(false);
  const [manualLat, setManualLat] = useState('37.7749');
  const [manualLon, setManualLon] = useState('-122.4194');
  const [broadcastFeedback, setBroadcastFeedback] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const sweepAngleRef = useRef<number>(0);

  const startGpsWatch = () => {
    if (!navigator.geolocation) {
      setGpsStatus('denied');
      setGpsNote('Geolocation API unavailable — use manual grid');
      return;
    }

    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }

    setGpsStatus('watching');
    setGpsNote('Acquiring satellite fix...');

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const {latitude, longitude, accuracy, heading} = pos.coords;
        const mgrs = latLonToMGRS(latitude, longitude);
        setFix({
          lat: latitude,
          lon: longitude,
          mgrs,
          accuracy: Math.round(accuracy),
          heading: heading ?? null,
          updatedAt: pos.timestamp || Date.now(),
        });
        setManualLat(latitude.toFixed(5));
        setManualLon(longitude.toFixed(5));
        setGpsStatus('locked');
        setGpsNote(`GPS Locked · ±${Math.round(accuracy)}m`);
      },
      (err) => {
        setGpsStatus('denied');
        setGpsNote(
          err.code === 1
            ? 'GPS permission denied — enter manual coordinates'
            : 'Signal weak indoors — using datum / manual fix',
        );
      },
      {
        enableHighAccuracy: !batterySaver,
        maximumAge: batterySaver ? 15000 : 3000,
        timeout: 10000,
      },
    );
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Render MGRS Vector Radar Canvas
  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const intervalMs = batterySaver ? 250 : 40;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(100, Math.floor(rect.width * dpr));
      canvas.height = Math.max(100, Math.floor(rect.height * dpr));
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    const draw = () => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.width / dpr;
      const h = canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Background
      ctx.fillStyle = '#0E100D';
      ctx.fillRect(0, 0, w, h);

      const cx = w / 2;
      const cy = h / 2;
      const radius = Math.max(40, Math.min(cx, cy) - 18);

      // Subtle MGRS Cartesian Grid Lines
      ctx.strokeStyle = 'rgba(78, 90, 62, 0.22)';
      ctx.lineWidth = 1;
      const gridStep = radius / 2;
      for (let gx = cx % gridStep; gx < w; gx += gridStep) {
        ctx.beginPath();
        ctx.moveTo(gx, 0);
        ctx.lineTo(gx, h);
        ctx.stroke();
      }
      for (let gy = cy % gridStep; gy < h; gy += gridStep) {
        ctx.beginPath();
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
        ctx.stroke();
      }

      // Concentric Range Rings
      const rings = [0.25, 0.5, 0.75, 1];
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.textAlign = 'left';
      for (const factor of rings) {
        const r = radius * factor;
        ctx.strokeStyle = factor === 1 ? '#4E5A3E' : 'rgba(78, 90, 62, 0.45)';
        ctx.lineWidth = factor === 1 ? 1.5 : 1;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();

        const ringDist = Math.round(rangeM * factor);
        ctx.fillStyle = '#7E8872';
        ctx.fillText(formatDistance(ringDist), cx + 4, cy - r + 11);
      }

      // Crosshairs + Cardinal Labels
      ctx.strokeStyle = 'rgba(154, 162, 142, 0.25)';
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy);
      ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius);
      ctx.lineTo(cx, cy + radius);
      ctx.stroke();

      ctx.fillStyle = '#9AA28E';
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = 'center';
      ctx.fillText('N 000°', cx, cy - radius - 5);
      ctx.fillText('S 180°', cx, cy + radius + 13);
      ctx.textAlign = 'right';
      ctx.fillText('W', cx - radius - 5, cy + 4);
      ctx.textAlign = 'left';
      ctx.fillText('E', cx + radius + 5, cy + 4);

      // Subtle Sweep Vector
      if (!prefersReducedMotion) {
        sweepAngleRef.current = (sweepAngleRef.current + (batterySaver ? 0.08 : 0.03)) % (Math.PI * 2);
        const sx = cx + Math.sin(sweepAngleRef.current) * radius;
        const sy = cy - Math.cos(sweepAngleRef.current) * radius;
        const grad = ctx.createLinearGradient(cx, cy, sx, sy);
        grad.addColorStop(0, 'rgba(217, 155, 38, 0.04)');
        grad.addColorStop(1, 'rgba(217, 155, 38, 0.38)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sx, sy);
        ctx.stroke();
      }

      const plotCoord = (lat: number, lon: number) => {
        const dist = haversineDistanceMeters(fix.lat, fix.lon, lat, lon);
        const brgDeg = calculateBearingDegrees(fix.lat, fix.lon, lat, lon);
        const brgRad = (brgDeg * Math.PI) / 180;
        const clampedRatio = Math.min(1, dist / rangeM);
        const px = cx + Math.sin(brgRad) * clampedRatio * radius;
        const py = cy - Math.cos(brgRad) * clampedRatio * radius;
        return {px, py, dist, brgDeg};
      };

      // Plot Waypoints
      for (const pin of waypoints) {
        const {px, py} = plotCoord(pin.lat, pin.lon);
        ctx.fillStyle = '#D99B26';
        ctx.beginPath();
        ctx.moveTo(px, py - 6);
        ctx.lineTo(px + 5, py + 4);
        ctx.lineTo(px - 5, py + 4);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = '#E6E8E1';
        ctx.font = '500 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(pin.label, px + 8, py + 3);
      }

      // Plot Encrypted Peer Beacons
      for (const peer of peers) {
        if (!peer.coords) continue;
        const {px, py} = plotCoord(peer.coords.lat, peer.coords.lon);
        ctx.strokeStyle = '#6F8F5C';
        ctx.fillStyle = '#1B1E18';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = '#9FC28A';
        ctx.font = '600 10px "JetBrains Mono", monospace';
        ctx.textAlign = 'left';
        ctx.fillText(peer.callsign, px + 8, py + 3);
      }

      // Draw Bearing Line to Selected Target
      if (selectedTarget) {
        const {px, py} = plotCoord(selectedTarget.lat, selectedTarget.lon);
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#D99B26';
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // Center Self Beacon
      ctx.fillStyle = '#D99B26';
      ctx.beginPath();
      ctx.arc(cx, cy, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#E6E8E1';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 8, 0, Math.PI * 2);
      ctx.stroke();
    };

    draw();
    const timer = setInterval(draw, intervalMs);
    return () => {
      clearInterval(timer);
      ro.disconnect();
    };
  }, [fix, peers, waypoints, rangeM, batterySaver, selectedTarget]);

  const handleCanvasClick = async (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const radius = Math.max(40, Math.min(cx, cy) - 18);

    const dx = x - cx;
    const dy = cy - y;
    const pixelDist = Math.hypot(dx, dy);
    if (pixelDist > radius) return;

    const meters = (pixelDist / radius) * rangeM;
    const bearingRad = Math.atan2(dx, dy);
    const angularDist = meters / 6371000;
    const lat1 = (fix.lat * Math.PI) / 180;
    const lon1 = (fix.lon * Math.PI) / 180;

    const lat2 = Math.asin(
      Math.sin(lat1) * Math.cos(angularDist) +
        Math.cos(lat1) * Math.sin(angularDist) * Math.cos(bearingRad),
    );
    const lon2 =
      lon1 +
      Math.atan2(
        Math.sin(bearingRad) * Math.sin(angularDist) * Math.cos(lat1),
        Math.cos(angularDist) - Math.sin(lat1) * Math.sin(lat2),
      );

    const newLat = (lat2 * 180) / Math.PI;
    const newLon = (lon2 * 180) / Math.PI;
    const newMgrs = latLonToMGRS(newLat, newLon);
    const pinLabel = `PIN-${waypoints.length + 1}`;

    const pinFix: GeoFix = {
      lat: newLat,
      lon: newLon,
      mgrs: newMgrs,
      accuracy: 5,
      heading: null,
      updatedAt: Date.now(),
    };
    await onAddWaypoint(pinLabel, pinFix);
    setSelectedTarget({label: pinLabel, lat: newLat, lon: newLon, mgrs: newMgrs});
  };

  const applyManualFix = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = Number.parseFloat(manualLat);
    const lon = Number.parseFloat(manualLon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -85 || lat > 85 || lon < -180 || lon > 180) {
      setGpsNote('Invalid coordinates (Lat -85..85, Lon -180..180)');
      return;
    }
    setFix({
      lat,
      lon,
      mgrs: latLonToMGRS(lat, lon),
      accuracy: 5,
      heading: null,
      updatedAt: Date.now(),
    });
    setGpsStatus('locked');
    setGpsNote('Manual tactical datum active');
    setManualMode(false);
  };

  const handleBroadcast = async () => {
    await onBroadcastBeacon(fix, BurnTimerOption.FiveMinutes);
    setBroadcastFeedback('Encrypted fix sent');
    setTimeout(() => setBroadcastFeedback(null), 2500);
  };

  const targetMetrics = selectedTarget
    ? {
        brg: Math.round(
          calculateBearingDegrees(fix.lat, fix.lon, selectedTarget.lat, selectedTarget.lon),
        )
          .toString()
          .padStart(3, '0'),
        dist: formatDistance(
          haversineDistanceMeters(fix.lat, fix.lon, selectedTarget.lat, selectedTarget.lon),
        ),
      }
    : null;

  return (
    <section
      aria-label="Tactical MGRS Radar"
      className="flex flex-col h-full min-h-0 rounded-xl border border-[#32382B] bg-[#161914] overflow-hidden"
    >
      {/* Header + MGRS Readout */}
      <div className="shrink-0 px-3.5 py-2.5 border-b border-[#32382B] bg-[#1B1E18] flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-[#D99B26] shrink-0" aria-hidden="true" />
            <h2 className="font-display text-base font-bold tracking-wide text-[#E6E8E1] truncate">
              Tactical MGRS Radar
            </h2>
          </div>
          <p className="font-mono-tabular text-xs font-semibold text-[#D99B26] truncate mt-0.5">
            {fix.mgrs}
          </p>
        </div>

        {/* Range Zoom Segmented Control */}
        <div className="flex items-center gap-0.5 p-0.5 rounded-lg bg-[#111310] border border-[#32382B] shrink-0">
          {RANGE_OPTIONS_M.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRangeM(r)}
              className={`px-2 py-1 rounded-md font-mono-tabular text-[11px] font-medium transition-colors whitespace-nowrap ${
                rangeM === r
                  ? 'bg-[#4E5A3E] text-[#E6E8E1]'
                  : 'text-[#9AA28E] hover:text-[#E6E8E1]'
              }`}
            >
              {formatDistance(r)}
            </button>
          ))}
        </div>
      </div>

      {/* Telemetry Line */}
      <div className="shrink-0 px-3.5 py-1.5 border-b border-[#252920] bg-[#131512] flex items-center justify-between gap-2 text-[11px] text-[#9AA28E]">
        <span className="font-mono-tabular truncate">
          {fix.lat.toFixed(5)}°, {fix.lon.toFixed(5)}° · {gpsNote}
        </span>
        <button
          type="button"
          onClick={() => setManualMode((v) => !v)}
          className="text-[#D99B26] hover:underline whitespace-nowrap shrink-0"
        >
          {manualMode ? 'Close' : 'Set Datum'}
        </button>
      </div>

      {manualMode && (
        <form
          onSubmit={applyManualFix}
          className="shrink-0 px-3 py-2 border-b border-[#32382B] bg-[#1B1E18] flex items-center gap-2"
        >
          <input
            type="text"
            value={manualLat}
            onChange={(e) => setManualLat(e.target.value)}
            aria-label="Latitude"
            placeholder="Lat"
            className="w-24 px-2 py-1 rounded border border-[#32382B] bg-[#111310] font-mono-tabular text-xs text-[#E6E8E1]"
          />
          <input
            type="text"
            value={manualLon}
            onChange={(e) => setManualLon(e.target.value)}
            aria-label="Longitude"
            placeholder="Lon"
            className="w-24 px-2 py-1 rounded border border-[#32382B] bg-[#111310] font-mono-tabular text-xs text-[#E6E8E1]"
          />
          <button
            type="submit"
            className="px-3 py-1 rounded bg-[#4E5A3E] text-xs font-medium text-[#E6E8E1] hover:bg-[#5B6949] whitespace-nowrap"
          >
            Apply
          </button>
        </form>
      )}

      {/* Canvas Radar */}
      <div ref={containerRef} className="flex-1 min-h-0 relative bg-[#0E100D]">
        <canvas
          ref={canvasRef}
          onClick={(e) => void handleCanvasClick(e)}
          className="w-full h-full block cursor-crosshair"
          title="Tap radar grid to drop a waypoint pin"
        />

        {/* Selected Target Bearing Overlay */}
        {selectedTarget && targetMetrics && (
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg border border-[#32382B] bg-[#161914]/90 text-xs">
            <span className="font-mono-tabular text-[#E6E8E1] truncate">
              TGT {selectedTarget.label} · BRG {targetMetrics.brg}° · {targetMetrics.dist}
            </span>
            <button
              type="button"
              onClick={() => setSelectedTarget(null)}
              className="text-[#9AA28E] hover:text-[#E6E8E1] shrink-0"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Waypoint & Peer Quick Strip + Actions */}
      <div className="shrink-0 p-2.5 border-t border-[#32382B] bg-[#1B1E18] space-y-2">
        {(waypoints.length > 0 || peers.some((p) => p.coords)) && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {peers
              .filter((p) => p.coords)
              .map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() =>
                    setSelectedTarget({
                      label: p.callsign,
                      lat: p.coords!.lat,
                      lon: p.coords!.lon,
                      mgrs: p.coords!.mgrs,
                    })
                  }
                  className="px-2 py-1 rounded border border-[#4E5A3E] bg-[#161914] text-[11px] font-mono-tabular text-[#9FC28A] whitespace-nowrap shrink-0"
                >
                  {p.callsign}
                </button>
              ))}
            {waypoints.slice(0, 4).map((w) => (
              <div
                key={w.id}
                className="flex items-center rounded border border-[#32382B] bg-[#161914] text-[11px] shrink-0"
              >
                <button
                  type="button"
                  onClick={() =>
                    setSelectedTarget({
                      label: w.label,
                      lat: w.lat,
                      lon: w.lon,
                      mgrs: w.mgrs,
                    })
                  }
                  className="px-2 py-1 font-mono-tabular text-[#D99B26] hover:text-[#E6E8E1] whitespace-nowrap"
                >
                  {w.label}
                </button>
                <button
                  type="button"
                  onClick={() => void onDeleteWaypoint(w.id)}
                  className="px-1.5 py-1 text-[#9AA28E] hover:text-[#C84B31]"
                  aria-label={`Remove ${w.label}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={startGpsWatch}
            className={`min-h-[42px] px-2 rounded-lg border text-xs font-medium flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap ${
              gpsStatus === 'locked'
                ? 'border-[#6F8F5C] bg-[#1D2618] text-[#9FC28A]'
                : 'border-[#32382B] bg-[#161914] text-[#E6E8E1] hover:bg-[#23271F]'
            }`}
          >
            <LocateFixed className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{gpsStatus === 'locked' ? 'GPS Active' : 'Lock GPS'}</span>
          </button>

          <button
            type="button"
            onClick={() => void onAddWaypoint(`PIN-${waypoints.length + 1}`, fix)}
            className="min-h-[42px] px-2 rounded-lg border border-[#32382B] bg-[#161914] text-xs font-medium text-[#E6E8E1] flex items-center justify-center gap-1.5 hover:bg-[#23271F] whitespace-nowrap"
          >
            <MapPin className="w-4 h-4 text-[#D99B26] shrink-0" aria-hidden="true" />
            <span>Drop Pin</span>
          </button>

          <button
            type="button"
            onClick={() => void handleBroadcast()}
            className="min-h-[42px] px-2 rounded-lg bg-[#D99B26] text-[#111310] text-xs font-semibold flex items-center justify-center gap-1.5 hover:bg-[#E5AA38] active:scale-[0.98] whitespace-nowrap"
          >
            {broadcastFeedback ? (
              <Crosshair className="w-4 h-4 shrink-0" aria-hidden="true" />
            ) : (
              <RadioTower className="w-4 h-4 shrink-0" aria-hidden="true" />
            )}
            <span>{broadcastFeedback ? 'Sent Fix' : 'Share Fix'}</span>
          </button>
        </div>
      </div>
    </section>
  );
};
