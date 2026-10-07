# Stint planner helper (live data from iRacing)

A small program for the PC that is driving. It reads iRacing's live data and sends it to the
stint planner open in your browser on the same PC. When the car leaves the pits after a stop, the
planner fills in that stint's **Actual end** and **Laps** by itself, and the rest of the race
recalculates.

Windows only, because the iRacing SDK only exists there.

## First time

1. Install Node.js 18 or newer (LTS) from https://nodejs.org.
2. Get this folder onto your PC (clone or download the repository).
3. Double-click `start.bat`. The first run installs what it needs; after that it starts straight away.

## Every race

1. Double-click `start.bat` and leave the window open while you drive.
2. Open the planner (https://stint-planner-three.vercel.app or `npm run dev`), open the race plan,
   go to **Stints** and press **Connect to iRacing**. The browser remembers this.
3. If Chrome asks whether the site may access devices on your local network, allow it. That is how
   the page reaches the helper on your own PC.

The strip on the Stints tab shows the current lap, last and average lap time, fuel, fuel per lap,
laps of fuel left and race time left.

Only the race session counts: pit stops in practice or qualifying are ignored, and so are
drive-throughs (the car never stops in its box). A stop only ever fills the stint after the last
one that already has an actual end, and only if it happens during the plan's race window, so
another plan you have open is never touched.

In a team, every driver can run the helper. Pit stops and laps are read for the team car, so
they're seen even on a PC whose driver isn't in the car. Fuel is only known on the PC that is
driving. Each stop has the same id on every PC, so it's never applied twice.

## Try it without iRacing

Double-click `demo.bat` (or `npm run demo`). It plays a made-up race at 10x speed: four stints, a
drive-through and a caution. To have the demo stops land inside a plan's race, pass a start time:

```
npm run demo -- --at 2026-10-11T13:00:00Z --speed 30
```

Use a copy of your plan for this, since the demo fills in real actual ends.

## Options

- `--port 47100` change the local port (the planner expects 47100).
- `--origin https://your-site.example` allow the planner hosted at another address to connect.
  The hosted site, its Vercel preview builds and `localhost` are allowed already; other websites
  are refused.

Every race event is also written to `logs/<date>-race.jsonl`, so nothing is lost if the browser
is closed.

## Recording a session to check later

While it runs on iRacing, the helper also records its readings to `logs/<date>-samples.jsonl`
(roughly 30 MB for a 24-hour race; turn it off with `--no-record`). To check what the planner
would do with a session, play it back:

```
npm start -- --replay logs/2026-10-07-samples.jsonl --speed 20
```

Names with accents: iRacing hands over names like "Tomás" with the accent lost. The planner
shows the name as spelled in the plan's Drivers tab when it matches.
