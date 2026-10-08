// Stint planner helper: run this on the PC that is driving.
//   npm start                 read iRacing
//   npm run demo              a made-up race, to try the link without iRacing
//   npm start -- --replay logs/2026-10-07-samples.jsonl   play back a recorded session
//   npm start -- --check-sdk  exit 0 if the iRacing SDK loads on this PC, 1 if not
// Options: --port 47100  --origin https://my-site.example  --speed 10  --at 2026-10-11T12:00:00Z  --no-record  --logs <folder>
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { demoRace } from '../../src/live/demo.ts';
import { DemoField, demoOutline } from '../../src/live/demoField.ts';
import { Detector } from '../../src/live/detector.ts';
import { FieldTracker, type RawField } from '../../src/live/field.ts';
import { LIVE_PORT, PROTOCOL_VERSION, type HelperMessage, type LiveEvent, type Sample } from '../../src/live/protocol.ts';
import { IRacingReader, loadSdk } from './iracing.ts';
import { OutlineRecorder, OutlineStore } from './outline.ts';
import { DEFAULT_ORIGINS, startServer } from './server.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const demo = args.includes('--demo');
const replay = opt('replay');
const port = Number(opt('port') ?? LIVE_PORT);
const origins = [...DEFAULT_ORIGINS, ...args.flatMap((a, i) => (a === '--origin' ? [args[i + 1]] : []))];

if (args.includes('--check-sdk')) {
  const ok = !!(await loadSdk());
  console.log(ok ? 'iRacing SDK loaded.' : 'iRacing SDK could not be loaded.');
  process.exit(ok ? 0 : 1);
}

const logDir = opt('logs') ?? join(process.cwd(), 'logs');
mkdirSync(logDir, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
const logFile = join(logDir, `${day}-${demo ? 'demo' : replay ? 'replay' : 'race'}.jsonl`);
// Raw readings, so a session can be played back later to check or debug the planner
const record = !demo && !replay && !args.includes('--no-record');
const sampleFile = join(logDir, `${day}-samples.jsonl`);
let lastRecorded: { at: number; key: string } | null = null;

const detector = new Detector();
// The whole field and the track's shape, for the Race engineer tab
const field = new FieldTracker();
const outlines = new OutlineStore(join(logDir, 'tracks'));
let outline: { track: string; points: number[] } | null = null;
let fieldTrack = '';
let waiting = true;
const server = startServer(port, origins, (send) => {
  send({ type: 'hello', version: PROTOCOL_VERSION, source: demo ? 'demo' : 'iracing' });
  if (waiting) send({ type: 'waiting' });
  send({ type: 'history', events: detector.history });
  send({ type: 'state', state: detector.state() });
  if (outline) send({ type: 'outline', ...outline });
  const snap = field.snapshot();
  if (snap) send({ type: 'field', field: snap });
});
server.wss.on('listening', () => {
  console.log(`Stint planner helper is running${demo ? ' (demo race)' : ''}.`);
  console.log(`Open the planner in your browser; it connects to ws://localhost:${port} by itself.`);
  console.log(`Race events are logged to ${logFile}`);
  if (record) console.log(`Readings are recorded to ${sampleFile} (send this file to check a session)`);
  console.log('Leave this window open while you drive. Press Ctrl+C to stop.\n');
});
server.wss.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `Port ${port} is already in use. Is the helper already running in another window?` : e);
  process.exit(1);
});

const describe = (e: LiveEvent) => {
  switch (e.kind) {
    case 'pitExit':
      return e.stopped ? `Left the pits after a ${e.stopSec ?? '?'} s stop (lap ${e.lapsCompleted})` : `Drive-through, lap ${e.lapsCompleted}`;
    case 'pitEntry':
      return `In the pits, lap ${e.lapsCompleted}`;
    case 'lap':
      return `Lap ${e.lapsCompleted}${e.lapTime ? `  ${e.lapTime.toFixed(3)} s` : ''}${e.fuelUsed ? `  ${e.fuelUsed.toFixed(2)} L` : ''}${e.green ? '' : '  (not green)'}`;
    case 'cautionStart':
      return 'Caution';
    case 'cautionEnd':
      return 'Green flag';
    case 'finish':
      return `Took the chequered flag (lap ${e.lapsCompleted})`;
    case 'driverChange':
      return `Driver now ${e.driverName}`;
  }
};

