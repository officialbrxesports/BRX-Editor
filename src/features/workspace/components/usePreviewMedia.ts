import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import type { EditorLayerProperties } from '../../project/project.types';

import {
  VideoPool,
  type VideoPoolMediaKind,
} from '../video/VideoPool';

interface UsePreviewMediaOptions {
  layers: EditorLayerProperties[];
  mediaUrls: Record<string, string>;
  currentTime: number;
  fps: number;
  isPlaying: boolean;
  masterMuted: boolean;
  onMediaDecodeError?: (name: string) => void;
}

interface PreviewMediaSource {
  layerId: string;
  name: string;
  url: string;
  kind: VideoPoolMediaKind;
  inPoint: number;
  outPoint: number;
  startTime: number;
  stretch: number;
  audioMuted: boolean;
  sourceDurationFrames?: number;
}

const PLAYBACK_DRIFT_THRESHOLD = 0.3;
const PLAYBACK_CORRECTION_INTERVAL = 750;
const START_DRIFT_THRESHOLD = 0.08;

export function usePreviewMedia({
  layers,
  mediaUrls,
  currentTime,
  fps,
  isPlaying,
  masterMuted,
  onMediaDecodeError,
}: UsePreviewMediaOptions) {
  const poolRef = useRef<VideoPool | null>(null);
  const managedIdsRef = useRef(new Set<string>());
  const errorCallbackRef = useRef(onMediaDecodeError);

  const lastCorrectionRef = useRef(
    new Map<string, number>(),
  );

  errorCallbackRef.current = onMediaDecodeError;

  if (!poolRef.current) {
    poolRef.current = new VideoPool();
  }

  const sources = useMemo<PreviewMediaSource[]>(() => {
    return layers.flatMap((layer) => {
      if (
        !layer.sourceId ||
        (layer.type !== 'video' && layer.type !== 'audio')
      ) {
        return [];
      }

      const url = mediaUrls[layer.sourceId];

      if (!url) {
        return [];
      }

      return [{
        layerId: layer.id,
        name: layer.name,
        url,
        kind: layer.type,
        inPoint: layer.inPoint ?? 0,
        outPoint: layer.outPoint ?? (
          layer.sourceDurationFrames !== undefined
            ? layer.sourceDurationFrames / Math.max(1, fps)
            : Number.POSITIVE_INFINITY
        ),
        startTime: layer.startTime ?? 0,
        stretch: layer.stretch ?? 100,
        audioMuted: layer.audioMuted === true,
        sourceDurationFrames: layer.sourceDurationFrames,
      }];
    });
  }, [layers, mediaUrls, fps]);

  useEffect(() => {
    const pool = poolRef.current;

    if (!pool) {
      return;
    }

    const nextIds = new Set(
      sources.map((source) => source.layerId),
    );

    for (const oldId of managedIdsRef.current) {
      if (!nextIds.has(oldId)) {
        pool.release(oldId);
        lastCorrectionRef.current.delete(oldId);
      }
    }

    for (const source of sources) {
      const element = pool.acquire(
        source.layerId,
        source.url,
        source.kind,
        {
          muted: false,
          volume: 1,
          playbackRate: 1,
        },
      );

      element.onerror = () => {
        errorCallbackRef.current?.(source.name);
      };
    }

    managedIdsRef.current = nextIds;
  }, [sources]);

  useEffect(() => {
    const pool = poolRef.current;

    if (!pool) {
      return;
    }

    const now = performance.now();
    const safeFps = Math.max(1, fps);

    for (const source of sources) {
      const element = pool.get(source.layerId);

      if (!element) {
        continue;
      }

      const stretch = Math.max(0.01, source.stretch);
      const elapsed = currentTime - source.startTime;

      const sourceDuration = Math.max(
        0,
        source.outPoint - source.inPoint,
      );

      const timelineDuration =
        sourceDuration === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : sourceDuration * stretch / 100;

      const isInRange =
        elapsed >= 0 &&
        elapsed < timelineDuration;

      pool.setMuted(
        source.layerId,
        masterMuted || source.audioMuted,
      );

      pool.setPlaybackRate(
        source.layerId,
        100 / stretch,
      );

      if (!isInRange) {
        pool.pause(source.layerId);
        lastCorrectionRef.current.delete(source.layerId);
        continue;
      }

      const target = Math.max(
        0,
        source.inPoint + elapsed * 100 / stretch,
      );

      const drift = Math.abs(
        element.currentTime - target,
      );

      if (!isPlaying) {
        pool.pause(source.layerId);

        const frameTime =
          Math.floor(target * safeFps) / safeFps;

        if (
          !element.seeking &&
          Math.abs(element.currentTime - frameTime) > 0.001
        ) {
          pool.seek(source.layerId, frameTime);
        }

        lastCorrectionRef.current.delete(source.layerId);
        continue;
      }

      if (element.paused) {
        if (
          !element.seeking &&
          drift > START_DRIFT_THRESHOLD
        ) {
          pool.seek(source.layerId, target);
        }

        pool.play(source.layerId);
        lastCorrectionRef.current.set(
          source.layerId,
          now,
        );

        continue;
      }

      if (
        drift > PLAYBACK_DRIFT_THRESHOLD &&
        !element.seeking
      ) {
        const lastCorrection =
          lastCorrectionRef.current.get(source.layerId) ?? 0;

        if (
          now - lastCorrection >=
          PLAYBACK_CORRECTION_INTERVAL
        ) {
          pool.seek(source.layerId, target);

          lastCorrectionRef.current.set(
            source.layerId,
            now,
          );
        }
      }
    }
  }, [
    sources,
    currentTime,
    fps,
    isPlaying,
    masterMuted,
  ]);

  useEffect(() => {
    return () => {
      poolRef.current?.releaseAll();
      managedIdsRef.current.clear();
      lastCorrectionRef.current.clear();
    };
  }, []);

  const getMediaElement = useCallback(
    (layerId: string) => {
      return poolRef.current?.get(layerId) ?? undefined;
    },
    [],
  );

  const getVideoElement = useCallback(
    (layerId: string) => {
      return poolRef.current?.getVideo(layerId) ?? undefined;
    },
    [],
  );

  return {
    getMediaElement,
    getVideoElement,
    pool: poolRef.current,
  };
}
