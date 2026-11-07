# GymCoach AI - Mobile Push-up Form & Rep Counter ⚡

> **Real-time, on-device AI push-up counter and form coach running entirely in the browser.**  
> Zero backend, no user accounts, 100% privacy (no camera feed or video ever leaves your device).

---

## 🚀 Key Features

1. **Dual Video Source**:
   - **Live Mobile Camera**: Default rear camera (`facingMode: "environment"`) with one-tap flip to front camera (`facingMode: "user"` with mirrored canvas).
   - **Video File Upload**: Inspect and tune thresholds using recorded workout clips with play/pause, scrub slider, and speed control (0.25x to 1.0x).
2. **Camera-Facing Side Selection**:
   - Automatically compares visibility scores of left vs. right landmarks (Shoulders 11/12, Elbows 13/14, Wrists 15/16, Hips 23/24, Knees 25/26, Ankles 27/28).
   - Tracks the side facing the camera and alerts when key joints are occluded (`visibility < 0.5`).
3. **Push-up Position Verification**:
   - Analyzes angle of the shoulder-to-ankle line relative to the ground.
   - Requires horizontal alignment within **~30°** before counting reps, showing *"Get into push-up position (side view)"* if standing or resting.
4. **2D Geometry & Angle Computation**:
   - Normalized coordinates converted to pixel space $(x \times W, y \times H)$ to preserve correct aspect ratio.
   - **Elbow Angle**: Angle between Shoulder, Elbow, and Wrist.
   - **Body Alignment Angle**: Angle between Shoulder, Hip, and Ankle (ideal ~180°).
   - **Sagging vs. Piking Detection**: Mathematical signed perpendicular distance from Hip to the Shoulder-Ankle segment determines whether hips droop toward the floor (sagging) or hike toward the ceiling (piking).
5. **Jitter-Free One Euro Filtering**:
   - Implements an adaptive $1€$ filter with dynamic cutoff frequency to eliminate high-frequency landmark jitter while retaining instant zero-lag response during explosive movements.
6. **State Machine Rep Counter with Hysteresis**:
   - Strict cycle tracking: `UP` ($\ge 155^\circ$) $\to$ `DOWN` ($\le 100^\circ$) $\to$ `UP` ($\ge 155^\circ$).
   - Records minimum elbow angle reached at the bottom.
   - Discards cycles shorter than 0.6 seconds to avoid double-counting or bounce artifacts.
7. **Form Fault Diagnosis**:
   - **Depth**: $\le 90^\circ$ (Good Depth), $91^\circ - 105^\circ$ (*"Go a bit lower"*), $> 105^\circ$ (*"Shallow Rep"*).
   - **Hips Sagging**: Body angle $< 160^\circ$ with hips drooping.
   - **Hips Piking**: Body angle $< 160^\circ$ with hips elevated.
   - **Incomplete Lockout**: Failing to return to $\ge 155^\circ$ at the top.
   - **Tempo**: Flags uncontrolled descents under 0.5 seconds.
8. **Gym-Ready Mobile UI**:
   - High-contrast dark athletic theme readable from 2–3 meters away.
   - Massive rep counters (`TOTAL`, `GOOD FORM`, `WITH FAULTS`).
   - Dynamic skeleton color shifts (Green = Good, Yellow = Warning, Red = Fault).
   - Collapsible debug HUD (Live FPS, Active Side, Elbow °, Body °, Tilt °, Visibility).
   - Real-time interactive settings drawer with sliders saved to `localStorage`.
   - Post-session summary dialog with accuracy rate, top fault, and rep-by-rep history table.
   - **Spoken Audio Feedback** via Web Speech API (`SpeechSynthesis`).
   - **Screen Wake Lock API** prevents the phone screen from sleeping mid-set.

---

## 📁 Architecture Overview

```
GymCoach/
├── index.html        # Mobile-first DOM structure, HUD, controls & modals
├── style.css         # Athletic dark theme, high-visibility layout & animations
├── pose.js           # MediaPipe Tasks Vision loader (GPU first, CPU fallback)
├── pushup.js         # Pure mathematical analysis & state machine (No DOM)
├── app.js            # Controller: stream/file handling, RAF loop, canvas drawing
└── README.md         # Guide, threshold tuning & technical documentation
```

---

## 🛠️ How to Run Locally & Test on Mobile

Modern browser security requires **HTTPS** or `localhost` to access `navigator.mediaDevices.getUserMedia`.

