/**
 * app.js - GymCoach AI Mobile-First Application Controller
 * 
 * Coordinates MediaPipe Pose detection, the push-up analysis state machine,
 * camera streams & video file playback, canvas skeleton drawing,
 * speech synthesis, screen wake lock, and reactive UI updates.
 */

import { poseService } from "./pose.js";
import { PushUpAnalyzer, DEFAULT_CONFIG } from "./pushup.js";

// Application State
const state = {
  mode: "camera",              // "camera" | "file"
  cameraFacing: "environment", // "environment" (rear) | "user" (front)
  isSessionActive: false,
  isSessionPaused: false,
  wakeLock: null,
  speechSynth: window.speechSynthesis || null,
  voiceEnabled: true,
  lastSpokenPhrase: "",
  lastSpokenTime: 0,

  // Stream & Animation
  activeStream: null,
  animationFrameId: null,
  lastFpsTimestamp: performance.now(),
  frameCount: 0,
  currentFps: 0,

  // Stored thresholds
  config: { ...DEFAULT_CONFIG }
};

// Instantiate PushUpAnalyzer
const analyzer = new PushUpAnalyzer(state.config);

// DOM Elements Cache
const DOM = {
  // Top controls
  cameraSourceBtn: document.getElementById("cameraSourceBtn"),
  fileSourceBtn: document.getElementById("fileSourceBtn"),
  videoFileInput: document.getElementById("videoFileInput"),
  flipCameraBtn: document.getElementById("flipCameraBtn"),
  voiceToggleBtn: document.getElementById("voiceToggleBtn"),
  settingsBtn: document.getElementById("settingsBtn"),
  helpBtn: document.getElementById("helpBtn"),

  // Video & Canvas
  videoContainer: document.getElementById("videoContainer"),
  videoElement: document.getElementById("videoElement"),
  outputCanvas: document.getElementById("outputCanvas"),
  canvasCtx: document.getElementById("outputCanvas").getContext("2d"),
  loadingOverlay: document.getElementById("loadingOverlay"),
  loadingMessage: document.getElementById("loadingMessage"),

  // HUD
  feedbackBanner: document.getElementById("feedbackBanner"),
  feedbackIcon: document.getElementById("feedbackIcon"),
  feedbackText: document.getElementById("feedbackText"),
  totalRepsDisplay: document.getElementById("totalRepsDisplay"),
  goodRepsDisplay: document.getElementById("goodRepsDisplay"),
  faultRepsDisplay: document.getElementById("faultRepsDisplay"),
  depthProgressBar: document.getElementById("depthProgressBar"),
  repStateBadge: document.getElementById("repStateBadge"),

  // Debug Panel
  debugPanel: document.getElementById("debugPanel"),
  debugToggle: document.getElementById("debugToggle"),
  debugFps: document.getElementById("debugFps"),
  debugSide: document.getElementById("debugSide"),
  debugElbowAngle: document.getElementById("debugElbowAngle"),
  debugBodyAngle: document.getElementById("debugBodyAngle"),
  debugBodyTilt: document.getElementById("debugBodyTilt"),
  debugMinAngle: document.getElementById("debugMinAngle"),
  debugVisibility: document.getElementById("debugVisibility"),

  // File controls
  fileControlsBar: document.getElementById("fileControlsBar"),
  filePlayPauseBtn: document.getElementById("filePlayPauseBtn"),
  fileScrubber: document.getElementById("fileScrubber"),
  fileTimeDisplay: document.getElementById("fileTimeDisplay"),
  fileSpeedSelect: document.getElementById("fileSpeedSelect"),

  // Session Action Buttons
  sessionToggleBtn: document.getElementById("sessionToggleBtn"),
  sessionResetBtn: document.getElementById("sessionResetBtn"),
  sessionEndBtn: document.getElementById("sessionEndBtn"),

  // Modals
  settingsModal: document.getElementById("settingsModal"),
  closeSettingsBtn: document.getElementById("closeSettingsBtn"),
  saveSettingsBtn: document.getElementById("saveSettingsBtn"),
  resetDefaultsBtn: document.getElementById("resetDefaultsBtn"),
  voiceToggleCheckbox: document.getElementById("voiceToggleCheckbox"),

  // Settings Sliders & Labels
  elbowUpSlider: document.getElementById("elbowUpSlider"),
  elbowUpVal: document.getElementById("elbowUpVal"),
  elbowDownSlider: document.getElementById("elbowDownSlider"),
  elbowDownVal: document.getElementById("elbowDownVal"),
  depthGoodSlider: document.getElementById("depthGoodSlider"),
  depthGoodVal: document.getElementById("depthGoodVal"),
  depthShallowSlider: document.getElementById("depthShallowSlider"),
  depthShallowVal: document.getElementById("depthShallowVal"),
  bodySagSlider: document.getElementById("bodySagSlider"),
  bodySagVal: document.getElementById("bodySagVal"),
  bodyPikeSlider: document.getElementById("bodyPikeSlider"),
  bodyPikeVal: document.getElementById("bodyPikeVal"),
  horizLimitSlider: document.getElementById("horizLimitSlider"),
  horizLimitVal: document.getElementById("horizLimitVal"),
  minDurationSlider: document.getElementById("minDurationSlider"),
  minDurationVal: document.getElementById("minDurationVal"),

  // Summary Modal
  summaryModal: document.getElementById("summaryModal"),
  closeSummaryBtn: document.getElementById("closeSummaryBtn"),
  summaryCloseBtn: document.getElementById("summaryCloseBtn"),
  summaryTotalReps: document.getElementById("summaryTotalReps"),
  summaryGoodReps: document.getElementById("summaryGoodReps"),
  summaryFaultReps: document.getElementById("summaryFaultReps"),
  summaryAccuracy: document.getElementById("summaryAccuracy"),
  summaryTopFault: document.getElementById("summaryTopFault"),
  summaryRepList: document.getElementById("summaryRepList"),

  // Help Modal
  helpModal: document.getElementById("helpModal"),
  closeHelpBtn: document.getElementById("closeHelpBtn"),
  guideDismissBtn: document.getElementById("guideDismissBtn")
};

