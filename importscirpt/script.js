#!/usr/bin/env node
/**
 * Import FDR Excel -> MySQL (fdr_records)
 *
 * Usage:
 *   node scripts/import-fdr-excel.js ./data/flight.xlsx
 *
 * Requires .env with DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_DATABASE
 */
const fs = require("fs");
const path = require("path");
const xlsx = require("xlsx");
const mysql = require("mysql2/promise");

require('dotenv').config({ path: path.resolve(process.cwd(), '.env') });




const TABLE = "fdr_records";

// Excel header → DB column mapping (must match your sheet headers)
const H = {
  "FDR Time": "fdr_time",
  "UTC Time (hh:mm:ss)": "utc_time",
  "Date": "date",
  "Flight Number": "flight_number",
  "Pressure Altitude (feet)": "pressure_altitude",
  "Pitch Angle (Deg.)": "pitch_angle",
  "Roll Angle (degs.)": "roll_angle",
  "Mag Heading (degs.)": "mag_heading",
  "Computed Airspeed (knots)": "computed_airspeed",
  "Vertical Speed (ft/min)": "vertical_speed",
  "Latitude (degrees)": "latitude",
  "Longitude (degrees)": "longitude",
  "Flap Position (degrees)": "flap_position",
  "Gear Selection Up": "gear_selection_up",
  "A/P 1 Engaged": "ap1_engaged",
  "A/P 2 Engaged": "ap2_engaged",
  "Air/Ground": "air_ground",
};

// ---- helpers ---------------------------------------------------------------

const toInt = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
};

const toFloat = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const to01 = (v) => {
  if (v === null || v === undefined || v === "") return null; // keep NULL
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "yes", "up", "engaged", "air"].includes(s)) return 1;
    if (["0", "false", "no", "down", "off", "ground"].includes(s)) return 0;
  }
  const n = Number(v);
  if (n === 1) return 1;
  if (n === 0) return 0;
  return null; // unknowns stay NULL
};

const pad2 = (n) => String(n).padStart(2, "0");

function toUtcString(v) {
  // normalize to "HH:MM:SS"
  if (v == null || v === "") return "00:00:00";
  if (v instanceof Date) {
    const hh = pad2(v.getUTCHours());
    const mm = pad2(v.getUTCMinutes());
    const ss = pad2(v.getUTCSeconds());
    return `${hh}:${mm}:${ss}`;
  }
  if (typeof v === "number") {
    // Excel time as fraction of a day (0..1)
    if (v > 0 && v < 1) {
      const totalSec = Math.round(v * 86400);
      const hh = pad2(Math.floor(totalSec / 3600));
      const mm = pad2(Math.floor((totalSec % 3600) / 60));
      const ss = pad2(totalSec % 60);
      return `${hh}:${mm}:${ss}`;
    }
    // seconds from midnight
    if (v >= 1 && v < 86400) {
      const hh = pad2(Math.floor(v / 3600));
      const mm = pad2(Math.floor((v % 3600) / 60));
      const ss = pad2(Math.floor(v % 60));
      return `${hh}:${mm}:${ss}`;
    }
  }
  // string like "15:08:03" -> normalize
  const s = String(v).trim();
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(s);
  if (m) {
    const hh = pad2(Number(m[1]) || 0);
    const mm = pad2(Number(m[2]) || 0);
    const ss = pad2(Number(m[3]) || 0);
    return `${hh}:${mm}:${ss}`;
  }
  return "00:00:00";
}

// Date column: prefer yyyymmdd; if Excel date object, convert
function toYYYYMMDD(v) {
  if (v == null || v === "") return null;
  if (v instanceof Date) {
    const y = v.getUTCFullYear();
    const m = pad2(v.getUTCMonth() + 1);
    const d = pad2(v.getUTCDate());
    return Number(`${y}${m}${d}`);
  }
  const s = String(v).trim();
  if (/^\d{8}$/.test(s)) return Number(s); // already yyyymmdd
  // try parse "YYYY-MM-DD" or similar
  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const y = d.getUTCFullYear();
    const m = pad2(d.getUTCMonth() + 1);
    const dd = pad2(d.getUTCDate());
    return Number(`${y}${m}${dd}`);
  }
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---- main ------------------------------------------------------------------

