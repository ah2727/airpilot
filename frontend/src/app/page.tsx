'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Pause, Rewind, FastForward, Gauge, Map as MapIcon } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { io, Socket } from 'socket.io-client';

// ---- Types ----
export type FlightKey = { flightNumber: string; date: number };
export type FdrPoint = {
  id: number;
  ts: number; // epoch ms (UTC)
  utcTime: string;
  date: number;
  flightNumber: string;
  latitude?: number | null;
  longitude?: number | null;
  pressureAltitude?: number | null;
  pitchAngle?: number | null;
  rollAngle?: number | null;
  magHeading?: number | null;
  computedAirspeed?: number | null;
  verticalSpeed?: number | null;
  flapPosition?: number | null;
  gearSelectionUp?: number | null;
  ap1Engaged?: number | null;
  ap2Engaged?: number | null;
  airGround?: number | null;
};

type Snapshot = {
  key: string;
  idx: number;
  total: number;
  playing: boolean;
  rate: number;
  point: FdrPoint | null;
};

// ---- Helpers ----
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000';
const NS_URL = `${API_URL}/pilot`;

function fmtTime(ts?: number) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toUTCString().split(' ')[4]; // HH:MM:SS
}

function useSocketPlayer(key: FlightKey) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [points, setPoints] = useState<FdrPoint[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const keyRef = useRef(key);

  useEffect(() => { keyRef.current = key; }, [key]);

  const appendPoint = (p?: FdrPoint | null) => {
    if (!p || p.latitude == null || p.longitude == null) return;
    setPoints(prev => {
      if (prev.length && prev[prev.length - 1].id === p.id) return prev;
      return [...prev, p];
    });
  };

  useEffect(() => {
    const s = io(NS_URL, { transports: ['websocket'] });
    socketRef.current = s;

    s.on('connect', () => {
      s.emit('join', keyRef.current);
    });

    s.on('telemetry:snapshot', (ns: Snapshot) => {
      setSnap(ns);
      appendPoint(ns.point || undefined);
    });

    s.on('telemetry:tick', (payload: any) => {
      // Accept both shapes: { idx, total, point } OR just FdrPoint
      const point: FdrPoint | null = payload?.point ?? payload ?? null;
      setSnap(prev => {
        if (!prev) return prev; // keep null until we have a snapshot
        const nextIdx = typeof payload?.idx === 'number' ? payload.idx : (prev.idx + 1);
        const nextTotal = typeof payload?.total === 'number' ? payload.total : prev.total;
        return { ...prev, idx: nextIdx, total: nextTotal, playing: true, point };
      });
      appendPoint(point);
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  const actions = useMemo(() => ({
    resume: () => socketRef.current?.emit('player:resume', keyRef.current),
    pause: () => socketRef.current?.emit('player:pause', keyRef.current),
    back5: () => socketRef.current?.emit('player:seekSeconds', { ...keyRef.current, seconds: -5 }),
    fwd5: () => socketRef.current?.emit('player:seekSeconds', { ...keyRef.current, seconds: +5 }),
    setRate: (rate: number) => socketRef.current?.emit('player:setRate', { ...keyRef.current, rate }),
    seekIdx: (idx: number) => {
      if (!snap) return;
      const delta = idx - snap.idx;
      socketRef.current?.emit('player:seekPoints', { ...keyRef.current, points: delta });
    },
  }), [snap]);

  return { snap, points, actions } as const;
}

// ---- Map (Leaflet loaded only on client) ----
function TrackMap({ points, current }: { points: FdrPoint[]; current?: FdrPoint | null }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await import('leaflet/dist/leaflet.css');
      setReady(true);
    })();
  }, []);

  if (!ready || typeof window === 'undefined') {
    return (
      <div className="h-[420px] w-full rounded-2xl bg-slate-100 grid place-items-center">
        <div className="text-slate-500 text-sm">Loading map…</div>
      </div>
    );
  }

  // require after CSS is in
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RL = require('react-leaflet');
  const { MapContainer, TileLayer, Polyline, CircleMarker, useMap } = RL;

  const center = points.length ? [points[points.length - 1].latitude!, points[points.length - 1].longitude!] : [25, 55];
  const path = points.filter(p => p.latitude != null && p.longitude != null).map(p => [p.latitude!, p.longitude!]);

  function FitBounds() {
    const map = useMap();
    useEffect(() => {
      if (path.length >= 2) {
        // @ts-ignore
        const L = require('leaflet');
        const bounds = L.latLngBounds(path);
        map.fitBounds(bounds.pad(0.2));
      } else if (center) {
        map.setView(center as any, 6);
      }
    }, [path.length]);
    return null;
  }

  return (
    <MapContainer center={center as any} zoom={5} className="h-[420px] w-full rounded-2xl overflow-hidden">
      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap" />
      <FitBounds />
      {path.length > 1 && (
        <Polyline positions={path as any} />
      )}
      {points[0] && (
        <CircleMarker center={[points[0].latitude!, points[0].longitude!]} radius={8} />
      )}
      {current && current.latitude != null && current.longitude != null && (
        <CircleMarker center={[current.latitude, current.longitude]} radius={10} />
      )}
    </MapContainer>
  );
}