// ==========================================================================
// Initialization & LocalStorage
// ==========================================================================

function loadStoredSettings() {
  try {
    const saved = localStorage.getItem("gymcoach_config");
    if (saved) {
      const parsed = JSON.parse(saved);
      state.config = { ...DEFAULT_CONFIG, ...parsed };
      analyzer.updateConfig(state.config);
    }
  } catch (e) {
    console.warn("Could not load stored settings:", e);
  }

  // Populate UI inputs
  syncSettingsUI();
}

function saveSettings() {
  try {
    localStorage.setItem("gymcoach_config", JSON.stringify(state.config));
  } catch (e) {
    console.warn("Could not save settings:", e);
  }
}

function syncSettingsUI() {
  DOM.elbowUpSlider.value = state.config.elbowUpThreshold;
  DOM.elbowUpVal.textContent = `${state.config.elbowUpThreshold}°`;

  DOM.elbowDownSlider.value = state.config.elbowDownThreshold;
  DOM.elbowDownVal.textContent = `${state.config.elbowDownThreshold}°`;

  DOM.depthGoodSlider.value = state.config.depthGoodAngle;
  DOM.depthGoodVal.textContent = `${state.config.depthGoodAngle}°`;

  DOM.depthShallowSlider.value = state.config.depthShallowAngle;
  DOM.depthShallowVal.textContent = `${state.config.depthShallowAngle}°`;

  DOM.bodySagSlider.value = state.config.bodySagAngle;
  DOM.bodySagVal.textContent = `${state.config.bodySagAngle}°`;

  DOM.bodyPikeSlider.value = state.config.bodyPikeAngle;
  DOM.bodyPikeVal.textContent = `${state.config.bodyPikeAngle}°`;

  DOM.horizLimitSlider.value = state.config.horizontalAngleLimit;
  DOM.horizLimitVal.textContent = `${state.config.horizontalAngleLimit}°`;

  DOM.minDurationSlider.value = state.config.minRepDurationSec;
  DOM.minDurationVal.textContent = `${state.config.minRepDurationSec}s`;

  DOM.voiceToggleCheckbox.checked = state.voiceEnabled;
}

