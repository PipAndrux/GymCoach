/**
 * pushup.js - Pure Mathematical Analysis & Push-up State Machine
 * 
 * Free of DOM dependencies. Testable in Node.js or browser.
 * Computes 2D angles in pixel space, applies One Euro Filtering,
 * identifies camera-facing side, evaluates body posture (sag/pike/tilt),
 * and tracks repetition cycles with hysteresis.
 */

// Landmark Indices according to MediaPipe Pose model
export const POSE_LANDMARKS = {
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28
};

// Default Configuration Constants
export const DEFAULT_CONFIG = {
  // Position & Visibility thresholds
  horizontalAngleLimit: 30,    // deg: maximum inclination of shoulder-ankle line from horizontal
  minLandmarkVisibility: 0.5,  // minimum confidence threshold for key landmarks

  // Rep State Machine Hysteresis thresholds
  elbowUpThreshold: 155,       // deg: elbow angle to be considered at top lockout
  elbowDownThreshold: 100,     // deg: elbow angle to transition into DOWN state
  minRepDurationSec: 0.6,      // sec: minimum rep duration to prevent double-counting
  minDescentSec: 0.5,          // sec: tempo check, warning if descent is too fast

  // Form & Depth thresholds
  depthGoodAngle: 90,          // deg: <= 90° is a full, good depth rep
  depthShallowAngle: 105,      // deg: 91°-105° is "go a bit lower", > 105° is "shallow rep"
  bodySagAngle: 160,           // deg: body-line angle < 160° with hip below line = sagging
  bodyPikeAngle: 160,          // deg: body-line angle < 160° with hip above line = piking

  // One Euro Filter parameters (adaptive jitter reduction with zero lag)
  oneEuroMinCutoff: 1.0,       // Hz
  oneEuroBeta: 0.007,
  oneEuroDCutoff: 1.0          // Hz
};

/**
 * Low-pass filter helper for One Euro Filter
 */
class LowPassFilter {
  constructor(alpha = 0.5) {
    this.y = null;
    this.alpha = alpha;
  }

  filter(value, alpha = this.alpha) {
    if (this.y === null || isNaN(this.y)) {
      this.y = value;
    } else {
      this.y = alpha * value + (1.0 - alpha) * this.y;
    }
    return this.y;
  }

  reset() {
    this.y = null;
  }
}

/**
 * One Euro Filter for smoothing noisy 1D signals (such as angles) without lag.
 */
export class OneEuroFilter {
  constructor(minCutoff = 1.0, beta = 0.007, dCutoff = 1.0) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;

    this.xFilter = new LowPassFilter();
    this.dxFilter = new LowPassFilter();
    this.lastTime = null;
  }

  computeAlpha(rate, cutoff) {
    const tau = 1.0 / (2.0 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  filter(value, timestampSec) {
    if (isNaN(value)) return value;

    if (this.lastTime === null) {
      this.lastTime = timestampSec;
      return this.xFilter.filter(value);
    }

    const dt = timestampSec - this.lastTime;
    this.lastTime = timestampSec;

    // Prevent division by zero or negative time
    if (dt <= 0.0001) {
      return this.xFilter.y !== null ? this.xFilter.y : value;
    }

    const rate = 1.0 / dt;
    const prevY = this.xFilter.y !== null ? this.xFilter.y : value;
    const dx = (value - prevY) * rate;

    const edx = this.dxFilter.filter(dx, this.computeAlpha(rate, this.dCutoff));
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);
    return this.xFilter.filter(value, this.computeAlpha(rate, cutoff));
  }

  reset() {
    this.xFilter.reset();
    this.dxFilter.reset();
    this.lastTime = null;
  }
}

/**
 * 2D Geometry Helper Functions
 */

/**
 * Calculates 2D angle (in degrees 0-180) between three points ABC with vertex at B.
 * Points must have numeric x and y properties.
 */