### Option A: Local Testing with Python / Node (Desktop & Emulation)
```bash
# Using Python 3:
python -m http.server 8080

# Or using Node http-server / npx serve:
npx serve .
```
Open `http://localhost:8080` in your browser. Open Chrome DevTools (`F12`), toggle Device Toolbar (`Ctrl+Shift+M`), and test with a sample push-up video.

### Option B: Testing on your Real Mobile Phone via HTTPS Tunnel
To test with your phone propped on the gym floor:
```bash
# 1. Start a local server:
npx serve -p 8080

# 2. In another terminal, expose it securely via localtunnel or ngrok:
npx localtunnel --port 8080
# or:
ngrok http 8080
```
Open the generated `https://....loca.lt` URL in Mobile Safari (iOS) or Mobile Chrome (Android).

### Option C: Instant Deployment via GitHub Pages
1. Push this repository to GitHub.
2. In your repo on GitHub, go to **Settings** > **Pages**.
3. Under **Build and deployment** > **Branch**, select `main` / `root` and click **Save**.
4. In ~60 seconds, your app will be live at `https://<your-username>.github.io/<repo-name>/`.

---

## 🎛️ How to Tune Thresholds (`CONFIG`)

All thresholds can be adjusted in real time via the in-app **Settings (⚙️)** panel and are stored in `localStorage`. They are also defined in `pushup.js`:

| Config Parameter | Default | When to Tune |
| :--- | :--- | :--- |
| `elbowUpThreshold` | `155°` | **Reps missed at top:** Lower to `145° - 150°` if you don't fully hyperextend/lock out your elbows.<br>**Too easy:** Raise to `165°` to enforce strict lockout. |
| `elbowDownThreshold` | `100°` | **Reps not triggering DOWN state:** Increase to `105° - 110°` if the state machine doesn't register the descent. |
| `depthGoodAngle` | `90°` | **Depth judged too strictly:** Increase to `95° - 100°` for beginners or partial push-ups.<br>**Strict powerlifting chest-to-floor standard:** Lower to `80° - 85°`. |
| `depthShallowAngle` | `105°` | Adjusts cutoff between "Go a bit lower" and "Shallow rep". |
| `bodySagAngle` | `160°` | **False "Hips sagging" warnings:** Lower to `150° - 155°` if natural spinal curvature or loose shirts trigger sagging alerts. |
| `bodyPikeAngle` | `160°` | **False "Hips piking" warnings:** Lower to `150° - 155°` if arched lower back triggers pike warnings. |
| `horizontalAngleLimit` | `30°` | **Push-ups on an incline (e.g. bench or bar):** Increase to `40° - 45°`.<br>**Strict floor only:** Keep at `25° - 30°`. |
| `minRepDurationSec` | `0.6s` | **Double counts on bounce:** Increase to `0.8s - 1.0s`.<br>**Explosive speed push-ups missed:** Lower to `0.4s - 0.5s`. |
| `oneEuroMinCutoff` | `1.0 Hz` | Increase for even faster response; decrease to `0.5 Hz` for smoother lines if camera has low lighting noise. |

---

## ⚠️ Known Limitations & Suggested Next Steps

1. **Single-Plane 2D Projection**:
   - Because landmarks are projected to 2D screen space, positioning the phone at an angle (not perpendicular/side-on to the user) alters apparent joint angles.
   - *Next Step:* Utilize MediaPipe's 3D World Landmarks (`landmarks[i].z`) to compute true Euclidean 3D vectors independent of camera slant.
2. **Extreme Clothing Baggy Artifacts**:
   - Very loose clothing may shift detected hip/shoulder points.
   - *Next Step:* Provide visual calibration bounding boxes or allow user baseline calibration before starting.
3. **Multi-Exercise Extension**:
   - The modular architecture of `pushup.js` can be replicated for:
     - **Squats**: Hip-Knee-Ankle depth angle, knee cave (valgus), upright chest posture.
     - **Pull-ups**: Shoulder-Elbow-Wrist flexion and chin-over-bar position.
     - **Planks**: Isometric duration timer with hip alignment alerts.
4. **Native App Packaging**:
   - Wrap the static web files with **Capacitor** (`@capacitor/camera`, `@capacitor/screen-orientation`) to build standalone `.apk` and `.ipa` binaries for the Google Play Store and Apple App Store.
5. **Temporal Machine Learning Classifier**:
   - In addition to kinematic heuristics, train a lightweight LSTM or 1D-CNN on sequences of landmark embeddings to detect rep cadence and micro-faults.