// ==========================================================================
// Screen Wake Lock API
// ==========================================================================

async function requestWakeLock() {
  if ("wakeLock" in navigator && !state.wakeLock) {
    try {
      state.wakeLock = await navigator.wakeLock.request("screen");
      state.wakeLock.addEventListener("release", () => {
        state.wakeLock = null;
      });
      console.log("[WakeLock] Screen Wake Lock acquired.");
    } catch (err) {
      console.warn("[WakeLock] Failed to obtain wake lock:", err);
    }
  }
}

function releaseWakeLock() {
  if (state.wakeLock) {
    state.wakeLock.release().catch(() => {});
    state.wakeLock = null;
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && state.isSessionActive && !state.isSessionPaused) {
    requestWakeLock();
  }
});

// ==========================================================================
// Spoken Feedback (Web Speech API)
// ==========================================================================

function speakFeedback(text, priority = false) {
  if (!state.voiceEnabled || !state.speechSynth) return;

  const now = performance.now();
  // Avoid repeating the exact phrase within 2.5 seconds unless marked priority
  if (!priority && text === state.lastSpokenPhrase && (now - state.lastSpokenTime < 2500)) {
    return;
  }

  try {
    state.speechSynth.cancel(); // Cancel any prior unfinished utterances
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.15;
    utterance.pitch = 1.0;
    utterance.lang = "en-US";
    state.speechSynth.speak(utterance);

    state.lastSpokenPhrase = text;
    state.lastSpokenTime = now;
  } catch (err) {
    console.warn("Speech synthesis error:", err);
  }
}

// ==========================================================================
// Camera & Video Management
// ==========================================================================

async function startCamera() {
  stopActiveStream();
  DOM.loadingOverlay.classList.remove("fade-out");
  DOM.loadingMessage.textContent = "Accessing camera...";

  // Apply mirroring class if front camera
  if (state.cameraFacing === "user") {
    DOM.videoContainer.classList.add("mirrored");
  } else {
    DOM.videoContainer.classList.remove("mirrored");
  }

  const constraints = {
    video: {
      facingMode: { ideal: state.cameraFacing },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };

  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    state.activeStream = stream;
    DOM.videoElement.srcObject = stream;

    await new Promise((resolve) => {
      DOM.videoElement.onloadedmetadata = () => {
        DOM.videoElement.play();
        resolve();
      };
    });

    onVideoSourceReady();
  } catch (err) {
    console.error("Camera access error:", err);
    DOM.loadingOverlay.classList.remove("fade-out");
    DOM.loadingMessage.textContent = "Camera access denied or unavailable. Please check permissions.";
  }
}

function stopActiveStream() {
  if (state.activeStream) {
    state.activeStream.getTracks().forEach((track) => track.stop());
    state.activeStream = null;
  }
  DOM.videoElement.srcObject = null;
}

function loadVideoFile(file) {
  stopActiveStream();
  DOM.videoContainer.classList.remove("mirrored"); // uploaded files are not mirrored

  DOM.loadingOverlay.classList.remove("fade-out");
  DOM.loadingMessage.textContent = "Loading video file...";

  const videoUrl = URL.createObjectURL(file);
  DOM.videoElement.src = videoUrl;
  DOM.videoElement.loop = true;

  DOM.videoElement.onloadedmetadata = () => {
    DOM.fileScrubber.max = DOM.videoElement.duration || 100;
    updateFileTimeDisplay();
    DOM.videoElement.play();
    DOM.filePlayPauseBtn.textContent = "⏸";
    poseService.resetTimestamp();
    onVideoSourceReady();
  };
}

