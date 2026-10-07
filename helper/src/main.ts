// Stint planner helper: run this on the PC that is driving.
//   npm start                 read iRacing
//   npm run demo              a made-up race, to try the link without iRacing
// Options: --port 47100  --origin https://my-site.example  --speed 10  --at 2026-10-11T12:00:00Z
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { demoRace } from '../../src/live/demo.ts';
import { Detector } from '../../src/live/detector.ts';
import { LIVE_PORT, PROTOCOL_VERSION, type HelperMessage, type LiveEvent, type Sample } from '../../src/live/protocol.ts';
import { IRacingReader, loadSdk } from './iracing.ts';
import { DEFAULT_ORIGINS, startServer } from './server.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const demo = args.includes('--demo');
const port = Number(opt('port') ?? LIVE_PORT);
const origins = [...DEFAULT_ORIGINS, ...args.flatMap((a, i) => (a === '--origin' ? [args[i + 1]] : []))];

const logDir = join(process.cwd(), 'logs');
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, `${new Date().toISOString().slice(0, 10)}-${demo ? 'demo' : 'race'}.jsonl`);

const detector = new Detector();
let waiting = true;
const server = startServer(port, origins, (send) => {
  send({ type: 'hello', version: PROTOCOL_VERSION, source: demo ? 'demo' : 'iracing' });
  if (waiting) send({ type: 'waiting' });
  send({ type: 'history', events: detector.history });
  send({ type: 'state', state: detector.state() });
});
server.wss.on('listening', () => {
  console.log(`Stint planner helper is running${demo ? ' (demo race)' : ''}.`);
  console.log(`Open the planner in your browser; it connects to ws://localhost:${port} by itself.`);
  console.log(`Race events are logged to ${logFile}`);
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
    case 'driverChange':
      return `Driver now ${e.driverName}`;
  }
};

function handle(sample: Sample, now: number) {
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

setInterval(() => server.broadcast({ type: 'state', state: detector.state() }), 500);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function runDemo() {
  const speed = Number(opt('speed') ?? 10);
  const start = opt('at') ? Date.parse(opt('at')!) : Date.now();
  for (const [t, s] of demoRace({ step: 0.5 })) {
    handle(s, start + t * 1000);
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
    let misses = 0;
    while (misses < 50) {
      const s = reader.read(100);
      if (!s) {
        misses++;
        continue;
      }
      misses = 0;
      handle(s, Date.now());
      // 10 readings a second is plenty for pit stops and laps
      await sleep(100);
    }
    sdk.stopSDK();
  }
}

void (demo ? runDemo() : runIRacing());
