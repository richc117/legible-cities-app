// A small GTFS zip, its entries stored, written by hand: the tables a feed
// must carry (or all but the ones named), one row each, which is all the
// engine's `feeds.add` checks a zip for before it keeps it. The same shape
// `feeds-real.test.ts` and the end-to-end suite write.

import { writeFileSync } from 'node:fs'

const STEMS = ['agency', 'stops', 'routes', 'trips', 'stop_times', 'calendar'] as const
export type Stem = (typeof STEMS)[number]

const crc = (buf: Buffer): number => {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

/** Writes the zip at `path`, without the tables `without` names, and answers the path. */
export function gtfsZip(path: string, without: Stem[] = []): string {
  const entries: { name: string; body: Buffer }[] = []
  for (const stem of STEMS) {
    if (without.includes(stem)) continue
    const body =
      stem === 'agency'
        ? 'agency_id,agency_name\nM,Metro de Prueba\n'
        : stem === 'calendar'
          ? 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,0,0,20260101,20261231\n'
          : `${stem}_id\n1\n`
    entries.push({ name: `${stem}.txt`, body: Buffer.from(body) })
  }
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, body } of entries) {
    const n = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc(body), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc(body), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, n, body)
    centrals.push(central, n)
    offset += local.length + n.length + body.length
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  writeFileSync(path, Buffer.concat([...locals, ...centrals, end]))
  return path
}