function onVideoSourceReady() {
  DOM.loadingOverlay.classList.add("fade-out");
  resizeCanvas();

  if (!state.animationFrameId) {
    state.animationFrameId = requestAnimationFrame(renderLoop);
  }
}

function resizeCanvas() {
  const vWidth = DOM.videoElement.videoWidth || 640;
  const vHeight = DOM.videoElement.videoHeight || 480;

  if (DOM.outputCanvas.width !== vWidth || DOM.outputCanvas.height !== vHeight) {
    DOM.outputCanvas.width = vWidth;
    DOM.outputCanvas.height = vHeight;
  }
}

window.addEventListener("resize", resizeCanvas);

// ==========================================================================
// Canvas Drawing & Skeleton Overlay
// ==========================================================================

function drawSkeleton(keypoints, skeletonColor, angles) {
  const ctx = DOM.canvasCtx;
  const width = DOM.outputCanvas.width;
  const height = DOM.outputCanvas.height;

  ctx.clearRect(0, 0, width, height);

  if (!keypoints) return;

  const { shoulder, elbow, wrist, hip, knee, ankle } = keypoints;

  // Visual styling
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(4, Math.round(width * 0.007));
  ctx.strokeStyle = skeletonColor;
  ctx.shadowColor = skeletonColor;
  ctx.shadowBlur = 12;

  // 1. Draw Arm Segment (Shoulder -> Elbow -> Wrist)
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(elbow.x, elbow.y);
  ctx.lineTo(wrist.x, wrist.y);
  ctx.stroke();

  // 2. Draw Body Segment (Shoulder -> Hip -> Knee -> Ankle)
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(hip.x, hip.y);
  ctx.lineTo(knee.x, knee.y);
  ctx.lineTo(ankle.x, ankle.y);
  ctx.stroke();

  // 3. Draw Shoulder-to-Ankle reference line (subtle dashed line for posture reference)
  ctx.beginPath();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.4)";
  ctx.lineWidth = 2;
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(ankle.x, ankle.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // 4. Draw Joint Nodes with Outer Rings
  const joints = [
    { pt: shoulder, label: "Shoulder" },
    { pt: elbow, label: "Elbow", angle: angles?.elbowAngle },
    { pt: wrist, label: "Wrist" },
    { pt: hip, label: "Hip", angle: angles?.bodyAngle },
    { pt: knee, label: "Knee" },
    { pt: ankle, label: "Ankle" }
  ];

  for (const j of joints) {
    if (!j.pt) continue;

    // Outer glow ring
    ctx.beginPath();
    ctx.arc(j.pt.x, j.pt.y, 8, 0, 2 * Math.PI);
    ctx.fillStyle = "#ffffff";
    ctx.fill();

    ctx.beginPath();
    ctx.arc(j.pt.x, j.pt.y, 12, 0, 2 * Math.PI);
    ctx.strokeStyle = skeletonColor;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Angle text tags above Elbow and Hip
    if (j.angle !== undefined && j.angle !== null) {
      ctx.font = `bold ${Math.max(16, Math.round(width * 0.024))}px -apple-system, sans-serif`;
      const text = `${j.angle}°`;
      const textX = j.pt.x + 16;
      const textY = j.pt.y - 12;

      // Dark tag pill
      const textMetrics = ctx.measureText(text);
      ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
      ctx.beginPath();
      ctx.roundRect(textX - 4, textY - 18, textMetrics.width + 8, 24, 6);
      ctx.fill();

      // Tag text
      ctx.fillStyle = skeletonColor;
      ctx.fillText(text, textX, textY);
    }
  }

  ctx.restore();
}

// ==========================================================================
// Main Inference & Render Loop (requestAnimationFrame)
// ==========================================================================

