# Nightstint

A web app for planning iRacing endurance races, solo or as a team. It replaces the
Sassy Enduro Manager spreadsheet: stint timing from fuel and lap time, time-of-day and
per-driver pace, driver availability, live actual-end updates, fair share, the
save-a-stop calculator, strategy notes and driver change checklists.

## Just use it

Open `Stint Planner.html` (next to this folder) in Chrome, Edge or Firefox. No install needed.
Plans are saved in that browser. Use **Plans → Export plan** to back one up or send it
to a teammate, and **Plans → Import plan** to load it.

## Run the source locally

Needs Node.js 18 or newer.

```bash
cd app
npm install
npm run dev        # opens on http://localhost:5173
npm test           # checks the stint maths against the example spreadsheet
npm run build:single   # rebuilds the one-file version into dist-single/index.html
```

## How it is organised

- `src/model.ts`: the plan data model. League-only rules (safety cars, tyre set limits,
  driver time limits, minimum stops) live under `rules` and are off for special events.
- `src/engine.ts`: all the stint maths, auto-fill of stints to the flag, and auto-assign.
- `src/engine.test.ts`: reproduces the 22 stint end times of the example 24h sheet to within 1 second.
- `src/strategy/`: the race strategist. `estimator.ts` turns live laps and fuel into the current race state
  (robust pace and fuel per lap, the lap the tank runs dry, fuel margin, confidence). It only estimates;
  `replay.ts` plays a recorded or demo race through it for tests.
- `src/views/`: one file per tab (Overview, Race setup, Drivers, Availability, Stints, Notes).

## Maths (same as the spreadsheet)

- Laps per tank = floor(tank ÷ fuel per lap). Fuel saving uses the saving factors from Race setup.
- Stint length = laps × lap time × time-of-day factor × driver factor + pit stop (+ tyres).
- The time-of-day factor is the one for the in-sim time when the stint starts.
- Driver factor = driver lap time ÷ team average lap time.
- The last stint ends at the flag: laps = time left ÷ lap time, rounded up.
- Once you log a stint's actual end, every later stint starts from it.
- Fair share = 25% of an even split of race laps (special events only).

## During the race

Every stint shows its **expected end** (when the car should be back on track). When something
unplanned happens, press **Log event** on that stint and enter:

- **Time lost**: a repair, a long stop or a penalty, e.g. `10` for ten minutes.
- **Safety car laps**: slower and lighter on fuel, so the stint runs longer. Tick *Stop under the safety car*
  if you pitted while it was out.
- **Slower by**: seconds per lap lost to traffic or damage.
- **Actual laps** and a **note**.

The expected end and every later stint move straight away. When the car rejoins, type the **actual
end** time (or press **Now**). From then on the rest of the race is calculated from that real time.

## League rules

Switch a plan to **League** at the top, then turn rules on under Race setup → League rules:

- **Safety cars**: set how many to expect, laps per safety car, how much slower and how much less fuel
  a safety car lap is, and the time lost for a stop under the safety car. Add SC laps per stint on the
  Stints tab, or press *Spread expected safety cars*. SC laps burn less fuel, so that stint gets longer.
- **Tyre set limit**: each stop with tyres ticked fits a new set; the plan shows which set each stint
  runs on and warns from the first stint beyond the limit.
- **Driver time limits** (team): minimum and maximum total driving per driver, and a maximum time in
  the car in one go (back-to-back stints count together). Auto-assign respects the last one.
- **Minimum pit stops**: warns when the plan has fewer stops than required.

## Live data from iRacing (optional)

