"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Pause,
  Rewind,
  FastForward,
  Gauge,
  Map as MapIcon,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { io, Socket } from "socket.io-client";
import {
  Airspeed,
  Altimeter,
  AttitudeIndicator,
  HeadingIndicator,
  Variometer,
} from "react-flight-indicators";
import "leaflet/dist/leaflet.css";

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
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";
const NS_URL = `${API_URL}/pilot`;

function fmtTime(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  return d.toUTCString().split(" ")[4]; // HH:MM:SS
}
function computeTs(date: number, utcTime?: string) {
  const y = Math.floor(date / 10000);
  const m = Math.floor((date % 10000) / 100);
  const d = date % 100;
  const [hh, mm, ss] = (utcTime || "00:00:00")
    .split(":")
    .map((n) => parseInt(n, 10) || 0);
  return Date.UTC(y, m - 1, d, hh, mm, ss);
}

// ---- Socket player (plane position from socket only) ----
function useSocketPlayer(key: FlightKey) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [points, setPoints] = useState<FdrPoint[]>([]);
  const socketRef = useRef<Socket | null>(null);
  const keyRef = useRef(key);

  // only auto-seek once per flight/date
  const didResetToStartRef = useRef(false);

  useEffect(() => {
    keyRef.current = key;
    didResetToStartRef.current = false; // reset on flight/date change
    setPoints([]); // clear local points when flight changes
    setSnap(null);
  }, [key]);

  const appendPoint = (p?: FdrPoint | null) => {
    if (!p || p.latitude == null || p.longitude == null) return;
    setPoints((prev) => {
      if (prev.length && prev[prev.length - 1].id === p.id) return prev;
      return [...prev, p];
    });
  };

  useEffect(() => {
    const s = io(NS_URL, { transports: ["websocket"] });
    socketRef.current = s;

    s.on("connect", () => {
      s.emit("join", keyRef.current);
    });

    s.on("telemetry:snapshot", (ns: Snapshot) => {
      // If server boots us in the middle, immediately seek to start and re-join to get a fresh snapshot
      if (
        !didResetToStartRef.current &&
        typeof ns.idx === "number" &&
        ns.idx > 0
      ) {
        // set UI idx=0 right away (point stays as-is until fresh snapshot arrives)
        setSnap((prev) =>
          prev
            ? {
                ...prev,
                idx: 0,
                total: ns.total,
                playing: ns.playing,
                rate: ns.rate,
              }
            : { ...ns, idx: 0 }
        );
        // jump back to beginning
        s.emit("player:seekPoints", { ...keyRef.current, points: -ns.idx });
        // ask server for snapshot again using existing "join"
        s.emit("join", keyRef.current);
        didResetToStartRef.current = true;
        return; // IMPORTANT: don't append the stale end-point
      }

      // Normal path: accept snapshot as current plane position
      setSnap(ns);
      appendPoint(ns.point || undefined);
    });

    s.on("telemetry:tick", (payload: any) => {
      const point: FdrPoint | null = payload?.point ?? payload ?? null;
      setSnap((prev) => {
        if (!prev) return prev;
        const nextIdx =
          typeof payload?.idx === "number" ? payload.idx : prev.idx + 1;
        const nextTotal =
          typeof payload?.total === "number" ? payload.total : prev.total;
        return {
          ...prev,
          idx: nextIdx,
          total: nextTotal,
          playing: true,
          point,
        };
      });
      appendPoint(point);
    });

    return () => {
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  const actions = useMemo(
    () => ({
      resume: () => socketRef.current?.emit("player:resume", keyRef.current),
      pause: () => socketRef.current?.emit("player:pause", keyRef.current),
      back5: () =>
        socketRef.current?.emit("player:seekSeconds", {
          ...keyRef.current,
          seconds: -5,
        }),
      fwd5: () =>
        socketRef.current?.emit("player:seekSeconds", {
          ...keyRef.current,
          seconds: +5,
        }),
      setRate: (rate: number) =>
        socketRef.current?.emit("player:setRate", { ...keyRef.current, rate }),
      seekIdx: (idx: number) => {
        if (!snap) return;
        const delta = idx - snap.idx;
        socketRef.current?.emit("player:seekPoints", {
          ...keyRef.current,
          points: delta,
        });
        // also re-join to force an immediate snapshot at the new index
        socketRef.current?.emit("join", keyRef.current);
      },
    }),
    [snap]
  );

  return { snap, points, actions } as const;
}

// ---- Map (polyline from API path; plane from socket current) ----
function TrackMap({
  pathPoints,
  current,
}: {
  pathPoints: FdrPoint[]; // polyline + pins source (API)
  current?: FdrPoint | null; // plane source (SOCKET)
}) {
  const [ready, setReady] = useState(false);

  // Polyline path from API only
  const path: [number, number][] = useMemo(
    () =>
      pathPoints
        .filter((p) => p.latitude != null && p.longitude != null)
        .map((p) => [p.latitude!, p.longitude!]),
    [pathPoints]
  );

  // Begin/End from API path
  const startRef = useRef<[number, number] | null>(null);
  const endRef = useRef<[number, number] | null>(null);
  const mapRef = useRef<any>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    if (!startRef.current && pathPoints.length > 0) {
      const first = pathPoints.find(
        (p) => p.latitude != null && p.longitude != null
      );
      if (first) startRef.current = [first.latitude!, first.longitude!];
    }
    if (pathPoints.length > 0) {
      const last = [...pathPoints]
        .reverse()
        .find((p) => p.latitude != null && p.longitude != null);
      if (last) endRef.current = [last.latitude!, last.longitude!];
    }
  }, [pathPoints.length]);

  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || fittedRef.current) return;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const L = require("leaflet");
    const pts =
      path.length >= 2 ? path : startRef.current ? [startRef.current] : [];
    if (pts.length >= 2) {
      const bounds = L.latLngBounds(pts as any);
      mapRef.current.fitBounds(bounds.pad(0.2));
    } else if (startRef.current) {
      mapRef.current.setView(startRef.current as any, 6);
    }
    fittedRef.current = true;
  }, [ready, path.length]);

  const center =
    startRef.current ?? (path[0] as [number, number]) ?? ([25, 55] as const);

  if (!ready || typeof window === "undefined") {
    return (
      <div className="h-[420px] w-full rounded-2xl bg-slate-100 grid place-items-center">
        <div className="text-slate-500 text-sm">Loading map…</div>
      </div>
    );
  }

  // require after client-only guard
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const RL = require("react-leaflet");
  const { MapContainer, TileLayer, Polyline, Marker } = RL;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const L = require("leaflet");

  const planeIcon = (headingDeg: number) =>
    L.divIcon({
      className: "plane-icon",
      html: `<div style="
          width:24px;height:24px;line-height:24px;text-align:center;
          transform: rotate(${headingDeg}deg);transform-origin:50% 50%;
          font-size:22px;user-select:none;">✈️</div>`,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

  const pin = (label: string) =>
    L.divIcon({
      className: "pin",
      html: `<div style="
          background:white;border:2px solid #334155;border-radius:9999px;
          width:14px;height:14px;box-shadow:0 1px 4px rgba(0,0,0,.3)"
          title="${label}"></div>`,
      iconSize: [14, 14],
      iconAnchor: [7, 7],
    });

  return (
    <MapContainer
      center={center as any}
      zoom={5}
      className="h-[420px] w-full rounded-2xl overflow-hidden"
      whenCreated={(m) => (mapRef.current = m)}
    >
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution="© OpenStreetMap"
      />

      {/* Polyline strictly from API path */}
      {path.length > 1 && <Polyline positions={path as any} />}

      {/* Begin/End strictly from API path */}
      {startRef.current && (
        <Marker position={startRef.current as any} icon={pin("Begin")} />
      )}
      {endRef.current && (
        <Marker position={endRef.current as any} icon={pin("End")} />
      )}

      {/* Plane strictly from SOCKET current */}
      {current && current.latitude != null && current.longitude != null && (
        <Marker
          position={[current.latitude, current.longitude] as any}
          icon={planeIcon(current.magHeading ?? 0)}
        />
      )}
    </MapContainer>
  );
}
function FlagCell({
  label,
  value,
  trueText,
  falseText,
}: {
  label: string;
  value?: number | boolean | null; // accepts 1/0/true/false/null
  trueText: string; // use "1"
  falseText: string; // use "0"
}) {
  // only treat 1/true as ON, 0/false as OFF; everything else is unknown
  const state: "true" | "false" | "unknown" =
    value === 1 || value === true
      ? "true"
      : value === 0 || value === false
      ? "false"
      : "unknown";

  const cls =
    state === "true"
      ? "bg-green-50 text-green-800 border-green-300"
      : state === "false"
      ? "bg-red-50 text-red-700 border-red-300"
      : "bg-slate-50 text-slate-600 border-slate-200";

  const dot =
    state === "true"
      ? "bg-green-500"
      : state === "false"
      ? "bg-red-500"
      : "bg-slate-400";

  return (
    <div className="p-2 border border-amber-200 bg-amber-50 rounded-md">
      {label && (
        <div className="text-xs font-medium text-slate-700">{label}</div>
      )}
      <div
        className={`mt-1 inline-flex items-center gap-2 px-2 py-1 rounded-lg border ${cls}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} />
        <span className="text-sm font-semibold">
          {state === "unknown" ? "—" : state === "true" ? trueText : falseText}
        </span>
      </div>
    </div>
  );
}

// ---- Fetch persisted path for polyline (API) ----
function useStaticPath(key: FlightKey) {
  const [staticPoints, setStaticPoints] = useState<FdrPoint[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const url = `${API_URL}/pilot/path?flightNumber=${encodeURIComponent(
          key.flightNumber
        )}&date=${key.date}`;
        const res = await fetch(url);
        const json = await res.json();
        const arr = (json?.path ?? json ?? []) as any[];

        const pts: FdrPoint[] = arr
          .filter((p) => p && p.latitude != null && p.longitude != null)
          .map((p: any, i: number) => {
            const ts = p.ts ?? computeTs(p.date ?? key.date, p.utcTime);
            return { ...p, id: p.id ?? i, ts } as FdrPoint;
          });

        if (!cancelled) setStaticPoints(pts);
      } catch (e) {
        console.error("Failed to fetch static path:", e);
        if (!cancelled) setStaticPoints([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [key.flightNumber, key.date]);

  return staticPoints;
}

// ---- Main page ----
export default function FlightReplayPage() {
  const [flightNumber, setFlightNumber] = useState("122");
  const [date, setDate] = useState(20250324);

  const key = useMemo<FlightKey>(
    () => ({ flightNumber, date }),
    [flightNumber, date]
  );

  // Polyline from API
  const staticPoints = useStaticPath(key);

  // Plane & playback from socket
  const { snap, actions } = useSocketPlayer(key);

  // Plane position from socket only
  const planeCurrent: FdrPoint | null = snap?.point ?? null;

  const idx = snap?.idx ?? 0;
  const total = snap?.total ?? 0;
  function FlapNumber({ value }: { value?: number | null }) {
    // show a numeric value; fallback to 0 if missing
    const v = value == null ? 0 : Number(value);
    return (
      <div className="p-2 border border-amber-200 bg-amber-50 rounded-md">
        <div className="text-xs font-medium text-slate-700">Flap Position</div>
        <div className="mt-1 px-2 py-1 rounded-lg border bg-white text-slate-900">
          <span className="text-sm font-semibold tabular-nums">{v}</span>
        </div>
      </div>
    );
  }
  function computeTs(date: number, utcTime?: string) {
    const y = Math.floor(date / 10000);
    const m = Math.floor((date % 10000) / 100);
    const d = date % 100;
    const [hh, mm, ss] = (utcTime || "00:00:00")
      .split(":")
      .map((n) => parseInt(n, 10) || 0);
    return Date.UTC(y, m - 1, d, hh, mm, ss);
  }
  function usePathForChart(key: FlightKey) {
    const [points, setPoints] = useState<FdrPoint[]>([]);

    useEffect(() => {
      const ac = new AbortController();

      (async () => {
        try {
          const res = await fetch(
            `${API_URL}/pilot/path?flightNumber=${encodeURIComponent(
              key.flightNumber
            )}&date=${key.date}`,
            { signal: ac.signal }
          );
          const data = await res.json();
          const arr: any[] = Array.isArray(data?.path)
            ? data.path
            : Array.isArray(data)
            ? data
            : [];

          const toNum = (v: any) =>
            v === null || v === undefined ? null : Number(v);

          const pts: FdrPoint[] = arr.map((p: any, i: number) => {
            const ts =
              typeof p.ts === "number"
                ? p.ts
                : computeTs(p.date ?? key.date, p.utcTime);
            return {
              id: p.id ?? i,
              ts,
              utcTime: p.utcTime ?? "",
              date: Number(p.date ?? key.date),
              flightNumber: String(p.flightNumber ?? key.flightNumber),
              latitude: toNum(p.latitude),
              longitude: toNum(p.longitude),
              pressureAltitude: toNum(p.pressureAltitude),
              pitchAngle: toNum(p.pitchAngle),
              rollAngle: toNum(p.rollAngle),
              magHeading: toNum(p.magHeading),
              computedAirspeed: toNum(p.computedAirspeed),
              verticalSpeed: toNum(p.verticalSpeed),
              flapPosition: toNum(p.flapPosition),
              gearSelectionUp: toNum(p.gearSelectionUp),
              ap1Engaged: toNum(p.ap1Engaged),
              ap2Engaged: toNum(p.ap2Engaged),
              airGround: toNum(p.airGround),
            };
          });

          // Keep server order; your API already returns start→end by id
          setPoints(pts);
        } catch (err: any) {
          if (err?.name !== "CanceledError" && err?.code !== "ERR_CANCELED") {
            console.error("Axios /pilot/path failed:", err);
            setPoints([]);
          }
        }
      })();

      return () => ac.abort();
    }, [key.flightNumber, key.date]);

    return points;
  }
  // non-realtime path just for chart (and you can also pass it to the map)
  const pathForChart = usePathForChart(key);
  const markerTs = planeCurrent?.ts ?? null;

  const chartData = useMemo(
    () =>
      pathForChart.map((p) => ({
        ts: p.ts, // numeric epoch ms
        alt: p.pressureAltitude ?? 0,
        id: p.id,
      })),
    [pathForChart]
  );

  return (
    <div className="min-h-screen bg-gradient-to-b from-indigo-50 to-white">
      <header className="sticky top-0 z-10 backdrop-blur bg-white/60 border-b">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <div className="text-xl font-semibold flex items-center gap-2">
            <Gauge className="h-5 w-5" /> Flight Replay
          </div>

          <div className="ml-auto flex items-center gap-2">
            <input
              className="px-3 py-1.5 border rounded-xl"
              value={flightNumber}
              onChange={(e) => setFlightNumber(e.target.value)}
            />
            <input
              type="number"
              className="px-3 py-1.5 border rounded-xl w-36"
              value={String(date)}
              onChange={(e) =>
                setDate(e.target.value === "" ? 0 : Number(e.target.value))
              }
            />
            <span className="text-sm text-slate-500">Server: {NS_URL}</span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 flex flex-col gap-4">
        {/* Controls */}
        <div className="bg-white rounded-2xl shadow p-4">
          <div className="font-medium mb-2 justify-center flex">Controls</div>
          <div className="flex items-center gap-2 justify-center">
            <button
              onClick={actions.back5}
              className="px-10 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2"
            >
              <Rewind className="h-4 w-4" /> 5s
            </button>
            {snap?.playing ? (
              <button
                onClick={actions.pause}
                className="px-10 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2"
              >
                <Pause className="h-4 w-4" />
                Pause
              </button>
            ) : (
              <button
                onClick={actions.resume}
                className="px-10 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2"
              >
                <Play className="h-4 w-4" />
                Resume
              </button>
            )}
            <button
              onClick={actions.fwd5}
              className="px-10 py-2 rounded-xl border hover:bg-slate-50 flex items-center gap-2"
            >
              5s <FastForward className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 text-sm text-slate-600 space-y-1 flex items-center justify-center flex-col">
            <div>
              Status: <b>{snap?.playing ? "▶️ Playing" : "⏸️ Paused"}</b>
            </div>
            <div>
              Rate:{" "}
              <RateSelect
                value={snap?.rate ?? 1}
                onChange={(v) => actions.setRate(v)}
              />
            </div>
          </div>
        </div>

        {/* Map & timeline */}
        <section className="space-y-4">
          <div className="bg-white rounded-2xl shadow p-3">
            <div className="flex items-center gap-2 mb-3 font-medium">
              <MapIcon className="h-4 w-4" />
              Trajectory
            </div>
            <TrackMap
              pathPoints={staticPoints}
              current={planeCurrent ?? undefined}
            />
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm text-slate-600">
                Time: <b>{fmtTime(planeCurrent?.ts)}</b>
              </div>
              <div className="text-sm text-slate-600">
                Alt: <b>{planeCurrent?.pressureAltitude ?? 0}</b> ft
              </div>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  margin={{ left: 12, right: 12, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" />
                  {/* Use numeric ts + format ticks to HH:MM:SS */}
                  <XAxis
                    dataKey="ts"
                    minTickGap={24}
                    tickFormatter={(v) => fmtTime(v)}
                    type="number"
                    domain={["dataMin", "dataMax"]}
                  />
                  <YAxis width={46} />
                  <Tooltip
                    labelFormatter={(v) => fmtTime(Number(v))}
                    formatter={(val) => [val, "Alt (ft)"]}
                  />
                  <Line type="monotone" dataKey="alt" dot={false} />

                  {/* Vertical cursor showing “where the plane is” */}
                  {markerTs != null && (
                    <ReferenceLine
                      x={markerTs}
                      stroke="#334155" // slate-700
                      strokeDasharray="4 4"
                      strokeWidth={2}
                      label={{
                        value: "Now",
                        position: "top",
                        fill: "#334155",
                        fontSize: 12,
                      }}
                    />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Timeline slider (socket-backed) */}
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={0}
                max={Math.max(0, total - 1)}
                value={idx}
                onChange={(e) => actions.seekIdx(Number(e.target.value))}
                className="w-full"
              />
              <div className="text-xs text-slate-600 w-28 text-right">
                {idx + 1} / {total || 0}
              </div>
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow p-4">
            <div className="font-medium mb-2">Current Point</div>
            <div className="text-sm grid grid-cols-5 gap-5">
              <Altimeter
                altitude={planeCurrent?.pressureAltitude ?? 0}
                showBox={false}
              />
              <HeadingIndicator
                heading={planeCurrent?.magHeading ?? 0}
                showBox={false}
              />
              <div className="relative">
                <Airspeed
                  speed={planeCurrent?.computedAirspeed ?? 0}
                  showBox={false}
                />
                <div className="absolute top-[132px] left-[104px] text-xs text-white z-[99999]">
                  <h1 className="text-white text-3xl  z-[99999">
                    {planeCurrent?.computedAirspeed}
                  </h1>
                </div>
              </div>
              <Variometer
                vario={planeCurrent?.verticalSpeed ?? 0}
                showBox={false}
              />
              <AttitudeIndicator
                roll={planeCurrent?.rollAngle}
                pitch={planeCurrent?.pitchAngle}
                showBox={false}
              />
            </div>
            <div className="grid grid-cols-5">
              <FlagCell
                label="Gear Selection Up"
                value={planeCurrent?.gearSelectionUp}
                trueText="1"
                falseText="0"
              />
              <FlagCell
                label="A/P 1 Engaged"
                value={planeCurrent?.ap1Engaged}
                trueText="1"
                falseText="0"
              />
              <FlagCell
                label="A/P 2 Engaged"
                value={planeCurrent?.ap2Engaged}
                trueText="1"
                falseText="0"
              />
              <FlagCell
                label="Air/Ground"
                value={planeCurrent?.airGround}
                trueText="1" // 1 = AIR (if that's how your backend encodes it)
                falseText="0" // 0 = GROUND
              />
              <FlapNumber value={planeCurrent?.flapPosition} />
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

function RateSelect({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <select
      className="ml-2 px-2 py-1 border rounded-lg"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {[0.5, 1, 2, 4, 8].map((v) => (
        <option key={v} value={v}>
          {v}x
        </option>
      ))}
    </select>
  );
}