function renderLoop(currentHighResTime) {
  state.animationFrameId = requestAnimationFrame(renderLoop);

  // Skip frame if page is hidden to conserve battery
  if (document.hidden) return;

  const video = DOM.videoElement;
  if (!video || video.readyState < 2 || video.paused || video.ended) {
    return;
  }

  // Calculate FPS
  state.frameCount++;
  const elapsedSinceFps = currentHighResTime - state.lastFpsTimestamp;
  if (elapsedSinceFps >= 1000) {
    state.currentFps = Math.round((state.frameCount * 1000) / elapsedSinceFps);
    DOM.debugFps.textContent = state.currentFps;
    state.frameCount = 0;
    state.lastFpsTimestamp = currentHighResTime;
  }

  // Update file progress scrubber if in file mode
  if (state.mode === "file" && !video.paused) {
    DOM.fileScrubber.value = video.currentTime;
    updateFileTimeDisplay();
  }

  // Determine frame timestamp
  // For live camera: performance.now(). For video file: video.currentTime * 1000
  const timestampMs = state.mode === "file" ? (video.currentTime * 1000) : performance.now();
  const timestampSec = timestampMs / 1000;

  // MediaPipe Pose Inference
  const landmarks = poseService.detectPose(video, timestampMs);

  if (!landmarks) {
    DOM.canvasCtx.clearRect(0, 0, DOM.outputCanvas.width, DOM.outputCanvas.height);
    updateFeedbackBanner("Can't see you clearly", "bad", "⚠️");
    DOM.debugVisibility.textContent = "0.00";
    return;
  }

  // Execute Pure Push-up Analysis
  const result = analyzer.processFrame(
    landmarks,
    video.videoWidth,
    video.videoHeight,
    timestampSec
  );

  // Render skeleton overlay
  drawSkeleton(result.keypoints, result.skeletonColor || "#00e676", result.angles);

  // Update UI Elements
  updateUI(result);

  // Check Rep Events
  if (result.repEvent && state.isSessionActive && !state.isSessionPaused) {
    handleRepEvent(result.repEvent);
  }
}

function updateUI(result) {
  // 1. Live Feedback Banner
  if (result.feedback) {
    let icon = "⚡";
    if (result.feedbackStatus === "good") icon = "✅";
    if (result.feedbackStatus === "warning") icon = "⚠️";
    if (result.feedbackStatus === "bad") icon = "❌";
    updateFeedbackBanner(result.feedback, result.feedbackStatus, icon);
  }

  // 2. State Badge
  DOM.repStateBadge.textContent = `STATE: ${result.state || "IDLE"}`;

  // 3. Depth Progress Fill
  if (result.angles && result.angles.elbowAngle !== null) {
    // 160° is 0% depth, 90° is 100% depth
    const maxA = 160;
    const minA = 90;
    const percent = Math.max(0, Math.min(100, ((maxA - result.angles.elbowAngle) / (maxA - minA)) * 100));
    DOM.depthProgressBar.style.width = `${percent}%`;
  }

  // 4. Debug Panel Updates
  if (!DOM.debugPanel.classList.contains("collapsed")) {
    DOM.debugSide.textContent = result.activeSide ? result.activeSide.toUpperCase() : "--";
    DOM.debugElbowAngle.textContent = result.angles?.elbowAngle !== null && result.angles?.elbowAngle !== undefined
      ? `${result.angles.elbowAngle}°` : "--";
    DOM.debugBodyAngle.textContent = result.angles?.bodyAngle !== null && result.angles?.bodyAngle !== undefined
      ? `${result.angles.bodyAngle}°` : "--";
    DOM.debugBodyTilt.textContent = result.angles?.tiltAngle !== null && result.angles?.tiltAngle !== undefined
      ? `${result.angles.tiltAngle}°` : "--";
    DOM.debugMinAngle.textContent = result.angles?.minElbowAngleInRep !== null && result.angles?.minElbowAngleInRep !== undefined
      ? `${result.angles.minElbowAngleInRep}°` : "--";
    DOM.debugVisibility.textContent = result.sideScore !== undefined
      ? result.sideScore.toFixed(2) : "--";
  }
}

