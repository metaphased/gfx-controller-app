# MetaGFX OMT renderer

Outputs MetaGFX graphics as native **OMT** (Open Media Transport) video sources with a real
alpha channel — vMix / OBS (with the [OMT plugin](https://github.com/openmediatransport/omtplugin))
receive key+fill over the network with **no browser source** involved.

One Electron process renders every configured output offscreen (GPU-composited) and pushes
frames into `libomt` senders. Sources appear on the network as `HOSTNAME (MetaGFX — <name>)`.

## Components (not in the repo)

`vendor/` holds the runtime pieces, downloaded by the **in-app installer** (Routing page):

- `vendor/electron/` — Electron runtime (pinned 38.x — Electron 39 has an offscreen-rendering
  transparency regression, electron/electron#48931)
- `vendor/omt/` — `libomt.dll`, `libvmx.dll`, `libomtnet.dll` + license (MIT, from
  github.com/openmediatransport releases)

`koffi` (the FFI layer) is a normal dependency of the main app; the renderer resolves it from
the app's `node_modules`. For development, `OMT_BIN` overrides the DLL folder.

## Running

Spawned by the MetaGFX server when OMT outputs are enabled (Routing page). Manual forms:

```powershell
# against a running MetaGFX server (this is also the REMOTE RENDER NODE mode —
# run it on another PC against the server's EXTERNAL_URL to move the encode load)
vendor\electron\electron.exe . --server=http://127.0.0.1:3000 --token=<graphics token>

# fully manual config
vendor\electron\electron.exe . --config=my-config.json
```

Config shape (`/api/omt/config` returns the same):

```json
{ "namePrefix": "MetaGFX",
  "outputs": [
    { "id": "busA", "name": "Bus A", "url": "/bus/busA?token=XXX", "fps": 60 },
    { "id": "win",  "name": "Win Screen", "url": "/graphics/win-screen/?token=XXX", "fps": 30 }
  ] }
```

Relative `url`s resolve against `--server`. Max 4 outputs (perf guardrail). `--software`
disables GPU compositing (diagnostic only — full-frame content like the COMP win screen
needs the GPU: 60fps @ ~18% CPU vs 37fps @ ~56% in software).

## Protocol (stdio)

One JSON object per stdout line: `{type:'ready',outputs:[…]}` on start,
`{type:'stats',cpuPercentOfCore,outputs:[{id,fps,paintsPerSec,connections,mbps}…]}` every 2s,
`{type:'error'|'fatal',message}` on trouble. The renderer exits when **stdin closes** (orphan
protection) or on SIGTERM. Pages self-heal (reload on renderer crash / load failure).

First run: expect a **Windows Firewall** prompt — OMT listens on TCP 6400+ for receivers.
Library logs land in `C:\ProgramData\OMT\logs`.

Performance baselines + the hard-won implementation gotchas are in `omt-spike/README.md`
(the validated proof-of-concept this productionizes).
