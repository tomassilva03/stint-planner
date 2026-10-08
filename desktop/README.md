# Nightstint desktop app (Windows)

One small program for the driving PC. It runs the iRacing helper in the background, with an icon
in the tray, so Nightstint in your browser fills in actual ends and laps by itself and shows the
live strip on the Stints tab. It has no window of its own: the planner is the website, for
drivers and teammates alike.

## Install

1. Download `Nightstint_..._x64-setup.exe` from the latest release:
   https://github.com/tomassilva03/stint-planner/releases/latest
2. Windows may say it protected your PC, because the installer isn't signed. Choose
   **More info → Run anyway**.
3. Nightstint opens in your browser and connects to the helper by itself. If the browser asks
   whether the site may access devices on your local network, allow it: that's the helper.

It installs for your Windows user only (no admin needed) and starts with Windows, quietly in the
tray, so the helper is always ready when you drive.

## Tray menu

Right-click the moon icon near the clock. The top line shows the version you have
("Nightstint helper 0.1.12"), and so does the icon's tooltip when you hover it.

- **Open Nightstint** opens the planner in your browser (so does a left click on the icon).
- **Demo race (no iRacing)** plays a made-up 70 minute race through the helper, to try everything
  without driving: in real time, 10x or 30x faster (about 2.5 minutes). **Off** goes back to
  reading iRacing. The website plays the same race by itself too (**Demo race** in the plan menu),
  on any computer.
- **Restart iRacing helper** if something looks stuck.
- **Open recordings folder** has each session's readings (`<date>-samples.jsonl`) and events.
  Send the samples file to check or debug a session.
- **Start with Windows** turns auto-start on or off.
- **Check for updates** installs a newer version if there is one.
- **Quit Nightstint** stops the app and the helper.

The helper's own messages are in `%LOCALAPPDATA%\com.nightstint.desktop\logs\helper.log`.

## Which site it opens

**Open Nightstint** opens the live site, https://stint-planner-three.vercel.app, with `?live` so
the page connects to the helper without a click. Every installer does this, including ones built
from a pull request. To use another address, e.g. `http://localhost:5173` or a Vercel preview,
start the app with the `NIGHTSTINT_URL` environment variable set; the helper then accepts that
site too.

## Updates

Changes to the app or the helper update installed apps by themselves. Every merge to `main` that
touches `desktop/`, `helper/` or `src/live/` publishes a new release, and the app installs it the
next time it starts (or from **Check for updates** in the tray menu). The top line of the tray menu
shows the version you have.

Updates are signed, and the app only accepts ones signed with the project's key. The public half
is in `src-tauri/tauri.conf.json`; the private half is the `TAURI_SIGNING_PRIVATE_KEY` repository
secret, with its password (if it has one) in `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. Without that secret, builds still work but no release is published.

## Building it yourself

GitHub Actions builds the installer on every change to `desktop/`, `helper/` or `src/live/`
(workflow `.github/workflows/desktop.yml`); pull requests get it as the **Nightstint-setup**
artifact on the run's page. To build on a Windows PC instead you need Node 22,
Rust (https://rustup.rs) and the Visual Studio C++ build tools, then:

```
cd helper && npm ci && cd ..
cd desktop && npm ci
npm run build      # installer lands in src-tauri/target/release/bundle/nsis
npm run dev        # or run it straight away
```

`npm run prepare-helper` bundles `helper/` into one file and copies your Node next to the app as
`nightstint-helper.exe`; the build ships both.

The icon comes from `icon.svg` (render it to a 1024 px PNG and run `npx tauri icon <png> -o src-tauri/icons`).
