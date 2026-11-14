export type VideoPoolMediaKind = "video" | "audio";

export interface VideoPoolOptions {
  muted?: boolean;
  volume?: number;
  playbackRate?: number;
}

interface VideoPoolEntry {
  layerId: string;
  url: string;
  kind: VideoPoolMediaKind;
  element: HTMLVideoElement | HTMLAudioElement;
  pendingSeek: number | null;
  seeking: boolean;
  seekStartedAt: number;
  disposed: boolean;
  lastGoodFrameTime: number;
  onSeeked: () => void;
  onLoadedMetadata: () => void;
}

export class VideoPool {
  private entries = new Map<string, VideoPoolEntry>();

  private createElement(
    kind: VideoPoolMediaKind,
    options: VideoPoolOptions,
  ): HTMLVideoElement | HTMLAudioElement {
    const volume = Math.max(
      0,
      Math.min(1, options.volume ?? 1),
    );

    if (kind === "video") {
      const video = document.createElement("video");

      video.preload = "auto";
      video.playsInline = true;
      video.muted = options.muted ?? true;
      video.volume = volume;
      video.playbackRate = options.playbackRate ?? 1;

      return video;
    }

    const audio = document.createElement("audio");

    audio.preload = "auto";
    audio.muted = options.muted ?? false;
    audio.volume = volume;
    audio.playbackRate = options.playbackRate ?? 1;

    return audio;
  }

  acquire(
    layerId: string,
    url: string,
    kind: VideoPoolMediaKind = "video",
    options: VideoPoolOptions = {},
  ): HTMLVideoElement | HTMLAudioElement {
    const existing = this.entries.get(layerId);

    if (existing && existing.url === url && existing.kind === kind) {
      return existing.element;
    }

    if (existing) {
      this.release(layerId);
    }

    const element = this.createElement(kind, options);

    const entry: VideoPoolEntry = {
      layerId,
      url,
      kind,
      element,
      pendingSeek: null,
      seeking: false,
      seekStartedAt: 0,
      disposed: false,
      lastGoodFrameTime: -1,
      onSeeked: () => this.handleSeeked(layerId),
      onLoadedMetadata: () => this.handleLoadedMetadata(layerId),
    };

    element.addEventListener("seeked", entry.onSeeked);
    element.addEventListener(
      "loadedmetadata",
      entry.onLoadedMetadata,
    );

    this.entries.set(layerId, entry);
    element.src = url;
    element.load();

    return element;
  }

  get(layerId: string): HTMLVideoElement | HTMLAudioElement | null {
    return this.entries.get(layerId)?.element ?? null;
  }

  getVideo(layerId: string): HTMLVideoElement | null {
    const entry = this.entries.get(layerId);

    if (!entry || entry.kind !== "video") {
      return null;
    }

    return entry.element as HTMLVideoElement;
  }

  seek(layerId: string, targetSeconds: number): void {
    const entry = this.entries.get(layerId);

    if (!entry || entry.disposed) {
      return;
    }

    const element = entry.element;

    if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
      entry.pendingSeek = Math.max(0, targetSeconds);
      return;
    }

    const duration = Number.isFinite(element.duration)
      ? element.duration
      : targetSeconds;

    const safeTarget = Math.max(
      0,
      Math.min(targetSeconds, Math.max(0, duration - 0.001)),
    );

    entry.pendingSeek = safeTarget;

    // A seek that never reported "seeked" must not block future seeks.
    if (
      entry.seeking &&
      performance.now() - entry.seekStartedAt > 1000
    ) {
      entry.seeking = false;
    }

    if (entry.seeking) {
      return;
    }

    this.applyPendingSeek(entry);
  }

  private applyPendingSeek(entry: VideoPoolEntry): void {
    if (
      entry.disposed ||
      entry.seeking ||
      entry.pendingSeek === null
    ) {
      return;
    }

    const element = entry.element;
    const target = entry.pendingSeek;

    if (element.readyState < HTMLMediaElement.HAVE_METADATA) {
      return;
    }

    if (Math.abs(element.currentTime - target) < 0.001) {
      entry.pendingSeek = null;
      return;
    }

    entry.seeking = true;
    entry.seekStartedAt = performance.now();

    try {
      if (
        entry.kind === "video" &&
        typeof (element as HTMLVideoElement).fastSeek === "function"
      ) {
        (element as HTMLVideoElement).fastSeek(target);
      } else {
        element.currentTime = target;
      }
    } catch {
      entry.seeking = false;
    }
  }

  private handleSeeked(layerId: string): void {
    const entry = this.entries.get(layerId);

    if (!entry || entry.disposed) {
      return;
    }

    entry.seeking = false;

    if (
      entry.kind === "video" &&
      entry.element.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
      entry.lastGoodFrameTime = entry.element.currentTime;
    }

    if (
      entry.pendingSeek !== null &&
      Math.abs(entry.element.currentTime - entry.pendingSeek) > 0.001
    ) {
      this.applyPendingSeek(entry);
    } else {
      entry.pendingSeek = null;
    }
  }

  private handleLoadedMetadata(layerId: string): void {
    const entry = this.entries.get(layerId);

    if (!entry || entry.disposed) {
      return;
    }

    this.applyPendingSeek(entry);
  }

  play(layerId: string): void {
    const entry = this.entries.get(layerId);

    if (!entry || entry.disposed) {
      return;
    }

    void entry.element.play().catch(() => {
      // Browser autoplay restrictions can prevent playback.
    });
  }

  pause(layerId: string): void {
    this.entries.get(layerId)?.element.pause();
  }

  setMuted(layerId: string, muted: boolean): void {
    const entry = this.entries.get(layerId);

    if (entry) {
      entry.element.muted = muted;
    }
  }

  setVolume(layerId: string, volume: number): void {
    const entry = this.entries.get(layerId);

    if (entry) {
      entry.element.volume = Math.max(0, Math.min(1, volume));
    }
  }

  setPlaybackRate(layerId: string, rate: number): void {
    const entry = this.entries.get(layerId);

    if (entry && Number.isFinite(rate) && rate > 0) {
      entry.element.playbackRate = rate;
    }
  }

  drawVideo(
    layerId: string,
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
  ): boolean {
    const entry = this.entries.get(layerId);

    if (!entry || entry.kind !== "video" || entry.disposed) {
      return false;
    }

    const video = entry.element as HTMLVideoElement;

    if (
      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      video.videoWidth === 0 ||
      video.videoHeight === 0
    ) {
      return false;
    }

    try {
      context.drawImage(video, x, y, width, height);
      entry.lastGoodFrameTime = video.currentTime;
      return true;
    } catch {
      return false;
    }
  }

  getReadyState(layerId: string): number {
    return this.entries.get(layerId)?.element.readyState ?? 0;
  }

  getLastGoodFrameTime(layerId: string): number {
    return this.entries.get(layerId)?.lastGoodFrameTime ?? -1;
  }

  release(layerId: string): void {
    const entry = this.entries.get(layerId);

    if (!entry) {
      return;
    }

    entry.disposed = true;
    entry.element.pause();

    entry.element.removeEventListener("seeked", entry.onSeeked);
    entry.element.removeEventListener(
      "loadedmetadata",
      entry.onLoadedMetadata,
    );

    entry.element.removeAttribute("src");
    entry.element.load();

    this.entries.delete(layerId);
  }

  releaseAll(): void {
    for (const layerId of [...this.entries.keys()]) {
      this.release(layerId);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
