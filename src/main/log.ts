// One logger for the main process. Lines go to stderr as "[tag] message";
// A6-03 redirects them to a file by replacing the sink, without touching a
// call site. No Electron import, so pure modules and tests can use it.

type Sink = (line: string) => void

let sink: Sink = (line) => {
  process.stderr.write(line + '\n')
}

export function setSink(next: Sink): void {
  sink = next
}

export const log = {
  info(tag: string, message: string): void {
    sink(`[${tag}] ${message}`)
  },
  warn(tag: string, message: string): void {
    sink(`[${tag}] warning: ${message}`)
  },
  error(tag: string, message: string): void {
    sink(`[${tag}] error: ${message}`)
  },
}
