/**
 * db.js - IndexedDB Storage Manager for GymCoach AI
 * 
 * Securely stores workout session records and full-resolution video Blobs
 * entirely on-device in the browser (zero cloud, 100% privacy).
 */

const DB_NAME = "GymCoachDB";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

class StorageService {
  constructor() {
    this.db = null;
  }

  /**
   * Opens or initializes the IndexedDB database.
   * @returns {Promise<IDBDatabase>}
   */
  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          // Keyed by timestamp id, indexed by date
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("timestamp", "timestamp", { unique: false });
        }
      };

      request.onsuccess = (event) => {
        this.db = event.target.result;
        resolve(this.db);
      };

      request.onerror = (event) => {
        console.error("[StorageService] Failed to open IndexedDB:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Saves a completed session record with optional video Blob.
   * @param {Object} session - Session object containing stats, rep breakdown, and video blob
   * @returns {Promise<string>} The session ID
   */
  async saveSession(session) {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);

      const record = {
        id: session.id || `session_${Date.now()}`,
        timestamp: session.timestamp || Date.now(),
        dateStr: session.dateStr || new Date().toLocaleString(),
        durationSec: session.durationSec || 0,
        totalReps: session.totalReps || 0,
        goodReps: session.goodReps || 0,
        faultReps: session.faultReps || 0,
        accuracyPercent: session.accuracyPercent || 0,
        topFault: session.topFault || "None",
        repHistory: session.repHistory || [],
        videoBlob: session.videoBlob || null,
        videoMimeType: session.videoMimeType || "video/webm"
      };

      const request = store.put(record);

      request.onsuccess = () => resolve(record.id);
      request.onerror = (event) => {
        console.error("[StorageService] Error saving session:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieves all saved sessions, ordered newest to oldest.
   * @returns {Promise<Array<Object>>}
   */
  async getAllSessions() {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const sessions = request.result || [];
        // Sort newest first
        sessions.sort((a, b) => b.timestamp - a.timestamp);
        resolve(sessions);
      };

      request.onerror = (event) => {
        console.error("[StorageService] Error reading sessions:", event.target.error);
        reject(event.target.error);
      };
    });
  }

  /**
   * Retrieves a single session by its ID.
   * @param {string} id
   * @returns {Promise<Object|null>}
   */
  async getSession(id) {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(id);

      request.onsuccess = () => resolve(request.result || null);
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Deletes a session by ID.
   * @param {string} id
   * @returns {Promise<void>}
   */
  async deleteSession(id) {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.delete(id);

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }

  /**
   * Deletes all saved workout sessions.
   * @returns {Promise<void>}
   */
  async clearAll() {
    const db = await this.open();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = (event) => reject(event.target.error);
    });
  }
}

export const storageService = new StorageService();
