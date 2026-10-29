// A small GTFS zip, its entries stored, written by hand: the tables a feed
// must carry (or all but the ones named), one row each, which is all the
// engine's `feeds.add` checks a zip for before it keeps it. The same shape
// `feeds-real.test.ts` and the end-to-end suite write.
//
// Its headers can also be made to say what its bytes do not, as a hostile
// zip's would: a table compressed by another method, or a size it does not
// unpack to. The engine judges a zip by those headers before it reads a
// byte of a table (its issue 81), so a few hundred bytes are enough to be
// refused as a zip of gigabytes; `endRecordOnly` is a zip of nothing but an
// end record that claims a count and a directory size.

import { writeFileSync } from 'node:fs'

const STEMS = ['agency', 'stops', 'routes', 'trips', 'stop_times', 'calendar'] as const
/** agency.txt, which a feed added with no name is named from, so its size is never stated. */
export const AGENCY = 'agency_id,agency_name\nM,Metro de Prueba\n'
export type Stem = (typeof STEMS)[number]

export interface Headers {
  /** The compression method a table's headers name (stored, 0, if left out). */
  method?: Partial<Record<Stem, number>>
  /** The unpacked size a table's headers state (its own, if left out). */
  size?: Partial<Record<Stem, number>>
  /** Members beyond the tables, each with what its headers state. */
  extra?: { name: string; body?: string; method?: number; size?: number }[]
}

const crc = (buf: Buffer): number => {
  let c = ~0
  for (const b of buf) {
    c ^= b
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

/** The zip's end record: how many entries, and the directory's size and offset. */
function endRecord(entries: number, size: number, offset: number): Buffer {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries, 8)
  end.writeUInt16LE(entries, 10)
  end.writeUInt32LE(size, 12)
  end.writeUInt32LE(offset, 16)
  return end
}

/** Writes the zip at `path`, without the tables `without` names, and answers the path. */
export function gtfsZip(path: string, without: Stem[] = [], headers: Headers = {}): string {
  const entries: { name: string; body: Buffer; method: number; size?: number }[] = []
  for (const stem of STEMS) {
    if (without.includes(stem)) continue
    const body =
      stem === 'agency'
        ? AGENCY
        : stem === 'calendar'
          ? 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\ns,1,1,1,1,1,0,0,20260101,20261231\n'
          : `${stem}_id\n1\n`
    entries.push({
      name: `${stem}.txt`,
      body: Buffer.from(body),
      method: headers.method?.[stem] ?? 0,
      size: headers.size?.[stem],
    })
  }
  for (const member of headers.extra ?? [])
    entries.push({
      name: member.name,
      body: Buffer.from(member.body ?? 'x\n'),
      method: member.method ?? 0,
      size: member.size,
    })
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const { name, body, method, size: stated } of entries) {
    const n = Buffer.from(name)
    const size = stated ?? body.length
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(method, 8)
    local.writeUInt32LE(crc(body), 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(size, 22)
    local.writeUInt16LE(n.length, 26)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(method, 10)
    central.writeUInt32LE(crc(body), 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(size, 24)
    central.writeUInt16LE(n.length, 28)
    central.writeUInt32LE(offset, 42)
    locals.push(local, n, body)
    centrals.push(central, n)
    offset += local.length + n.length + body.length
  }
  const centralSize = centrals.reduce((s, b) => s + b.length, 0)
  writeFileSync(
    path,
    Buffer.concat([...locals, ...centrals, endRecord(entries.length, centralSize, offset)]),
  )
  return path
}

/** A zip of nothing but an end record claiming `entries` and a directory of `size` bytes. */
export function endRecordOnly(path: string, entries: number, size: number): string {
  writeFileSync(path, endRecord(entries, size, 0))
  return path
}
