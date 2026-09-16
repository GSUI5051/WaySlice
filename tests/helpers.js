/**
 * Shared fixtures for the test suites.
 */
import { prepareTrack } from '../js/geo/track.js';

/**
 * Builds a track along the equator heading east with per-point elevation and
 * timestamps. 0.001° of longitude ≈ 111.195 m.
 *
 * @param {{lonStep?:number, count:number, ele?:(i:number)=>number|null,
 *          time?:(i:number)=>number|null, hr?:(i:number)=>number|null,
 *          cad?:(i:number)=>number|null, power?:(i:number)=>number|null,
 *          temp?:(i:number)=>number|null}} cfg
 */
export function eastTrack({ count, lonStep = 0.001, ele, time, hr, cad, power, temp }) {
  const points = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat: 0,
      lon: i * lonStep,
      ele: ele ? ele(i) : null,
      time: time ? time(i) : null,
      hr: hr ? hr(i) : null,
      cad: cad ? cad(i) : null,
      power: power ? power(i) : null,
      temp: temp ? temp(i) : null,
      speed: null, distance: null, lap: null,
    });
  }
  return points;
}

export function prepared(points, name = 'test') {
  return prepareTrack(points, name);
}

/** Encodes files into a minimal ZIP archive using the "stored" method. */
export function buildStoredZip(files) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = encoder.encode(f.name);
    const data = typeof f.data === 'string' ? encoder.encode(f.data) : f.data;
    const local = new Uint8Array(30 + name.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true);
    dv.setUint16(4, 20, true);
    dv.setUint16(8, 0, true); // stored
    dv.setUint32(18, data.length, true);
    dv.setUint32(22, data.length, true);
    dv.setUint16(26, name.length, true);
    local.set(name, 30);
    chunks.push(local, data);
    central.push({ name, offset, size: data.length });
    offset += local.length + data.length;
  }
  const cdStart = offset;
  for (const c of central) {
    const cd = new Uint8Array(46 + c.name.length);
    const dv = new DataView(cd.buffer);
    dv.setUint32(0, 0x02014b50, true);
    dv.setUint16(10, 0, true);
    dv.setUint32(20, c.size, true);
    dv.setUint32(24, c.size, true);
    dv.setUint16(28, c.name.length, true);
    dv.setUint32(42, c.offset, true);
    cd.set(c.name, 46);
    chunks.push(cd);
    offset += cd.length;
  }
  const eocd = new Uint8Array(22);
  const dv = new DataView(eocd.buffer);
  dv.setUint32(0, 0x06054b50, true);
  dv.setUint16(8, central.length, true);
  dv.setUint16(10, central.length, true);
  dv.setUint32(12, offset - cdStart, true);
  dv.setUint32(16, cdStart, true);
  chunks.push(eocd);

  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out.buffer;
}

/** Deflate-raw compression via the browser's CompressionStream. */
export async function deflateRaw(text) {
  const bytes = new TextEncoder().encode(text);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
