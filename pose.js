/**
 * pose.js - MediaPipe PoseLandmarker Wrapper
 * 
 * Handles loading of Google MediaPipe Tasks Vision PoseLandmarker via CDN,
 * attempting GPU acceleration first and gracefully falling back to CPU if unsupported.
 * Manages video-frame inference with strictly monotonic timestamp tracking.
 */

import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/vision_bundle.mjs";

const WASM_CDN_PATH = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm";
const DEFAULT_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task";

class PoseService {
  constructor() {
    this.landmarker = null;
    this.activeDelegate = null;
    this.lastTimestamp = -1;
    this.isLoading = false;
  }

  /**
   * Initializes PoseLandmarker with GPU delegate first, falling back to CPU.
   * @param {Object} config - Configuration options (e.g. modelPath, minPoseDetectionConfidence)
   * @returns {Promise<PoseLandmarker>}
   */
  async init(config = {}) {
    if (this.landmarker) return this.landmarker;
    if (this.isLoading) {
      throw new Error("PoseLandmarker initialization already in progress.");
    }

    this.isLoading = true;
    const modelUrl = config.modelAssetPath || DEFAULT_MODEL_URL;

    try {
      console.log("[PoseService] Loading MediaPipe FilesetResolver...");
      const vision = await FilesetResolver.forVisionTasks(WASM_CDN_PATH);

      // Attempt GPU delegate first for 30+ FPS performance
      try {
        console.log("[PoseService] Attempting to initialize PoseLandmarker with GPU delegate...");
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelUrl,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: config.minDetectionConfidence || 0.5,
          minPosePresenceConfidence: config.minPresenceConfidence || 0.5,
          minTrackingConfidence: config.minTrackingConfidence || 0.5
        });
        this.activeDelegate = "GPU";
        console.log("[PoseService] Successfully loaded with GPU acceleration.");
      } catch (gpuError) {
        console.warn("[PoseService] GPU initialization failed. Falling back to CPU delegate:", gpuError);

        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: modelUrl,
            delegate: "CPU"
          },
          runningMode: "VIDEO",
          numPoses: 1,
          minPoseDetectionConfidence: config.minDetectionConfidence || 0.5,
          minPosePresenceConfidence: config.minPresenceConfidence || 0.5,
          minTrackingConfidence: config.minTrackingConfidence || 0.5
        });
        this.activeDelegate = "CPU";
        console.log("[PoseService] Successfully loaded with CPU delegate.");
      }

      this.isLoading = false;
      return this.landmarker;
    } catch (err) {
      this.isLoading = false;
      console.error("[PoseService] Fatal error initializing PoseLandmarker:", err);
      throw err;
    }
  }

  /**
   * Checks if PoseLandmarker is ready for inference.
   * @returns {boolean}
   */
  isReady() {
    return this.landmarker !== null;
  }

  /**
   * Returns current active delegate ("GPU" or "CPU")
   * @returns {string|null}
   */
  getDelegate() {
    return this.activeDelegate;
  }

  /**
   * Runs inference on the given video element.
   * Ensures timestamp is strictly monotonic as required by MediaPipe Tasks Vision.
   * 
   * @param {HTMLVideoElement} videoElement
   * @param {number} timestampMs - Frame timestamp in milliseconds
   * @returns {Array<Object>|null} Normalized landmarks for the detected pose or null
   */
  detectPose(videoElement, timestampMs) {
    if (!this.landmarker) {
      throw new Error("PoseLandmarker not initialized. Call init() first.");
    }

    if (!videoElement || videoElement.readyState < 2) {
      return null;
    }

    // MediaPipe requires strictly monotonically increasing timestamps
    let safeTimestamp = Number(timestampMs);
    if (isNaN(safeTimestamp) || safeTimestamp <= this.lastTimestamp) {
      safeTimestamp = this.lastTimestamp + 1;
    }
    this.lastTimestamp = safeTimestamp;

    try {
      const results = this.landmarker.detectForVideo(videoElement, safeTimestamp);
      if (results && results.landmarks && results.landmarks.length > 0) {
        return results.landmarks[0]; // First pose detected
      }
      return null;
    } catch (error) {
      console.error("[PoseService] detectForVideo execution error:", error);
      return null;
    }
  }

  /**
   * Resets timestamp tracking (e.g., when video is looped or scrubbed backward).
   */
  resetTimestamp() {
    this.lastTimestamp = -1;
  }

  /**
   * Disposes the current landmarker instance and frees resources.
   */
  dispose() {
    if (this.landmarker) {
      this.landmarker.close();
      this.landmarker = null;
      this.activeDelegate = null;
      this.lastTimestamp = -1;
    }
  }
}

// Export singleton instance
export const poseService = new PoseService();