export function calculateAngle2D(a, b, c) {
  if (!a || !b || !c) return 180;

  const abX = a.x - b.x;
  const abY = a.y - b.y;
  const cbX = c.x - b.x;
  const cbY = c.y - b.y;

  const dot = abX * cbX + abY * cbY;
  const magAB = Math.hypot(abX, abY);
  const magCB = Math.hypot(cbX, cbY);

  if (magAB < 1e-6 || magCB < 1e-6) return 180;

  let cosTheta = dot / (magAB * magCB);
  // Guard against numerical roundoff outside [-1, 1]
  cosTheta = Math.max(-1, Math.min(1, cosTheta));

  return (Math.acos(cosTheta) * 180.0) / Math.PI;
}

/**
 * Computes the angle of the line connecting A and B relative to horizontal ground.
 * In image space: Horizontal = 0°, Perfectly vertical = 90°.
 */
export function calculateHorizontalAngle(a, b) {
  if (!a || !b) return 90;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx < 1e-6) return 90;
  return (Math.atan2(dy, dx) * 180.0) / Math.PI;
}

/**
 * Determines whether point H (Hip) is below (sagging) or above (piking) the segment S->A.
 * In screen coordinates, y increases downward toward the floor.
 * 
 * Returns:
 *  > 0 : Hip is below the line (closer to floor -> Sagging)
 *  < 0 : Hip is above the line (closer to ceiling -> Piking)
 *  0   : Collinear
 */
export function calculateHipVerticalOffset(s, h, a) {
  if (!s || !h || !a) return 0;
  const dx = a.x - s.x;
  if (Math.abs(dx) < 1e-6) return 0;

  // Expected Y on the line connecting S and A at x = h.x
  const t = (h.x - s.x) / dx;
  const yExpected = s.y + t * (a.y - s.y);

  // If h.y > yExpected, hip has a higher pixel Y, which means it is lower in space (sagging towards floor)
  return h.y - yExpected;
}

/**
 * PushUpAnalyzer - Core State Machine and Form Evaluator
 */
export class PushUpAnalyzer {
  constructor(customConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...customConfig };

    // Smoothing filters for angles
    this.elbowFilter = new OneEuroFilter(
      this.config.oneEuroMinCutoff,
      this.config.oneEuroBeta,
      this.config.oneEuroDCutoff
    );
    this.bodyFilter = new OneEuroFilter(
      this.config.oneEuroMinCutoff,
      this.config.oneEuroBeta,
      this.config.oneEuroDCutoff
    );
    this.tiltFilter = new OneEuroFilter(
      this.config.oneEuroMinCutoff,
      this.config.oneEuroBeta,
      this.config.oneEuroDCutoff
    );

    // Rep State Machine variables
    this.state = "IDLE"; // States: "IDLE", "UP", "DESCENDING", "DOWN", "ASCENDING"
    this.totalReps = 0;
    this.goodReps = 0;
    this.faultReps = 0;
    this.repHistory = [];

    // Current rep tracking metrics
    this.currentRepStartTime = null;
    this.currentRepBottomTime = null;
    this.minElbowAngleInRep = 180;
    this.minBodyAngleInRep = 180;
    this.repFaultsDetected = new Set();
    this.hasReachedBottom = false;

