import { useCallback } from 'react';

import type { EditorLayerProperties } from '../../project/project.types';

import { usePreviewMedia } from './usePreviewMedia';
import { usePreviewImages } from './usePreviewImages';
import { usePreviewCanvas } from './usePreviewCanvas';

interface UsePreviewRendererOptions {
  width: number;
  height: number;
  layers: EditorLayerProperties[];
  mediaUrls: Record<string, string>;
  currentTime: number;
  getCurrentTime?: () => number;
  resolveLayers?: (time: number) => EditorLayerProperties[];
  fps: number;
  isPlaying: boolean;
  masterMuted: boolean;
  frameBlendingEnabled: boolean;
  motionBlurEnabled: boolean;
  onMediaDecodeError?: (name: string) => void;
}

export function usePreviewRenderer({
  width,
  height,
  layers,
  mediaUrls,
  currentTime,
  getCurrentTime,
  resolveLayers,
  fps,
  isPlaying,
  masterMuted,
  frameBlendingEnabled,
  motionBlurEnabled,
  onMediaDecodeError,
}: UsePreviewRendererOptions) {
  const {
    getVideoElement,
    pool,
  } = usePreviewMedia({
    layers,
    mediaUrls,
    currentTime,
    fps,
    isPlaying,
    masterMuted,
    onMediaDecodeError,
  });

  const {
    getImageElement,
  } = usePreviewImages({
    layers,
    mediaUrls,
  });

  const getMediaElement = useCallback(
    (
      layerId: string,
    ): HTMLImageElement | HTMLVideoElement | undefined => {
      const video = getVideoElement(layerId);

      if (video) {
        return video;
      }

      return getImageElement(layerId);
    },
    [getVideoElement, getImageElement],
  );

  const compositeCanvasRef = usePreviewCanvas({
    width,
    height,
    currentTime,
    getCurrentTime,
    resolveLayers,
    isPlaying,
    layers,
    getMediaElement,
    frameBlendingEnabled,
    motionBlurEnabled,
  });

  return {
    compositeCanvasRef,
    getMediaElement,
    videoPool: pool,
  };
}