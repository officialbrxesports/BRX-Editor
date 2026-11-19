import {
  useEffect,
  useRef,
  useState,
} from 'react';

import {
  PLAYBACK_BACKING_SIDE,
  PLAYBACK_MAX_FPS,
  PREVIEW_MAX_BACKING_PIXELS,
  PREVIEW_MAX_BACKING_SIDE,
} from '../../../config';
import type { EditorLayerProperties } from '../../project/project.types';
import { applyGroupInheritance } from '../groupUtils';
import { reportRenderTime } from './renderStats';
import {
  getPreviewResolution,
  getResolutionFactor,
  subscribePreviewResolution,
} from './previewResolution';

import {
  drawLayerCanvas,
  getCanvasCompositeMode,
  getLayerCanvasFilter,
} from './previewCanvas';

interface UsePreviewCanvasOptions {
  width: number;
  height: number;
  currentTime: number;
  getCurrentTime?: () => number;
  resolveLayers?: (time: number) => EditorLayerProperties[];
  isPlaying: boolean;
  layers: EditorLayerProperties[];
  getMediaElement: (
    layerId: string,
  ) => HTMLImageElement | HTMLVideoElement | undefined;
  frameBlendingEnabled: boolean;
  motionBlurEnabled: boolean;
}

interface RenderOptions extends UsePreviewCanvasOptions {}

function getReusableCanvas(
  cache: Map<string, HTMLCanvasElement>,
  key: string,
  width: number,
  height: number,
): HTMLCanvasElement {
  let canvas = cache.get(key);

  if (!canvas) {
    canvas = document.createElement('canvas');
    cache.set(key, canvas);
  }

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  return canvas;
}