Drivers install the **Nightstint desktop app** on the driving PC (see [desktop/README.md](desktop/README.md)).
It runs the iRacing helper in the background from the tray, and Nightstint in the browser
connects to it: each stint's actual end and laps fill in by themselves when the car leaves the
pits (and the last stint's when it takes the chequered flag), and a live strip on the Stints tab shows lap times and fuel.
Under it, **Right now** shows the estimated pace and fuel per lap against the plan, the lap the tank
runs dry, the fuel margin at the planned stop (or the flag) and how confident the estimate is. Pace and
fuel come from the current stint's green laps, ignoring odd laps, and lean on the rest of the race
until a stint has three green laps.

Below that, the strategy call says what to do now: keep the plan, pit this lap, stay out longer or save
fuel, with the time it gains, the fuel left at the stop, a confidence and the reasons. Every option is
played to the flag at the current pace and fuel use, with full-tank stints after the stop and the plan's
stop time (the safety car stop time under caution), and compared by how far the car gets before time
runs out. The plan only changes for a gain of 5 s or more, options with more than a 15% chance of running
dry are never recommended, and when the plan itself won't make its stop the call turns red.

Developers can also run the helper by hand from `helper/`; see [helper/README.md](helper/README.md).

To try all of this without iRacing, or on a Mac, pick **Demo race** from the plan menu: the website plays
a made-up 70 minute race by itself (a slower driver, a long stint, a safety car, a slow stop and a
penalty) and fills in the demo plan as it goes. The live strip switches its speed between real time,
10x and 30x (about 2.5 minutes), and the Race engineer tab shows its whole field.

### Race engineer tab

The **Race engineer** tab follows the race live: a track map with every car, the standings
(by class), the cars just ahead of and behind ours on the road, and our car's lap, gaps,
fuel and pit stops. The helper reads the whole field from iRacing and draws the track's shape
from the first clean lap the driving PC completes (saved per track, so it is there next time).

Teammates who aren't driving see the same thing remotely: the page on the PC running the helper
shares a small feed once a second on a private Supabase Realtime channel for the plan, and
anyone the plan is shared with can watch it (signed in, on a plan saved to an account).
Nothing is stored. Fuel is only known on the PC that is driving. The channel's access rules are
at the end of `supabase/schema.sql`.

## Accounts and sharing (optional)

Without this the app works exactly as before and keeps plans in your browser. With it, you sign in
(Google or an email link), your plans follow you to every device, and you can share a plan with
teammates as editor or viewer. Changes show up for everyone within a second or two.

### 1. Create the database (free)

1. Make an account at https://supabase.com and create a new project. Any region near you is fine.
2. In the project, open **SQL Editor → New query**, paste the whole of `supabase/schema.sql` and press **Run**.
3. Open **Project Settings → API** and copy the **Project URL** and the **anon public** key.
4. In this folder, copy `.env.example` to `.env.local` and paste the two values in.
5. Open **Authentication → URL Configuration** and set **Site URL** to `http://localhost:5173`.
   Add the same address under **Redirect URLs** (and later the address where you host the app).
6. Restart `npm run dev`. The **Sign in** button now works with email links.

### 2. Turn on Google sign-in

1. In https://console.cloud.google.com create a project, then **APIs & Services → Credentials →
   Create credentials → OAuth client ID → Web application**.
2. Under **Authorized redirect URIs** add `https://<your-project>.supabase.co/auth/v1/callback`
   (Supabase shows the exact address on its Google provider page).
3. Copy the client ID and secret into Supabase under **Authentication → Providers → Google** and enable it.

### 3. Let teammates in

Teammates can't reach `localhost` on your PC, so put the app online. Free options: Vercel or
Netlify. Point them at this folder, use `npm run build` as the build command and `dist` as the output
folder, and add the same two `VITE_SUPABASE_...` values as environment variables. Then add the new
address to Supabase's Redirect URLs.

To share a plan: open it, press **Save to my account**, then **Share** and add your teammate's email.
They sign in with that email and the plan appears in their list. Viewers can see everything but not
change it.

### Notes

- Plans you made before signing in stay on that device until you press **Save to my account**.
- If you lose connection mid-race, keep editing. Changes save automatically when you're back online.
- If two people edit the same plan at the same moment, the last save wins for the whole plan.
- iRacing sign-in needs iRacing to approve this app for their login. It will be added once that's done.

## Checks and deploys

Every pull request and every push to `main` runs the checks in `.github/workflows/ci.yml` on GitHub:

- **Typecheck, test and build**: `tsc`, the Vitest tests, the normal build and the one-file build.
- **Database schema applies**: runs `supabase/schema.sql` twice on a fresh Postgres 16, so a broken or
  non-rerunnable schema change shows up before it reaches Supabase.

Run the same thing locally before pushing with `npm test && npm run build`.

Vercel does the deploying: each pull request gets its own preview link (Vercel posts it on the PR),
and merging to `main` updates https://stint-planner-three.vercel.app/. For sign-in to work on preview
links, the two `VITE_SUPABASE_...` variables must be enabled for **Preview** in Vercel, and Supabase's
Redirect URLs need `https://stint-planner-*-tomassilva03s-projects.vercel.app/**` (don't use a bare
`*.vercel.app`, which would let any Vercel site receive sign-ins).

To stop anything reaching `main` with red checks, in GitHub go to **Settings → Branches → Add branch
ruleset** (or classic rule) for `main`, require a pull request, and require the status checks
**Typecheck, test and build** and **Database schema applies**. The checks appear in the picker after
they have run once.