(async function main() {
  const file = process.argv[2];
  if (!file) {
    console.error("Usage: node scripts/import-fdr-excel.js <excel-file.xlsx>");
    process.exit(1);
  }
  if (!fs.existsSync(file)) {
    console.error("File not found:", file);
    process.exit(1);
  }

  // read workbook
  const wb = xlsx.readFile(file, { cellDates: true });
  const wsName = wb.SheetNames[0];
  const ws = wb.Sheets[wsName];

  // rows as objects keyed by header text
  const rows = xlsx.utils.sheet_to_json(ws, { raw: true, defval: null });

  console.log(`Parsed ${rows.length} rows from sheet "${wsName}"`);

  // map to DB rows
  const data = rows.map((r, i) => {
    const flight_number = (r["Flight Number"] ?? "").toString().trim();
    const date = toYYYYMMDD(r["Date"]);
    const utc_time = toUtcString(r["UTC Time (hh:mm:ss)"]);
    const fdr_time = toInt(r["FDR Time"]);

    const pressure_altitude = toInt(r["Pressure Altitude (feet)"]);
    const pitch_angle = toInt(r["Pitch Angle (Deg.)"]);
    const roll_angle = toInt(r["Roll Angle (degs.)"]);
    const mag_heading = toInt(r["Mag Heading (degs.)"]);
    const computed_airspeed = toInt(r["Computed Airspeed (knots)"]);
    const vertical_speed = toInt(r["Vertical Speed (ft/min)"]);
    const latitude = toFloat(r["Latitude (degrees)"]);
    const longitude = toFloat(r["Longitude (degrees)"]);
    const flap_position = toInt(r["Flap Position (degrees)"]);

    const gear_selection_up = to01(r["Gear Selection Up"]);
    const ap1_engaged = to01(r["A/P 1 Engaged"]);
    const ap2_engaged = to01(r["A/P 2 Engaged"]);
    const air_ground = to01(r["Air/Ground"]);

    // basic required fields
    if (!flight_number || !date || !utc_time) {
      console.warn(`Row ${i + 2}: missing required fields; will still insert with nulls where allowed.`);
    }

    return {
      flight_number,
      date,
      utc_time,
      fdr_time,
      pressure_altitude,
      pitch_angle,
      roll_angle,
      mag_heading,
      computed_airspeed,
      vertical_speed,
      latitude,
      longitude,
      flap_position,
      gear_selection_up,
      ap1_engaged,
      ap2_engaged,
      air_ground,
    };
  });

  // connect DB
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_DATABASE,
    multipleStatements: false,
    supportBigNumbers: true,
    dateStrings: true,
  });

  const cols = [
    "flight_number",
    "date",
    "utc_time",
    "fdr_time",
    "pressure_altitude",
    "pitch_angle",
    "roll_angle",
    "mag_heading",
    "computed_airspeed",
    "vertical_speed",
    "latitude",
    "longitude",
    "flap_position",
    "gear_selection_up",
    "ap1_engaged",
    "ap2_engaged",
    "air_ground",
  ];

  // batch insert (e.g., 1000 rows per batch)
  const BATCH = 1000;
  let inserted = 0;

  for (let i = 0; i < data.length; i += BATCH) {
    const slice = data.slice(i, i + BATCH);
    const placeholders = slice.map(() => `(${cols.map(() => "?").join(",")})`).join(",");
    const values = slice.flatMap((row) => cols.map((c) => row[c]));
    const sql = `INSERT INTO \`${TABLE}\` (${cols.map((c) => `\`${c}\``).join(",")}) VALUES ${placeholders}`;
    await conn.execute(sql, values);
    inserted += slice.length;
    console.log(`Inserted ${inserted}/${data.length}...`);
  }

  await conn.end();
  console.log(`✅ Done. Inserted ${inserted} rows into ${TABLE}.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});