export function usePreviewCanvas({
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
}: UsePreviewCanvasOptions) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const optionsRef = useRef<RenderOptions>({
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

  const layerCanvasCacheRef = useRef(
    new Map<string, HTMLCanvasElement>(),
  );

  const matteCanvasCacheRef = useRef(
    new Map<string, HTMLCanvasElement>(),
  );

  const underlayCanvasCacheRef = useRef(
    new Map<string, HTMLCanvasElement>(),
  );

  const renderRef = useRef<() => void>(() => undefined);

  // Size of the canvas on screen (CSS pixels). It changes only when the
  // viewer is resized or zoomed, never per frame.
  const cssSizeRef = useRef({ width: 0, height: 0 });
  const [viewWidth, setViewWidth] = useState(0);

  optionsRef.current = {
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
  };

  renderRef.current = () => {
    const options = optionsRef.current;

    const {
      width: renderWidth,
      height: renderHeight,
      currentTime: stateTime,
      isPlaying: playing,
      layers: stateLayers,
      getMediaElement: getMedia,
      frameBlendingEnabled: frameBlend,
      motionBlurEnabled: motionBlur,
    } = options;

    // While playing, use the exact clock (ref) instead of the ~15 Hz React state.
    const renderTime =
      playing && options.getCurrentTime
        ? options.getCurrentTime()
        : stateTime;

    const renderLayers = applyGroupInheritance(
      playing && options.getCurrentTime && options.resolveLayers
        ? options.resolveLayers(renderTime)
        : stateLayers,
    );

    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');

    if (!context) {
      return;
    }

    const safeWidth = Math.max(1, renderWidth);
    const safeHeight = Math.max(1, renderHeight);

    // Backing store: the on-screen size times devicePixelRatio, never larger
    // than the composition, and capped so an 8K project cannot crash the
    // canvas. While playing, a lower cap keeps the frame rate up.
    const pixelRatio = window.devicePixelRatio || 1;
    const cssWidth = cssSizeRef.current.width;
    const wantedWidth = cssWidth > 0 ? cssWidth * pixelRatio : 1280;
    const sideCap = playing
      ? PLAYBACK_BACKING_SIDE
      : PREVIEW_MAX_BACKING_SIDE;

    // Auto follows the size on screen; the others are a share of the comp.
    let renderScale =
      getResolutionFactor(getPreviewResolution()) ??
      Math.min(1, wantedWidth / safeWidth);
    renderScale = Math.min(
      renderScale,
      sideCap / Math.max(safeWidth, safeHeight),
      Math.sqrt(PREVIEW_MAX_BACKING_PIXELS / (safeWidth * safeHeight)),
    );
    renderScale = Math.max(renderScale, Math.min(1, 320 / safeWidth));

    const canvasWidth = Math.max(
      1,
      Math.round(safeWidth * renderScale),
    );

    const canvasHeight = Math.max(
      1,
      Math.round(safeHeight * renderScale),
    );

    if (
      canvas.width !== canvasWidth ||
      canvas.height !== canvasHeight
    ) {
      canvas.width = canvasWidth;
      canvas.height = canvasHeight;
    }

    context.clearRect(
      0,
      0,
      canvas.width,
      canvas.height,
    );

    context.save();
    context.scale(renderScale, renderScale);

    const soloActive = renderLayers.some(
      (layer) => layer.solo,
    );

    const matteSourceIds = new Set(
      renderLayers
        .filter(
          (layer) =>
            layer.trackMatte &&
            layer.trackMatte !== 'none',
        )
        .map((layer) => layer.matteSourceId)
        .filter((id): id is string => Boolean(id)),
    );

    const activeAtTime = (
      layer: EditorLayerProperties,
    ) => {
      const start = layer.startTime ?? 0;
      const inPoint = layer.inPoint ?? 0;
      const outPoint =
        layer.outPoint ?? Number.POSITIVE_INFINITY;

      const stretch = Math.max(
        0.01,
        layer.stretch ?? 100,
      );

      const sourceDuration = Math.max(
        0,
        outPoint - inPoint,
      );

      const timelineDuration =
        sourceDuration === Number.POSITIVE_INFINITY
          ? Number.POSITIVE_INFINITY
          : sourceDuration * stretch / 100;

      return (
        renderTime >= start &&
        renderTime < start + timelineDuration
      );
    };

    const layerCache = layerCanvasCacheRef.current;
    const matteCache = matteCanvasCacheRef.current;
    const underlayCache = underlayCanvasCacheRef.current;

    const activeIds = new Set(
      renderLayers.map((layer) => layer.id),
    );

    for (const id of layerCache.keys()) {
      if (!activeIds.has(id)) {
        layerCache.delete(id);
        matteCache.delete(id);
        underlayCache.delete(id);
      }
    }

    for (
      let index = renderLayers.length - 1;
      index >= 0;
      index -= 1
    ) {
      const layer = renderLayers[index];

      if (
        !activeAtTime(layer) ||
        layer.type === 'audio' ||
        (soloActive && !layer.solo) ||
        (layer.visible === false &&
          !matteSourceIds.has(layer.id)) ||
        matteSourceIds.has(layer.id)
      ) {
        continue;
      }

      const needsIsolation = Boolean(
        (layer.trackMatte &&
          layer.trackMatte !== 'none') ||
          layer.preserveTransparency,
      );

      if (!needsIsolation) {
        context.globalCompositeOperation =
          getCanvasCompositeMode(layer.blendMode);

        context.filter = getLayerCanvasFilter(
          layer,
          playing,
          frameBlend,
          motionBlur,
        );

        drawLayerCanvas(
          context,
          layer,
          renderLayers,
          safeWidth,
          safeHeight,
          getMedia(layer.id),
        );

        context.filter = 'none';
        context.globalCompositeOperation = 'source-over';

        continue;
      }

      const layerCanvas = getReusableCanvas(
        layerCache,
        layer.id,
        canvas.width,
        canvas.height,
      );

      const layerContext = layerCanvas.getContext('2d');

      if (!layerContext) {
        continue;
      }

      layerContext.clearRect(
        0,
        0,
        layerCanvas.width,
        layerCanvas.height,
      );

      layerContext.save();
      layerContext.setTransform(
        renderScale,
        0,
        0,
        renderScale,
        0,
        0,
      );

      layerContext.filter = getLayerCanvasFilter(
        layer,
        playing,
        frameBlend,
        motionBlur,
      );

      drawLayerCanvas(
        layerContext,
        layer,
        renderLayers,
        safeWidth,
        safeHeight,
        getMedia(layer.id),
      );

      layerContext.restore();

      if (
        layer.trackMatte &&
        layer.trackMatte !== 'none' &&
        layer.matteSourceId
      ) {
        const matte = renderLayers.find(
          (item) => item.id === layer.matteSourceId,
        );

        if (matte && activeAtTime(matte)) {
          const matteCanvas = getReusableCanvas(
            matteCache,
            layer.id,
            canvas.width,
            canvas.height,
          );

          const matteContext = matteCanvas.getContext('2d');

          if (matteContext) {
            matteContext.clearRect(
              0,
              0,
              matteCanvas.width,
              matteCanvas.height,
            );

            matteContext.save();
            matteContext.setTransform(
              renderScale,
              0,
              0,
              renderScale,
              0,
              0,
            );

            drawLayerCanvas(
              matteContext,
              matte,
              renderLayers,
              safeWidth,
              safeHeight,
              getMedia(matte.id),
            );

            matteContext.restore();

            if (layer.trackMatte.startsWith('luma')) {
              const pixels = matteContext.getImageData(
                0,
                0,
                matteCanvas.width,
                matteCanvas.height,
              );

              for (
                let pixel = 0;
                pixel < pixels.data.length;
                pixel += 4
              ) {
                const luminance = Math.round(
                  pixels.data[pixel] * 0.2126 +
                    pixels.data[pixel + 1] * 0.7152 +
                    pixels.data[pixel + 2] * 0.0722,
                );

                pixels.data[pixel] = 255;
                pixels.data[pixel + 1] = 255;
                pixels.data[pixel + 2] = 255;

                pixels.data[pixel + 3] = Math.round(
                  luminance *
                    pixels.data[pixel + 3] /
                    255,
                );
              }

              matteContext.putImageData(pixels, 0, 0);
            }

            layerContext.save();
            layerContext.setTransform(1, 0, 0, 1, 0, 0);

            layerContext.globalCompositeOperation =
              layer.trackMatte.endsWith('inverted')
                ? 'destination-out'
                : 'destination-in';

            layerContext.drawImage(matteCanvas, 0, 0);
            layerContext.restore();
          }
        } else {
          layerContext.clearRect(
            0,
            0,
            layerCanvas.width,
            layerCanvas.height,
          );
        }
      }

      if (layer.preserveTransparency) {
        const underlay = getReusableCanvas(
          underlayCache,
          layer.id,
          canvas.width,
          canvas.height,
        );

        const underlayContext = underlay.getContext('2d');

        if (underlayContext) {
          underlayContext.clearRect(
            0,
            0,
            underlay.width,
            underlay.height,
          );

          underlayContext.drawImage(canvas, 0, 0);

          layerContext.save();
          layerContext.setTransform(1, 0, 0, 1, 0, 0);

          layerContext.globalCompositeOperation =
            'destination-in';

          layerContext.drawImage(underlay, 0, 0);
          layerContext.restore();
        }
      }

      context.globalCompositeOperation =
        getCanvasCompositeMode(layer.blendMode);

      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(layerCanvas, 0, 0);
      context.restore();
    }

    context.restore();
  };

  // A change of the preview resolution asks for a new frame.
  const [resolutionVersion, setResolutionVersion] = useState(0);

  useEffect(
    () =>
      subscribePreviewResolution(() =>
        setResolutionVersion((version) => version + 1),
      ),
    [],
  );

  // Keep the on-screen canvas size up to date (resize and viewer zoom).
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      cssSizeRef.current = {
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      };
      setViewWidth(Math.round(canvas.clientWidth));
    });

    observer.observe(canvas);

    return () => {
      observer.disconnect();
    };
  }, []);

  // One scheduler, driven by a dirty flag.
  // Paused: every change schedules at most one frame (changes made within
  // the same frame are merged). Playing: one continuous loop, limited to
  // PLAYBACK_MAX_FPS even on high refresh-rate screens.
  useEffect(() => {
    let disposed = false;
    let animationFrame = 0;
    let lastDraw = 0;
    let dirty = true;
    const minInterval = 1000 / PLAYBACK_MAX_FPS - 1;

    // Draws a frame and reports how long it took ("Frame Render Time").
    const timedRender = () => {
      const started = performance.now();

      renderRef.current();
      reportRenderTime(performance.now() - started);
    };

    const tick = (now: number) => {
      animationFrame = 0;

      if (disposed) {
        return;
      }

      if (isPlaying) {
        if (now - lastDraw >= minInterval) {
          lastDraw = now;
          timedRender();
        }

        animationFrame = requestAnimationFrame(tick);
        return;
      }

      if (dirty) {
        dirty = false;
        timedRender();
      }
    };

    animationFrame = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
    };
  }, [
    width,
    height,
    viewWidth,
    resolutionVersion,
    currentTime,
    isPlaying,
    layers,
    getMediaElement,
    frameBlendingEnabled,
    motionBlurEnabled,
  ]);

  // Release cached canvases when the hook unmounts.
  useEffect(() => {
    return () => {
      layerCanvasCacheRef.current.clear();
      matteCanvasCacheRef.current.clear();
      underlayCanvasCacheRef.current.clear();
    };
  }, []);

  return canvasRef;
}
