# Beam — iPhone ⇄ Windows file sharing over Wi-Fi

Beam runs a small server on your Windows laptop. Open it in the laptop's browser and in Safari on your iPhone, and both devices appear in the same "room". Tap a device to send photos, videos, files or text. Files go over your own Wi-Fi and never touch the internet.

- No app to install on the iPhone. It runs in Safari.
- No dependencies. You only need [Node.js](https://nodejs.org) 18 or newer.
- Files sent **to the laptop** are saved straight into `Downloads\Beam`.
- Files sent **to the iPhone** can be downloaded one at a time, as a single `.zip`, or opened in Safari and saved to Photos.
- Large files are streamed, so there is no size limit beyond free disk space.

## Start it

Double-click **`start.bat`**, or run:

```
npm start
```

The terminal prints something like:

```
  On this computer   http://localhost:8080
  On your iPhone     http://192.168.0.207:8080   (Wi-Fi)
  Received files     C:\Users\you\Downloads\Beam
```

Your laptop browser opens automatically. To connect the iPhone:

1. Join the same Wi-Fi network as the laptop.
2. Click **Connect a device** on the laptop and scan the QR code with the iPhone Camera, or type the `On your iPhone` address into Safari.
3. Both devices now show up in the room. Tap one to send.

Tip: in Safari, tap **Share → Add to Home Screen** to get a Beam icon on your iPhone.

## iPhone can't open the page?

This is almost always Windows Firewall.

- The first time Beam starts, Windows asks whether Node.js can use the network. Click **Allow**, and make sure **Private networks** is ticked.
- In **Settings → Network & internet → Wi-Fi → (your network)**, set the network profile to **Private**.
- If you clicked Cancel earlier, open PowerShell **as Administrator** and run:

  ```
  netsh advfirewall firewall add rule name="Beam" dir=in action=allow protocol=TCP localport=8080
  ```

- Some guest or office Wi-Fi networks block devices from talking to each other ("client isolation"). On those networks, use your phone's hotspot or a home network instead.
- If the terminal lists several addresses, use the one marked `(Wi-Fi)`.

## Saving on the iPhone

- **Download** saves to the Files app, in **On My iPhone → Downloads**.
- To put a photo or video in **Photos**, tap the **Open** icon, then long-press the image (or use the Share button) and choose **Save to Photos**.
- **Download all (.zip)** saves one zip. Tap it in Files to unzip.

## Settings

| Environment variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `8080` | Port to listen on. If it is busy, Beam tries the next ten ports. |
| `BEAM_DIR` | `%USERPROFILE%\Downloads\Beam` | Where files sent to this computer are saved. |

Example: `set PORT=9000 && node server.js`

## How it works

- `server.js` is a plain Node HTTP server. Each browser keeps a Server-Sent Events connection open, and that connection is how devices see each other and get notified of transfers.
- Sending a file is a streamed `PUT` to the server. When the receiver is the laptop itself, the file is written straight into the Beam folder. Otherwise it is kept in a temp folder until the receiver downloads it or dismisses it, or until 6 hours pass.
- Downloads support HTTP Range requests (needed for Safari video playback and resuming). "Download all" streams a zip built on the fly.
- Anyone on the same Wi-Fi who opens the address can join the room, so run Beam on networks you trust and stop it with **Ctrl+C** when you're done.

## Project layout

```
server.js         Node server (no dependencies)
public/index.html Page markup
public/app.css    Styles (light & dark)
public/app.js     Room, transfers, UI
public/icon.svg   App icon
start.bat         Double-click launcher for Windows
```