function updateFeedbackBanner(text, statusClass, icon) {
  DOM.feedbackText.textContent = text;
  DOM.feedbackIcon.textContent = icon;
  DOM.feedbackBanner.className = `feedback-banner status-${statusClass}`;
}

function handleRepEvent(repEvent) {
  // Update Big Counters
  DOM.totalRepsDisplay.textContent = analyzer.totalReps;
  DOM.goodRepsDisplay.textContent = analyzer.goodReps;
  DOM.faultRepsDisplay.textContent = analyzer.faultReps;

  // Speak Rep & Verdict
  if (repEvent.verdict === "GOOD") {
    speakFeedback(`${repEvent.repNumber}! Good rep!`, true);
  } else {
    const mainFault = repEvent.faults[0] || "Needs work";
    speakFeedback(`${repEvent.repNumber}! ${mainFault}`, true);
  }
}

// ==========================================================================
// Session Controls & Summary
// ==========================================================================

function toggleSession() {
  if (!state.isSessionActive) {
    // Start Session
    state.isSessionActive = true;
    state.isSessionPaused = false;
    DOM.sessionToggleBtn.innerHTML = '<span class="btn-icon">⏸</span><span class="btn-text">PAUSE SESSION</span>';
    DOM.sessionToggleBtn.classList.add("paused");
    requestWakeLock();
    speakFeedback("Workout started! Get into position.", true);
  } else if (!state.isSessionPaused) {
    // Pause Session
    state.isSessionPaused = true;
    DOM.sessionToggleBtn.innerHTML = '<span class="btn-icon">▶</span><span class="btn-text">RESUME SESSION</span>';
    DOM.sessionToggleBtn.classList.remove("paused");
    releaseWakeLock();
    speakFeedback("Session paused.", true);
  } else {
    // Resume Session
    state.isSessionPaused = false;
    DOM.sessionToggleBtn.innerHTML = '<span class="btn-icon">⏸</span><span class="btn-text">PAUSE SESSION</span>';
    DOM.sessionToggleBtn.classList.add("paused");
    requestWakeLock();
    speakFeedback("Resuming session.", true);
  }
}

function resetSession() {
  analyzer.resetSession();
  DOM.totalRepsDisplay.textContent = "0";
  DOM.goodRepsDisplay.textContent = "0";
  DOM.faultRepsDisplay.textContent = "0";
  DOM.depthProgressBar.style.width = "0%";
  DOM.repStateBadge.textContent = "STATE: IDLE";
  updateFeedbackBanner("Session reset. Ready!", "waiting", "⏳");
}

function showSummaryModal() {
  const summary = analyzer.getSessionSummary();

  DOM.summaryTotalReps.textContent = summary.totalReps;
  DOM.summaryGoodReps.textContent = summary.goodReps;
  DOM.summaryFaultReps.textContent = summary.faultReps;
  DOM.summaryAccuracy.textContent = `${summary.accuracyPercent}%`;
  DOM.summaryTopFault.textContent = summary.topFault;

  // Render Table
  DOM.summaryRepList.innerHTML = "";
  if (summary.history.length === 0) {
    DOM.summaryRepList.innerHTML = `<tr><td colspan="5" style="text-align:center; color:#94a3b8; padding:16px;">No reps recorded yet.</td></tr>`;
  } else {
    for (const r of summary.history) {
      const row = document.createElement("tr");
      const isGood = r.verdict === "GOOD";
      row.innerHTML = `
        <td><strong>#${r.repNumber}</strong></td>
        <td><span class="verdict-tag ${isGood ? 'verdict-good' : 'verdict-fault'}">${r.verdict}</span></td>
        <td>${r.minElbowAngle}°</td>
        <td>${r.durationSec}s</td>
        <td>${r.faults.length > 0 ? r.faults.join(", ") : "Perfect form"}</td>
      `;
      DOM.summaryRepList.appendChild(row);
    }
  }

  DOM.summaryModal.classList.remove("hidden");
}

