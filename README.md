# TurbineX Gesture —  Controlled 3D Explorer

A full-screen wireframe exploded-view jet engine controlled with your bare hand via webcam.
Three.js + MediaPipe Hand Landmarker, 100% in the browser. No backend, no build step.


## Run
Webcam needs `http://localhost` or `https://` (do not double-click index.html).

    python serve.py          # or: python -m http.server 8000 / npx serve .

Open http://localhost:8000 in Chrome or Edge and allow the camera.

Three.js and the MediaPipe library + WASM are bundled in `vendor/`. Only the ~8 MB hand model
downloads on first run (then browser-cached). For fully offline use run `sh download-model.sh`
once; the app picks up `vendor/hand_landmarker.task` automatically.

## Controls
| Input | Result |
|---|---|
| Open palm | Nozzle selected, end sections spin up |
| Index + middle | Core (compressor / combustion / turbine) |
| Index + middle + ring | Fan section |
| Fist | Compress into one piece |
| Move / tilt hand | Orbit / roll |
| Buttons or keys 1 2 3 4 | Nozzle / Core / Fan / Compress |
| R · H · ? | Reset view · toggle camera · help |
| Drag · wheel · pinch · + / - | Orbit · zoom |

Gestures hold ~0.2 s to trigger. Thumb is ignored. Everything works without a camera.

## Structure
    index.html  style.css  main.js  serve.py  download-model.sh
    vendor/three.module.min.js          Three.js r160
    vendor/mediapipe/                   tasks-vision 0.10.14 (+ wasm)

## Customize (main.js)
UP_RATIO / DOWN_RATIO (sensitivity), HOLD_MS, EXPLODED_X / ASSEMBLED_X, buildFan / buildCore / buildNozzle,
BLUE / LIME colors, title gradient in style.css.

## Deploy
GitHub Pages, Vercel or Netlify (static, HTTPS so webcam works). Host must serve `.wasm` as `application/wasm`.

## Privacy
Camera frames are processed locally. Nothing is uploaded or stored.

## Credits
Three.js (MIT) · MediaPipe Tasks Vision (Apache 2.0) · Orbitron, Share Tech Mono, Space Mono (OFL)
