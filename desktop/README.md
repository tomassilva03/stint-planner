# Nightstint desktop app (Windows)

One program for the driving PC. It opens Nightstint in its own window and runs the iRacing helper
in the background, so the Stints tab fills in actual ends and laps by itself and shows the live
strip. Teammates who don't drive keep using the website; it's the same site, plans and sign-in.

## Install

1. Open the latest **Desktop app** run under the repository's **Actions** tab and download the
   **Nightstint-setup** file at the bottom of the run. Unzip it and run `Nightstint_..._x64-setup.exe`.
2. Windows may say it protected your PC, because the installer isn't signed. Choose
   **More info → Run anyway**.
3. Nightstint opens. Sign in as on the website. The planner connects to the helper by itself.

It installs for your Windows user only (no admin needed) and starts with Windows, waiting in the
tray. Closing the window keeps it running there, so live data keeps flowing while you drive.

## Tray menu

Right-click the moon icon near the clock:

- **Open Nightstint** brings the window back (so does a left click).
- **Demo race (no iRacing)** plays a made-up race, to try everything without driving.
- **Restart iRacing helper** if something looks stuck.
- **Open recordings folder** has each session's readings (`<date>-samples.jsonl`) and events.
  Send the samples file to check or debug a session.
- **Start with Windows** turns auto-start on or off.
- **Quit Nightstint** stops the app and the helper.

The helper's own messages are in `%LOCALAPPDATA%\com.nightstint.desktop\logs\helper.log`.

## Which site it opens

The app shows the live site, https://stint-planner-three.vercel.app, so website updates reach it
without reinstalling. Only changes to the helper or the app itself need a new installer.

Every installer, including ones built from a pull request, opens the live site. (Vercel previews
ask for a Vercel login, which teammates don't have.) To point the app somewhere else, start it
with the `NIGHTSTINT_URL` environment variable set, e.g. `http://localhost:5173` or a preview
address; the title then says **(preview)**.

## Building it yourself

GitHub Actions builds the installer on every change to `desktop/`, `helper/` or `src/live/`
(workflow `.github/workflows/desktop.yml`). To build on a Windows PC instead you need Node 22,
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