/** Writes a reading when something that matters changed, and otherwise once a second */
function recordSample(sample: Sample, now: number) {
  const key = [sample.sessionNum, sample.lapsCompleted, sample.lastLapTime, sample.onPitRoad, sample.inPitStall, sample.flags, sample.driverName].join('|');
  if (lastRecorded && lastRecorded.key === key && now - lastRecorded.at < 1000) return;
  lastRecorded = { at: now, key };
  appendFileSync(sampleFile, JSON.stringify({ at: now, s: sample }) + '\n');
}

function handle(sample: Sample, now: number) {
  if (record) recordSample(sample, now);
  if (waiting) {
    waiting = false;
    console.log(`Connected to ${sample.track || 'the session'}${sample.car ? `, ${sample.car}` : ''}.`);
  }
  for (const e of detector.push(sample, now)) {
    appendFileSync(logFile, JSON.stringify(e) + '\n');
    if (e.kind !== 'lap' || e.lapsCompleted % 5 === 0) console.log(`${new Date(now).toLocaleTimeString()}  ${describe(e)}`);
    server.broadcast({ type: 'event', event: e } satisfies HelperMessage);
  }
}

function handleField(f: RawField) {
  field.push(f);
  if (f.track && f.track !== fieldTrack) {
    fieldTrack = f.track;
    const points = demo ? demoOutline() : outlines.load(f.track);
    outline = points ? { track: f.track, points } : null;
    if (outline) server.broadcast({ type: 'outline', ...outline });
  }
}

function newOutline(track: string, points: number[]) {
  // Keep the first good lap: later laps only redraw the same track
  if (!track || outline?.track === track) return;
  outline = { track, points };
  outlines.save(track, points);
  server.broadcast({ type: 'outline', ...outline });
  console.log(`Drew the track map for ${track}.`);
}

setInterval(() => {
  server.broadcast({ type: 'state', state: detector.state() });
  const snap = field.snapshot();
  if (snap) server.broadcast({ type: 'field', field: snap });
}, 500);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runDemo() {
  const speed = Number(opt('speed') ?? 10);
  const start = opt('at') ? Date.parse(opt('at')!) : Date.now();
  const others = new DemoField();
  for (const [t, s] of demoRace(0.5)) {
    handle(s, start + t * 1000);
    handleField(others.read(t, s));
    await sleep(500 / speed);
  }
  console.log('Demo race finished. Press Ctrl+C to stop.');
}

async function runIRacing() {
  const mod = await loadSdk();
  if (!mod) {
    console.error('Could not load the iRacing SDK. It only works on Windows; run `npm install` in this folder first.');
    process.exit(1);
  }
  console.log('Waiting for iRacing...');
  for (;;) {
    if (!(await mod.IRacingSDK.IsSimRunning())) {
      if (!waiting) {
        waiting = true;
        server.broadcast({ type: 'waiting' });
        console.log('iRacing closed. Waiting for it to start again...');
      }
      await sleep(2000);
      continue;
    }
    const sdk = new mod.IRacingSDK();
    sdk.startSDK();
    const reader = new IRacingReader(sdk);
    const recorder = new OutlineRecorder();
    let misses = 0;
    while (misses < 50) {
      const s = reader.read(100);
      if (!s) {
        misses++;
        continue;
      }
      misses = 0;
      handle(s, Date.now());
      const f = reader.field();
      if (f) handleField(f);
      const m = reader.motion();
      const drawn = m && recorder.push(m.pct, m.speed, m.yaw, m.onPitRoad, m.t);
      if (drawn) newOutline(s.track, drawn);
      // 10 readings a second is plenty for pit stops and laps
      await sleep(100);
    }
    sdk.stopSDK();
  }
}

async function runReplay(file: string) {
  const speed = Number(opt('speed') ?? 0);
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { at: number; s: Sample });
  console.log(`Playing back ${rows.length} readings from ${file}${speed ? ` at ${speed}x` : ''}.`);
  for (let i = 0; i < rows.length; i++) {
    handle(rows[i].s, rows[i].at);
    if (speed && i + 1 < rows.length) await sleep((rows[i + 1].at - rows[i].at) / speed);
  }
  console.log('Playback finished. Press Ctrl+C to stop.');
}

void (replay ? runReplay(replay) : demo ? runDemo() : runIRacing());