    // Last known good side ("left" or "right")
    this.activeSide = null;
  }

  /**
   * Updates configuration dynamically (e.g. from UI sliders)
   */
  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.elbowFilter.minCutoff = this.config.oneEuroMinCutoff;
    this.elbowFilter.beta = this.config.oneEuroBeta;
    this.elbowFilter.dCutoff = this.config.oneEuroDCutoff;
  }

  /**
   * Resets session counters and state
   */
  resetSession() {
    this.state = "IDLE";
    this.totalReps = 0;
    this.goodReps = 0;
    this.faultReps = 0;
    this.repHistory = [];
    this.resetRepTracking();
    this.elbowFilter.reset();
    this.bodyFilter.reset();
    this.tiltFilter.reset();
    this.activeSide = null;
  }

  resetRepTracking() {
    this.currentRepStartTime = null;
    this.currentRepBottomTime = null;
    this.minElbowAngleInRep = 180;
    this.minBodyAngleInRep = 180;
    this.repFaultsDetected.clear();
    this.hasReachedBottom = false;
  }

  /**
   * Selects camera-facing side based on landmark visibility scores.
   * MediaPipe landmarks: Left (11, 13, 15, 23, 25, 27) vs Right (12, 14, 16, 24, 26, 28)
   */
  determineCameraFacingSide(landmarks) {
    const leftIndices = [
      POSE_LANDMARKS.LEFT_SHOULDER,
      POSE_LANDMARKS.LEFT_ELBOW,
      POSE_LANDMARKS.LEFT_WRIST,
      POSE_LANDMARKS.LEFT_HIP,
      POSE_LANDMARKS.LEFT_ANKLE
    ];
    const rightIndices = [
      POSE_LANDMARKS.RIGHT_SHOULDER,
      POSE_LANDMARKS.RIGHT_ELBOW,
      POSE_LANDMARKS.RIGHT_WRIST,
      POSE_LANDMARKS.RIGHT_HIP,
      POSE_LANDMARKS.RIGHT_ANKLE
    ];

    let leftScore = 0;
    let rightScore = 0;

    for (let i = 0; i < leftIndices.length; i++) {
      leftScore += (landmarks[leftIndices[i]]?.visibility ?? 0);
      rightScore += (landmarks[rightIndices[i]]?.visibility ?? 0);
    }

    const leftAvg = leftScore / leftIndices.length;
    const rightAvg = rightScore / rightIndices.length;

    // Sticky side preference if scores are close to avoid rapid oscillation
    if (this.activeSide === "left" && leftAvg >= rightAvg - 0.1) {
      return { side: "left", score: leftAvg };
    }
    if (this.activeSide === "right" && rightAvg >= leftAvg - 0.1) {
      return { side: "right", score: rightAvg };
    }

    return leftAvg >= rightAvg ? { side: "left", score: leftAvg } : { side: "right", score: rightAvg };
  }

  /**
   * Processes a single frame of pose landmarks.
   * 
   * @param {Array<Object>} rawLandmarks - Normalized landmarks from MediaPipe (x, y, z, visibility)
   * @param {number} videoWidth - Width in pixels for aspect-correct 2D math
   * @param {number} videoHeight - Height in pixels for aspect-correct 2D math
   * @param {number} timestampSec - Timestamp in seconds
   * @returns {Object} Frame analysis result
   */
  processFrame(rawLandmarks, videoWidth, videoHeight, timestampSec) {
    if (!rawLandmarks || rawLandmarks.length < 33 || videoWidth <= 0 || videoHeight <= 0) {
      return {
        isValidPose: false,
        feedback: "Can't see you clearly",
        feedbackStatus: "bad",
        state: this.state,
        angles: null,
        activeSide: this.activeSide,
        repEvent: null
      };
    }

    // Determine camera-facing side
    const { side, score: sideScore } = this.determineCameraFacingSide(rawLandmarks);
    this.activeSide = side;

    // Extract landmarks for selected side
    const isLeft = side === "left";
    const shoulderIdx = isLeft ? POSE_LANDMARKS.LEFT_SHOULDER : POSE_LANDMARKS.RIGHT_SHOULDER;
    const elbowIdx    = isLeft ? POSE_LANDMARKS.LEFT_ELBOW : POSE_LANDMARKS.RIGHT_ELBOW;
    const wristIdx    = isLeft ? POSE_LANDMARKS.LEFT_WRIST : POSE_LANDMARKS.RIGHT_WRIST;
    const hipIdx      = isLeft ? POSE_LANDMARKS.LEFT_HIP : POSE_LANDMARKS.RIGHT_HIP;
    const kneeIdx     = isLeft ? POSE_LANDMARKS.LEFT_KNEE : POSE_LANDMARKS.RIGHT_KNEE;
    const ankleIdx    = isLeft ? POSE_LANDMARKS.LEFT_ANKLE : POSE_LANDMARKS.RIGHT_ANKLE;

    const shoulderLm = rawLandmarks[shoulderIdx];
    const elbowLm    = rawLandmarks[elbowIdx];
    const wristLm    = rawLandmarks[wristIdx];
    const hipLm      = rawLandmarks[hipIdx];
    const kneeLm     = rawLandmarks[kneeIdx];
    const ankleLm    = rawLandmarks[ankleIdx];

    // Visibility Check
    const minVis = this.config.minLandmarkVisibility;
    const isVisible = (
      (shoulderLm?.visibility ?? 0) >= minVis &&
      (elbowLm?.visibility ?? 0) >= minVis &&
      (wristLm?.visibility ?? 0) >= minVis &&
      (hipLm?.visibility ?? 0) >= minVis &&
      (ankleLm?.visibility ?? 0) >= minVis
    );

    if (!isVisible) {
      return {
        isValidPose: false,
        feedback: "Can't see you clearly",
        feedbackStatus: "bad",
        state: this.state,
        angles: null,
        activeSide: this.activeSide,
        sideScore,
        repEvent: null
      };
    }

    // Convert normalized coords to pixel space for aspect-ratio correct angle computation
    const shoulder = { x: shoulderLm.x * videoWidth, y: shoulderLm.y * videoHeight, vis: shoulderLm.visibility };
    const elbow    = { x: elbowLm.x * videoWidth, y: elbowLm.y * videoHeight, vis: elbowLm.visibility };
    const wrist    = { x: wristLm.x * videoWidth, y: wristLm.y * videoHeight, vis: wristLm.visibility };
    const hip      = { x: hipLm.x * videoWidth, y: hipLm.y * videoHeight, vis: hipLm.visibility };
    const knee     = { x: kneeLm.x * videoWidth, y: kneeLm.y * videoHeight, vis: kneeLm.visibility };
    const ankle    = { x: ankleLm.x * videoWidth, y: ankleLm.y * videoHeight, vis: ankleLm.visibility };

    // 1. Check Body Inclination (Shoulder-to-Ankle tilt relative to horizontal)
    const rawTiltAngle = calculateHorizontalAngle(shoulder, ankle);
    const tiltAngle = this.tiltFilter.filter(rawTiltAngle, timestampSec);

    if (tiltAngle > this.config.horizontalAngleLimit) {
      // User is not in push-up position (e.g., standing up, kneeling, or resting upright)
      this.state = "IDLE";
      this.resetRepTracking();
      return {
        isValidPose: true,
        isInPosition: false,
        feedback: "Get into push-up position (side view)",
        feedbackStatus: "warning",
        state: "IDLE",
        angles: { tiltAngle, elbowAngle: null, bodyAngle: null },
        activeSide: this.activeSide,
        sideScore,
        keypoints: { shoulder, elbow, wrist, hip, knee, ankle },
        repEvent: null
      };
    }

    // 2. Compute 2D Angles in pixel space
    const rawElbowAngle = calculateAngle2D(shoulder, elbow, wrist);
    const rawBodyAngle  = calculateAngle2D(shoulder, hip, ankle);

    // Apply One Euro Smoothing
    const elbowAngle = this.elbowFilter.filter(rawElbowAngle, timestampSec);
    const bodyAngle  = this.bodyFilter.filter(rawBodyAngle, timestampSec);

    // 3. Body Alignment Analysis (Sagging vs Piking)
    const hipOffset = calculateHipVerticalOffset(shoulder, hip, ankle);
    let currentBodyFault = null;

    if (bodyAngle < this.config.bodySagAngle && hipOffset > 8) {
      currentBodyFault = "HIPS_SAGGING";
    } else if (bodyAngle < this.config.bodyPikeAngle && hipOffset < -8) {
      currentBodyFault = "HIPS_PIKING";
    }

    // Track minimum body angle and accumulate faults occurring during the rep
    if (this.state !== "IDLE") {
      this.minBodyAngleInRep = Math.min(this.minBodyAngleInRep, bodyAngle);
      if (currentBodyFault === "HIPS_SAGGING") {
        this.repFaultsDetected.add("Hips sagging");
      } else if (currentBodyFault === "HIPS_PIKING") {
        this.repFaultsDetected.add("Hips piking");
      }
    }

    // 4. State Machine & Rep Counter with Hysteresis
    let repEvent = null;
    let liveFeedback = "Maintain plank position";
    let liveStatus = "good";

    // Track min elbow angle reached during rep
    if (this.state === "DESCENDING" || this.state === "DOWN" || this.state === "ASCENDING") {
      this.minElbowAngleInRep = Math.min(this.minElbowAngleInRep, elbowAngle);
    }

    switch (this.state) {
      case "IDLE":
        if (elbowAngle >= this.config.elbowUpThreshold) {
          this.state = "UP";
          liveFeedback = "Ready! Lower your chest";
          liveStatus = "good";
        } else {
          liveFeedback = "Straighten arms to start (lock out)";
          liveStatus = "warning";
        }
        break;

      case "UP":
        liveFeedback = "Lower your chest";
        liveStatus = "good";

        // Check if movement starts downwards
        if (elbowAngle < this.config.elbowUpThreshold - 5) {
          this.state = "DESCENDING";
          this.currentRepStartTime = timestampSec;
          this.minElbowAngleInRep = elbowAngle;
          this.minBodyAngleInRep = bodyAngle;
          this.repFaultsDetected.clear();
          this.hasReachedBottom = false;
        }
        break;

      case "DESCENDING":
        // Live feedback while going down
        if (elbowAngle <= this.config.elbowDownThreshold) {
          this.state = "DOWN";
          this.hasReachedBottom = true;
          this.currentRepBottomTime = timestampSec;
          liveFeedback = "Push back up!";
          liveStatus = "good";
        } else {
          liveFeedback = "Going down... lower!";
          liveStatus = "good";
        }
        break;

      case "DOWN":
        // At bottom or beginning ascent
        if (elbowAngle > this.config.elbowDownThreshold + 5) {
          this.state = "ASCENDING";
          liveFeedback = "Drive up to lockout!";
          liveStatus = "good";
        } else {
          liveFeedback = "Good bottom! Push up!";
          liveStatus = "good";
        }
        break;

      case "ASCENDING":
        // Check if fully locked out at the top
        if (elbowAngle >= this.config.elbowUpThreshold) {
          // Rep completed!
          const repDuration = timestampSec - (this.currentRepStartTime ?? timestampSec);

          // Discard reps shorter than minRepDurationSec (jitter/glitch protection)
          if (repDuration >= this.config.minRepDurationSec) {
            repEvent = this.evaluateCompletedRep(timestampSec);
            this.state = "UP";
            liveFeedback = repEvent.verdict === "GOOD" ? "Great rep! 🔥" : repEvent.faults[0] || "Needs work";
            liveStatus = repEvent.verdict === "GOOD" ? "good" : "bad";
          } else {
            // Discarded due to being too fast
            this.state = "UP";
            this.resetRepTracking();
            liveFeedback = "Rep too fast / bounce";
            liveStatus = "warning";
          }
        } else if (elbowAngle < this.minElbowAngleInRep + 5 && elbowAngle < this.config.elbowDownThreshold) {
          // Double bottom or bounce
          this.state = "DOWN";
        } else {
          liveFeedback = "Lock out at the top!";
          liveStatus = "warning";
        }
        break;
    }

    // Dynamic Live Form Warnings override default status if posture breaks
    if (currentBodyFault === "HIPS_SAGGING") {
      liveFeedback = "Lift your hips! (Sagging)";
      liveStatus = "bad";
    } else if (currentBodyFault === "HIPS_PIKING") {
      liveFeedback = "Lower your hips! (Piking)";
      liveStatus = "bad";
    }

    // Skeleton color indicator mapping
    let skeletonColor = "#00e676"; // green
    if (liveStatus === "warning") skeletonColor = "#ffc400"; // yellow
    if (liveStatus === "bad") skeletonColor = "#ff3366";     // red

    return {
      isValidPose: true,
      isInPosition: true,
      feedback: liveFeedback,
      feedbackStatus: liveStatus,
      skeletonColor,
      state: this.state,
      angles: {
        elbowAngle: Math.round(elbowAngle),
        bodyAngle: Math.round(bodyAngle),
        tiltAngle: Math.round(tiltAngle),
        minElbowAngleInRep: Math.round(this.minElbowAngleInRep)
      },
      keypoints: { shoulder, elbow, wrist, hip, knee, ankle },
      activeSide: this.activeSide,
      sideScore,
      repEvent
    };
  }

  /**
   * Evaluates the completed repetition against all criteria:
   * depth, sagging, piking, incomplete lockout, and tempo.
   */
  evaluateCompletedRep(completionTimeSec) {
    this.totalReps++;
    const repNumber = this.totalReps;
    const faults = [];

    // 1. Depth Evaluation
    const minAngle = this.minElbowAngleInRep;
    if (minAngle <= this.config.depthGoodAngle) {
      // Good depth
    } else if (minAngle <= this.config.depthShallowAngle) {
      faults.push(`Go a bit lower (${Math.round(minAngle)}°)`);
    } else {
      faults.push(`Shallow rep (${Math.round(minAngle)}°)`);
    }

    // 2. Body Sagging / Piking from rep accumulation
    for (const accumulatedFault of this.repFaultsDetected) {
      if (!faults.includes(accumulatedFault)) {
        faults.push(accumulatedFault);
      }
    }

    // 3. Tempo / Descent speed check
    let descentTime = 0;
    if (this.currentRepStartTime && this.currentRepBottomTime) {
      descentTime = this.currentRepBottomTime - this.currentRepStartTime;
      if (descentTime > 0 && descentTime < this.config.minDescentSec) {
        faults.push("Descent too fast (<0.5s)");
      }
    }

    const duration = this.currentRepStartTime ? (completionTimeSec - this.currentRepStartTime) : 1.0;
    const verdict = faults.length === 0 ? "GOOD" : "NEEDS_WORK";

    if (verdict === "GOOD") {
      this.goodReps++;
    } else {
      this.faultReps++;
    }

    const repResult = {
      repNumber,
      verdict,
      faults,
      minElbowAngle: Math.round(minAngle),
      durationSec: Number(duration.toFixed(2)),
      descentTimeSec: Number(descentTime.toFixed(2)),
      timestamp: new Date().toLocaleTimeString()
    };

    this.repHistory.push(repResult);
    this.resetRepTracking();

    return repResult;
  }

  /**
   * Generates a comprehensive session summary.
   */
  getSessionSummary() {
    const faultCounts = {};
    for (const r of this.repHistory) {
      for (const f of r.faults) {
        // Strip out specific dynamic numbers (e.g. angle) to group identical fault types
        const normalized = f.replace(/\s*\(\d+°\)/, "").trim();
        faultCounts[normalized] = (faultCounts[normalized] || 0) + 1;
      }
    }

    let topFault = "None! Clean session!";
    let maxFaultCount = 0;
    for (const [faultName, count] of Object.entries(faultCounts)) {
      if (count > maxFaultCount) {
        maxFaultCount = count;
        topFault = `${faultName} (${count}x)`;
      }
    }

    const accuracy = this.totalReps > 0
      ? Math.round((this.goodReps / this.totalReps) * 100)
      : 0;

    return {
      totalReps: this.totalReps,
      goodReps: this.goodReps,
      faultReps: this.faultReps,
      accuracyPercent: accuracy,
      topFault,
      history: [...this.repHistory]
    };
  }
}