// ==========================================================================
// Video File Scrubbing Controls
// ==========================================================================

function updateFileTimeDisplay() {
  const current = formatSeconds(DOM.videoElement.currentTime);
  const total = formatSeconds(DOM.videoElement.duration || 0);
  DOM.fileTimeDisplay.textContent = `${current} / ${total}`;
}

function formatSeconds(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

// ==========================================================================
// Setup Event Listeners
// ==========================================================================

function initEventListeners() {
  // Source Toggle: Live Camera
  DOM.cameraSourceBtn.addEventListener("click", () => {
    if (state.mode === "camera") return;
    state.mode = "camera";
    DOM.cameraSourceBtn.classList.add("active");
    DOM.fileSourceBtn.classList.remove("active");
    DOM.fileControlsBar.classList.add("hidden");
    DOM.flipCameraBtn.style.display = "flex";
    startCamera();
  });

  // Source Toggle: File Upload
  DOM.fileSourceBtn.addEventListener("click", () => {
    DOM.videoFileInput.click();
  });

  DOM.videoFileInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) {
      state.mode = "file";
      DOM.fileSourceBtn.classList.add("active");
      DOM.cameraSourceBtn.classList.remove("active");
      DOM.fileControlsBar.classList.remove("hidden");
      DOM.flipCameraBtn.style.display = "none";
      loadVideoFile(file);
    }
  });

  // Flip Camera
  DOM.flipCameraBtn.addEventListener("click", () => {
    state.cameraFacing = state.cameraFacing === "environment" ? "user" : "environment";
    startCamera();
  });

  // Voice Toggle Button
  DOM.voiceToggleBtn.addEventListener("click", () => {
    state.voiceEnabled = !state.voiceEnabled;
    DOM.voiceToggleBtn.classList.toggle("active", state.voiceEnabled);
    DOM.voiceToggleCheckbox.checked = state.voiceEnabled;
    if (state.voiceEnabled) {
      speakFeedback("Voice coach enabled.", true);
    }
  });

  // File Playback Controls
  DOM.filePlayPauseBtn.addEventListener("click", () => {
    if (DOM.videoElement.paused) {
      DOM.videoElement.play();
      DOM.filePlayPauseBtn.textContent = "⏸";
    } else {
      DOM.videoElement.pause();
      DOM.filePlayPauseBtn.textContent = "▶";
    }
  });

  DOM.fileScrubber.addEventListener("input", (e) => {
    DOM.videoElement.currentTime = Number(e.target.value);
    poseService.resetTimestamp();
    updateFileTimeDisplay();
  });

  DOM.fileSpeedSelect.addEventListener("change", (e) => {
    DOM.videoElement.playbackRate = parseFloat(e.target.value);
  });

  // Session Actions
  DOM.sessionToggleBtn.addEventListener("click", toggleSession);
  DOM.sessionResetBtn.addEventListener("click", resetSession);
  DOM.sessionEndBtn.addEventListener("click", showSummaryModal);

  // Debug Panel Collapsible
  DOM.debugToggle.addEventListener("click", () => {
    DOM.debugPanel.classList.toggle("collapsed");
  });

  // Settings Modal Open/Close
  DOM.settingsBtn.addEventListener("click", () => {
    DOM.settingsModal.classList.remove("hidden");
  });

  DOM.closeSettingsBtn.addEventListener("click", () => {
    DOM.settingsModal.classList.add("hidden");
  });

  DOM.saveSettingsBtn.addEventListener("click", () => {
    DOM.settingsModal.classList.add("hidden");
    saveSettings();
  });

  // Sliders input events
  DOM.elbowUpSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.elbowUpVal.textContent = `${val}°`;
    state.config.elbowUpThreshold = val;
    analyzer.updateConfig({ elbowUpThreshold: val });
  });

  DOM.elbowDownSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.elbowDownVal.textContent = `${val}°`;
    state.config.elbowDownThreshold = val;
    analyzer.updateConfig({ elbowDownThreshold: val });
  });

  DOM.depthGoodSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.depthGoodVal.textContent = `${val}°`;
    state.config.depthGoodAngle = val;
    analyzer.updateConfig({ depthGoodAngle: val });
  });

  DOM.depthShallowSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.depthShallowVal.textContent = `${val}°`;
    state.config.depthShallowAngle = val;
    analyzer.updateConfig({ depthShallowAngle: val });
  });

  DOM.bodySagSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.bodySagVal.textContent = `${val}°`;
    state.config.bodySagAngle = val;
    analyzer.updateConfig({ bodySagAngle: val });
  });

  DOM.bodyPikeSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.bodyPikeVal.textContent = `${val}°`;
    state.config.bodyPikeAngle = val;
    analyzer.updateConfig({ bodyPikeAngle: val });
  });

  DOM.horizLimitSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.horizLimitVal.textContent = `${val}°`;
    state.config.horizontalAngleLimit = val;
    analyzer.updateConfig({ horizontalAngleLimit: val });
  });

  DOM.minDurationSlider.addEventListener("input", (e) => {
    const val = Number(e.target.value);
    DOM.minDurationVal.textContent = `${val}s`;
    state.config.minRepDurationSec = val;
    analyzer.updateConfig({ minRepDurationSec: val });
  });

  DOM.voiceToggleCheckbox.addEventListener("change", (e) => {
    state.voiceEnabled = e.target.checked;
    DOM.voiceToggleBtn.classList.toggle("active", state.voiceEnabled);
  });

  DOM.resetDefaultsBtn.addEventListener("click", () => {
    state.config = { ...DEFAULT_CONFIG };
    analyzer.updateConfig(state.config);
    syncSettingsUI();
    saveSettings();
  });

  // Summary Modal Close
  DOM.closeSummaryBtn.addEventListener("click", () => {
    DOM.summaryModal.classList.add("hidden");
  });
  DOM.summaryCloseBtn.addEventListener("click", () => {
    DOM.summaryModal.classList.add("hidden");
  });

  // Setup / Help Modal
  DOM.helpBtn.addEventListener("click", () => {
    DOM.helpModal.classList.remove("hidden");
  });
  DOM.closeHelpBtn.addEventListener("click", () => {
    DOM.helpModal.classList.add("hidden");
  });
  DOM.guideDismissBtn.addEventListener("click", () => {
    DOM.helpModal.classList.add("hidden");
    localStorage.setItem("gymcoach_onboarding_shown", "true");
  });
}

// ==========================================================================
// Application Bootstrap
// ==========================================================================

async function bootstrap() {
  loadStoredSettings();
  initEventListeners();

  // Show setup guide on first visit
  const onboardingShown = localStorage.getItem("gymcoach_onboarding_shown");
  if (!onboardingShown) {
    DOM.helpModal.classList.remove("hidden");
  }

  // Initialize MediaPipe PoseLandmarker
  try {
    DOM.loadingMessage.textContent = "Loading MediaPipe AI Model...";
    await poseService.init();
    console.log(`[GymCoach] PoseLandmarker ready with ${poseService.getDelegate()} delegate.`);

    // Start live camera
    await startCamera();
  } catch (err) {
    console.error("[GymCoach] Bootstrap initialization error:", err);
    DOM.loadingOverlay.classList.remove("fade-out");
    DOM.loadingMessage.innerHTML = `
      Failed to load AI pose model.<br>
      <small style="color:#ff3366; margin-top:8px; display:block;">${err.message || err}</small>
    `;
  }
}

// Kickoff when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap);
} else {
  bootstrap();
}