// ---- Main page ----
export default function FlightReplayPage() {
  // You can override via URL query (?flight=122&date=20250324)
  const [flightNumber, setFlightNumber] = useState('122');
  const [date, setDate] = useState(20250324);

  const key = useMemo<FlightKey>(() => ({ flightNumber, date }), [flightNumber, date]);
  const { snap, points, actions } = useSocketPlayer(key);

  const idx = snap?.idx ?? 0;
  const total = snap?.total ?? 0;
  const current = snap?.point ?? null;

  // Data for chart
  const chartData = useMemo(() => (
    points.map(p => ({
      t: fmtTime(p.ts),
      alt: p.pressureAltitude ?? 0,
      id: p.id,
    }))
  ), [points]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/60 border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="text-xl font-semibold flex items-center gap-2"><Gauge className="h-5 w-5"/> Flight Replay</div>

          <div className="ml-auto flex items-center gap-2">
            <input className="px-3 py-1.5 border rounded-xl" value={flightNumber} onChange={e=>setFlightNumber(e.target.value)} />
            <input className="px-3 py-1.5 border rounded-xl w-36" value={date} onChange={e=>setDate(Number(e.target.value))} />
            <span className="text-sm text-slate-500">Server: {NS_URL}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-12 gap-4">
        {/* Left: Events (placeholder live feed) */}
        <aside className="col-span-12 lg:col-span-3">
          <div className="bg-white rounded-2xl shadow p-3">
            <div className="font-medium mb-2">Events</div>
            <div className="space-y-2 max-h-[460px] overflow-auto">
              {points.slice(-20).map(p => (
                <div key={p.id} className="p-2 border rounded-xl text-sm">
                  <div className="flex justify-between"><span>{fmtTime(p.ts)}</span><span>ALT {p.pressureAltitude ?? 0} ft</span></div>
                  <div className="text-slate-500">HDG {p.magHeading ?? 0}° · GS {p.computedAirspeed ?? 0} kt</div>
                </div>
              ))}
              {!points.length && <div className="text-slate-500 text-sm">No events yet. Press <em>Resume</em>.</div>}
            </div>
          </div>
        </aside>

        {/* Center: Map & timeline */}
        <section className="col-span-12 lg:col-span-6 space-y-4">
          <div className="bg-white rounded-2xl shadow p-3">
            <div className="flex items-center gap-2 mb-3 font-medium"><MapIcon className="h-4 w-4"/>Trajectory</div>
            <TrackMap points={points} current={current} />
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm text-slate-600">Time: <b>{fmtTime(current?.ts)}</b></div>
              <div className="text-sm text-slate-600">Alt: <b>{current?.pressureAltitude ?? 0}</b> ft</div>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ left: 12, right: 12, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="t" minTickGap={24} />
                  <YAxis width={46} />
                  <Tooltip />
                  <Line type="monotone" dataKey="alt" dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Timeline slider */}
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={idx}
                onChange={(e) => actions.seekIdx(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-slate-600 w-28 text-right">{idx + 1} / {total || 0}</div>
            </div>
          </div>
        </section>

        {/* Right: Instruments mock / controls */}
        <aside className="col-span-12 lg:col-span-3 space-y-4">
          <div className="bg-white rounded-2xl shadow p-4">
            <div className="font-medium mb-2">Controls</div>
            <div className="flex items-center gap-2">
              <button onClick={actions.back5} className="px-3 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2"><Rewind className="h-4 w-4"/> 5s</button>
              {snap?.playing ? (
                <button onClick={actions.pause} className="px-3 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2"><Pause className="h-4 w-4"/>Pause</button>
              ) : (
                <button onClick={actions.resume} className="px-3 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2"><Play className="h-4 w-4"/>Resume</button>
              )}
              <button onClick={actions.fwd5} className="px-3 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2">5s <FastForward className="h-4 w-4"/></button>
            </div>

            <div className="mt-3 text-sm text-slate-600 space-y-1">
              <div>Status: <b>{snap?.playing ? '▶️ Playing' : '⏸️ Paused'}</b></div>
              <div>Rate: <RateSelect value={snap?.rate ?? 1} onChange={(v)=>actions.setRate(v)} /></div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="font-medium mb-2">Current Point</div>
            <div className="text-sm grid grid-cols-2 gap-y-1">
              <span className="text-slate-500">Time</span><span>{fmtTime(current?.ts)}</span>
              <span className="text-slate-500">Lat / Lon</span><span>{current?.latitude?.toFixed(5)} , {current?.longitude?.toFixed(5)}</span>
              <span className="text-slate-500">ALT (ft)</span><span>{current?.pressureAltitude ?? 0}</span>
              <span className="text-slate-500">HDG</span><span>{current?.magHeading ?? 0}°</span>
              <span className="text-slate-500">GS (kt)</span><span>{current?.computedAirspeed ?? 0}</span>
              <span className="text-slate-500">V/S (fpm)</span><span>{current?.verticalSpeed ?? 0}</span>
            </div>
          </div>
        </aside>
      </main>
    </div>
  );
}

function RateSelect({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <select
      className="ml-2 px-2 py-1 border rounded-lg"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {[0.5, 1, 2, 4, 8].map(v => (
        <option key={v} value={v}>{v}x</option>
      ))}
    </select>
  );
}
