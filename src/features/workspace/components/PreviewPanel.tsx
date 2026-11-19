import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  useState,
} from 'react';

import MaterialIcon from './MaterialIcon';

import type {
  AnimatedPropertyName,
  EditorLayerProperties,
  EditorTool,
} from '../../project/project.types';

import {
  getCssBlendMode,
  getWorldTransform,
  type WorldTransform,
} from './previewCanvas';

import { usePreviewRenderer } from './usePreviewRenderer';
import { usePreviewTransform } from './usePreviewTransform';
import PreviewOverlay, { type PreviewOverlayApi } from './PreviewOverlay';
import { applyGroupInheritance } from '../groupUtils';
import type { MenuRequest } from '../WorkspaceMenus';
import './PreviewOverlay.css';
import {
  getPreviewResolution,
  PREVIEW_RESOLUTIONS,
  setPreviewResolution,
  subscribePreviewResolution,
  type PreviewResolution,
} from './previewResolution';
import PreviewGuidesLayer from './PreviewGuides';
import PreviewRulers from './PreviewRulers';
import RenderTimeLabel from './RenderTimeLabel';
import { getPointerInfo, readPixel, setPointerInfo } from './pointerInfo';
import {
  clearGuides,
  getPreviewGuides,
  GRID_SIZES,
  subscribePreviewGuides,
  updatePreviewGuides,
} from './guideSettings';
import ContextMenu, { type ContextMenuItem } from '../../../components/common/ContextMenu';

type PreviewPanelProps = {
  width?: number;
  height?: number;
  fps?: number;
  currentTime?: number;
  isPlaying?: boolean;
  isMuted?: boolean;
  zoom?: number;
  backgroundColor?: string;
  mediaUrls?: Record<string, string>;
  mediaThumbnails?: Record<string, string>;
  missingMediaIds?: string[];
  masterMuted?: boolean;
  activeTool?: EditorTool;
  layers?: EditorLayerProperties[];
  animatedLayers?: EditorLayerProperties[];
  getCurrentTime?: () => number;
  resolveLayers?: (time: number) => EditorLayerProperties[];
  selectedLayerId?: string | null;
  onSelectLayer?: (layerId: string | null) => void;
  onOpenContextMenu?: (request: MenuRequest) => void;
  onTogglePlayback?: () => void;
  onStopPlayback?: () => void;
  onToggleMute?: () => void;
  isLooping?: boolean;
  onToggleLoop?: () => void;
  onZoomChange?: (zoom: number) => void;
  onEditText?: (layerId: string, text: string) => void;
  onMediaDecodeError?: (name: string) => void;
  onBeginLayerEdit?: () => () => void;
  onLiveTransform?: (
    layerId: string,
    updates: Partial<EditorLayerProperties>,
    keyframeProperties?: AnimatedPropertyName[],
  ) => void;
  frameBlendingEnabled?: boolean;
  motionBlurEnabled?: boolean;
};

const VIEW_PADDING = 24;
const MIN_ZOOM = 25;
const MAX_ZOOM = 400;
const ZOOM_PRESETS = [25, 33, 50, 66, 100, 150, 200, 300, 400];

function clampValue(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function stepZoom(current: number, direction: 1 | -1): number {
  if (direction > 0) {
    return ZOOM_PRESETS.find((preset) => preset > current + 0.5) ?? MAX_ZOOM;
  }

  const lower = [...ZOOM_PRESETS]
    .reverse()
    .find((preset) => preset < current - 0.5);

  return lower ?? Math.min(current, MIN_ZOOM);
}

// Is the layer visible on the timeline at this time?
function isLayerActive(layer: EditorLayerProperties, time: number): boolean {
  const start = layer.startTime ?? 0;
  const inPoint = layer.inPoint ?? 0;
  const outPoint = layer.outPoint ?? Number.POSITIVE_INFINITY;
  const stretch = Math.max(0.01, layer.stretch ?? 100);
  const end = start + (Math.max(0, outPoint - inPoint) * stretch) / 100;

  return time >= start && time < end;
}

function formatTime(seconds: number, fps: number) {
  const safeTime = Math.max(0, seconds);
  const minutes = Math.floor(safeTime / 60);
  const remainingSeconds = Math.floor(safeTime % 60);
  const frames = Math.floor((safeTime % 1) * fps);

  return [
    String(minutes).padStart(2, '0'),
    String(remainingSeconds).padStart(2, '0'),
    String(frames).padStart(2, '0'),
  ].join(':');
}

export default function PreviewPanel({
  width = 1920,
  height = 1080,
  fps = 30,
  currentTime = 0,
  isPlaying = false,
  isMuted = false,
  zoom = 50,
  backgroundColor = '#000000',
  mediaUrls = {},
  missingMediaIds = [],
  masterMuted = false,
  activeTool = 'select',
  layers = [],
  animatedLayers,
  getCurrentTime,
  resolveLayers,
  selectedLayerId = null,
  onSelectLayer,
  onOpenContextMenu,
  onTogglePlayback,
  onStopPlayback,
  onToggleMute,
  isLooping = false,
  onToggleLoop,
  onZoomChange,
  onEditText,
  onMediaDecodeError,
  onBeginLayerEdit = () => () => {},
  onLiveTransform,
  frameBlendingEnabled = false,
  motionBlurEnabled = false,
}: PreviewPanelProps) {
  const [transparentGrid, setTransparentGrid] = useState(false);

  const [editingText, setEditingText] = useState<{
    id: string;
    value: string;
  } | null>(null);

  const [previewScale, setPreviewScale] = useState(1);

  const canvasRef = useRef<HTMLDivElement>(null);

  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);

  // Motion Studio se animated layers milne par unka use hoga.
  const previewLayers = useMemo(
    () => applyGroupInheritance(animatedLayers ?? layers),
    [animatedLayers, layers],
  );

  const soloActive = previewLayers.some(
    (layer) => layer.solo,
  );

  const matteSourceIds = new Set(
    previewLayers
      .filter(
        (layer) =>
          layer.trackMatte &&
          layer.trackMatte !== 'none',
      )
      .map((layer) => layer.matteSourceId)
      .filter((id): id is string => Boolean(id)),
  );

  // Centralized media and canvas renderer.
  const {
    compositeCanvasRef,
    videoPool,
  } = usePreviewRenderer({
    width: safeWidth,
    height: safeHeight,
    layers: previewLayers,
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
  });

  // Transform interactions are handled by a separate hook.
  // Rotation and scale of the layer a layer is linked to (null = no link).
  const getParentFrame = (layer: EditorLayerProperties) => {
    if (!layer.parentId && !layer.groupId) {
      return null;
    }

    const parent =
      previewLayers.find((item) => item.id === layer.parentId) ??
      previewLayers.find((item) => item.id === layer.groupId);

    if (!parent) {
      return null;
    }

    const parentWorld = getWorldTransform(
      parent,
      previewLayers,
      safeWidth,
      safeHeight,
    );

    return {
      rotation: parentWorld.rotation,
      scaleX: parentWorld.scaleX,
      scaleY: parentWorld.scaleY,
    };
  };

  // Guides, value bubble and pointer type are updated straight on the DOM.
  const overlayApiRef = useRef<PreviewOverlayApi | null>(null);

  const {
    beginLayerTransform,
    cancelActiveTransform,
  } = usePreviewTransform({
    canvasRef,
    safeWidth,
    safeHeight,
    activeTool,
    overlayApiRef,
    getParentFrame,
    onSelectLayer,
    onBeginLayerEdit,
    onLiveTransform,
  });

  // Keep preview scale synchronized with the visible canvas.
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const updateScale = () => {
      setPreviewScale(
        canvas.clientHeight / safeHeight,
      );
    };

    const observer = new ResizeObserver(updateScale);

    observer.observe(canvas);
    updateScale();

    return () => observer.disconnect();
  }, [safeHeight, safeWidth, zoom]);

  // ---- Viewer zoom, pan and navigator ----
  // zoom = real scale in percent (6..800). zoom <= 0 means "Fit".

  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const navBoxRef = useRef<HTMLDivElement>(null);
  const navCanvasRef = useRef<HTMLCanvasElement>(null);
  const navDraggingRef = useRef(false);

  const panRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);

  const zoomAnchorRef = useRef<{
    fx: number;
    fy: number;
    clientX: number;
    clientY: number;
  } | null>(null);

  const [stageSize, setStageSize] = useState({ width: 0, height: 0 });
  const [showNavigator, setShowNavigator] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const previewResolution = useSyncExternalStore(
    subscribePreviewResolution,
    getPreviewResolution,
  );
  const [spaceHeld, setSpaceHeld] = useState(false);

  const spaceHeldRef = useRef(false);
  const spacePannedRef = useRef(false);
  const hoverRef = useRef(false);
  const panMovedRef = useRef(false);
  const togglePlaybackRef = useRef(onTogglePlayback);

  const touchesRef = useRef(
    new Map<number, { x: number; y: number }>(),
  );

  const pinchRef = useRef<{
    distance: number;
    scale: number;
    midX: number;
    midY: number;
  } | null>(null);

  useEffect(() => {
    togglePlaybackRef.current = onTogglePlayback;
  });

  // Space + drag pans the view. A plain Space tap over the preview still
  // plays / pauses.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const element = target as HTMLElement | null;

      return Boolean(
        element &&
          (element.tagName === 'INPUT' ||
            element.tagName === 'TEXTAREA' ||
            element.tagName === 'SELECT' ||
            element.isContentEditable),
      );
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        !hoverRef.current ||
        isTyping(event.target)
      ) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation();

      if (event.repeat || spaceHeldRef.current) {
        return;
      }

      spaceHeldRef.current = true;
      spacePannedRef.current = false;
      setSpaceHeld(true);
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || !spaceHeldRef.current) {
        return;
      }

      spaceHeldRef.current = false;
      setSpaceHeld(false);

      if (!spacePannedRef.current) {
        togglePlaybackRef.current?.();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);

    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, []);

  const [viewRect, setViewRect] = useState({
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  });

  const fitScale =
    stageSize.width > 0 && stageSize.height > 0
      ? Math.max(
          0.02,
          Math.min(
            (stageSize.width - VIEW_PADDING * 2) / safeWidth,
            (stageSize.height - VIEW_PADDING * 2) / safeHeight,
          ),
        )
      : 0.25;

  const isFit = zoom <= 0;

  const viewScale = isFit
    ? fitScale
    : clampValue(zoom, MIN_ZOOM, MAX_ZOOM) / 100;

  const displayWidth = Math.max(1, Math.round(safeWidth * viewScale));
  const displayHeight = Math.max(1, Math.round(safeHeight * viewScale));
  const zoomLabel = String(Math.round(viewScale * 100)) + '%';

  const navScale = Math.min(160 / safeWidth, 120 / safeHeight);
  const navWidth = Math.max(16, Math.round(safeWidth * navScale));
  const navHeight = Math.max(16, Math.round(safeHeight * navScale));

  const changeZoom = useCallback(
    (
      nextZoom: number,
      anchor?: { clientX: number; clientY: number },
    ) => {
      // Manual zoom stays within 25% - 400% (Fit may be lower).
      if (nextZoom > 0 && nextZoom < MIN_ZOOM) {
        return;
      }

      const canvas = canvasRef.current;

      if (canvas && anchor) {
        const rect = canvas.getBoundingClientRect();

        if (rect.width > 0 && rect.height > 0) {
          zoomAnchorRef.current = {
            fx: (anchor.clientX - rect.left) / rect.width,
            fy: (anchor.clientY - rect.top) / rect.height,
            clientX: anchor.clientX,
            clientY: anchor.clientY,
          };
        }
      }

      onZoomChange?.(nextZoom);
    },
    [onZoomChange],
  );

  const viewScaleRef = useRef(viewScale);
  const changeZoomRef = useRef(changeZoom);

  useEffect(() => {
    viewScaleRef.current = viewScale;
    changeZoomRef.current = changeZoom;
  });

  // Visible stage size (used by Fit).
  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const update = () => {
      setStageSize({
        width: stage.clientWidth,
        height: stage.clientHeight,
      });
    };

    const observer = new ResizeObserver(update);

    observer.observe(stage);
    update();

    return () => observer.disconnect();
  }, []);

  // Ctrl + wheel zooms toward the mouse pointer. Plain wheel scrolls.
  useEffect(() => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      event.preventDefault();

      const current = viewScaleRef.current * 100;

      const raw = current * Math.exp(-event.deltaY * 0.0015);

      if (raw < MIN_ZOOM && current <= MIN_ZOOM + 0.5) {
        return;
      }

      const next = clampValue(raw, MIN_ZOOM, MAX_ZOOM);

      changeZoomRef.current(Math.round(next), {
        clientX: event.clientX,
        clientY: event.clientY,
      });
    };

    stage.addEventListener('wheel', onWheel, { passive: false });

    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  // Ctrl+0 = Fit, Ctrl+1 = 100%, Ctrl+= / Ctrl+- = zoom in / out.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey && !event.metaKey) {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      const current = viewScaleRef.current * 100;

      if (event.key === '0') {
        event.preventDefault();
        changeZoomRef.current(0);
      } else if (event.key === '1') {
        event.preventDefault();
        changeZoomRef.current(100);
      } else if (event.key === '=' || event.key === '+') {
        event.preventDefault();
        changeZoomRef.current(stepZoom(current, 1));
      } else if (event.key === '-') {
        event.preventDefault();
        changeZoomRef.current(stepZoom(current, -1));
      }
    };

    window.addEventListener('keydown', onKeyDown);

    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // After a zoom, keep the point under the mouse where it was.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;

    if (!anchor || !stage || !canvas) {
      return;
    }

    zoomAnchorRef.current = null;

    const rect = canvas.getBoundingClientRect();

    stage.scrollLeft += rect.left + anchor.fx * rect.width - anchor.clientX;
    stage.scrollTop += rect.top + anchor.fy * rect.height - anchor.clientY;
  }, [displayWidth, displayHeight]);

  // Navigator: which part of the composition is visible.
  const updateViewRect = useCallback(() => {
    if (!showNavigator) {
      return;
    }

    const stage = stageRef.current;
    const canvas = canvasRef.current;

    if (!stage || !canvas) {
      return;
    }

    const stageRect = stage.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();

    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return;
    }

    const left = Math.max(stageRect.left, canvasRect.left);
    const right = Math.min(stageRect.right, canvasRect.right);
    const top = Math.max(stageRect.top, canvasRect.top);
    const bottom = Math.min(stageRect.bottom, canvasRect.bottom);

    setViewRect({
      left: (left - canvasRect.left) / canvasRect.width,
      top: (top - canvasRect.top) / canvasRect.height,
      width: Math.max(0, (right - left) / canvasRect.width),
      height: Math.max(0, (bottom - top) / canvasRect.height),
    });
  }, [showNavigator]);

  useLayoutEffect(() => {
    updateViewRect();
  }, [updateViewRect, displayWidth, displayHeight, stageSize]);

  // Navigator thumbnail (copy of the composite canvas, ~8 times per second).
  useEffect(() => {
    if (!showNavigator) {
      return;
    }

    const draw = () => {
      const target = navCanvasRef.current;
      const source = compositeCanvasRef.current;

      if (!target || !source) {
        return;
      }

      const context = target.getContext('2d');

      if (!context) {
        return;
      }

      context.fillStyle = backgroundColor;
      context.fillRect(0, 0, target.width, target.height);

      try {
        context.drawImage(source, 0, 0, target.width, target.height);
      } catch {
        // Ignore: thumbnail is simply not refreshed this time.
      }
    };

    draw();

    const timer = window.setInterval(draw, 120);

    return () => window.clearInterval(timer);
  }, [showNavigator, backgroundColor, compositeCanvasRef]);

  // Pan: Hand tool (H) or middle mouse button.
  const handleStagePointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    const stage = stageRef.current;

    if (!stage) {
      return;
    }

    overlayApiRef.current?.setPointerType(event.pointerType);

    // Two fingers = pinch zoom (and pan). A drag that began is cancelled.
    if (event.pointerType === 'touch') {
      touchesRef.current.set(event.pointerId, {
        x: event.clientX,
        y: event.clientY,
      });

      if (touchesRef.current.size === 2) {
        cancelActiveTransform();

        const [first, second] = [...touchesRef.current.values()];

        pinchRef.current = {
          distance: Math.max(
            1,
            Math.hypot(first.x - second.x, first.y - second.y),
          ),
          scale: viewScaleRef.current * 100,
          midX: (first.x + second.x) / 2,
          midY: (first.y + second.y) / 2,
        };

        panMovedRef.current = true;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    }

    const wantsPan =
      event.button === 1 ||
      (event.button === 0 &&
        (activeTool === 'hand' || spaceHeldRef.current));

    if (!wantsPan) {
      return;
    }

    if (spaceHeldRef.current) {
      spacePannedRef.current = true;
    }

    event.preventDefault();
    event.stopPropagation();

    stage.setPointerCapture(event.pointerId);

    panRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: stage.scrollLeft,
      scrollTop: stage.scrollTop,
    };

    setIsPanning(true);
  };

  const handleStagePointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    overlayApiRef.current?.setPointerType(event.pointerType);
    reportPointer(event.clientX, event.clientY);

    const touch = touchesRef.current.get(event.pointerId);

    if (touch) {
      touch.x = event.clientX;
      touch.y = event.clientY;
    }

    const pinch = pinchRef.current;
    const pinchStage = stageRef.current;

    if (pinch && pinchStage && touchesRef.current.size >= 2) {
      const [first, second] = [...touchesRef.current.values()];

      const distance = Math.max(
        1,
        Math.hypot(first.x - second.x, first.y - second.y),
      );

      const midX = (first.x + second.x) / 2;
      const midY = (first.y + second.y) / 2;

      pinchStage.scrollLeft -= midX - pinch.midX;
      pinchStage.scrollTop -= midY - pinch.midY;
      pinch.midX = midX;
      pinch.midY = midY;

      const next = clampValue(
        pinch.scale * (distance / pinch.distance),
        MIN_ZOOM,
        MAX_ZOOM,
      );

      changeZoom(Math.round(next), { clientX: midX, clientY: midY });
      return;
    }

    const pan = panRef.current;
    const stage = stageRef.current;

    if (!pan || !stage || event.pointerId !== pan.pointerId) {
      return;
    }

    if (
      Math.abs(event.clientX - pan.startX) +
        Math.abs(event.clientY - pan.startY) >
      3
    ) {
      panMovedRef.current = true;
    }

    stage.scrollLeft = pan.scrollLeft - (event.clientX - pan.startX);
    stage.scrollTop = pan.scrollTop - (event.clientY - pan.startY);
  };

  const handleStagePointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    touchesRef.current.delete(event.pointerId);

    if (touchesRef.current.size < 2) {
      pinchRef.current = null;
    }

    const pan = panRef.current;
    const stage = stageRef.current;

    if (!pan || event.pointerId !== pan.pointerId) {
      return;
    }

    panRef.current = null;
    setIsPanning(false);

    if (stage && stage.hasPointerCapture(event.pointerId)) {
      stage.releasePointerCapture(event.pointerId);
    }
  };

  // Click on the empty background deselects (back to Root). Double-click
  // on the background around the composition = Fit.
  const isBackgroundTarget = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;

    return !element?.closest(
      '.preview-layer-interaction, .preview-handle, .preview-guide-line, .preview-navigator, .preview-zoom-badge, textarea',
    );
  };

  const handleStageClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (panMovedRef.current) {
      panMovedRef.current = false;
      return;
    }

    if (activeTool === 'hand' || spaceHeldRef.current) {
      return;
    }

    if (isBackgroundTarget(event.target)) {
      onSelectLayer?.(null);
    }
  };

  const handleStageDoubleClick = (
    event: React.MouseEvent<HTMLDivElement>,
  ) => {
    if (!isBackgroundTarget(event.target)) {
      return;
    }

    const insideComposition = (event.target as HTMLElement).closest(
      '.preview-canvas',
    );

    if (!insideComposition) {
      changeZoom(0);
    }
  };

  // Navigator interaction: click or drag to move the view.
  const moveViewToNavPoint = (clientX: number, clientY: number) => {
    const nav = navBoxRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;

    if (!nav || !stage || !canvas) {
      return;
    }

    const navRect = nav.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();

    if (navRect.width <= 0 || navRect.height <= 0) {
      return;
    }

    const fx = clampValue((clientX - navRect.left) / navRect.width, 0, 1);
    const fy = clampValue((clientY - navRect.top) / navRect.height, 0, 1);

    stage.scrollLeft +=
      canvasRect.left + fx * canvasRect.width -
      (stageRect.left + stageRect.width / 2);

    stage.scrollTop +=
      canvasRect.top + fy * canvasRect.height -
      (stageRect.top + stageRect.height / 2);
  };

  const handleNavPointerDown = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    navDraggingRef.current = true;
    moveViewToNavPoint(event.clientX, event.clientY);
  };

  const handleNavPointerMove = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (navDraggingRef.current) {
      moveViewToNavPoint(event.clientX, event.clientY);
    }
  };

  const handleNavPointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
  ) => {
    navDraggingRef.current = false;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  // Release media when the component unmounts.
  useEffect(() => {
    return () => {
      videoPool.releaseAll();
    };
  }, [videoPool]);

  const handleTextKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLTextAreaElement>,
      layerId: string,
    ) => {
      if (
        (
          event.key === 'Enter' &&
          (event.ctrlKey || event.metaKey)
        ) ||
        event.key === 'Escape'
      ) {
        event.preventDefault();

        if (event.key !== 'Escape') {
          onEditText?.(
            layerId,
            editingText?.value ?? '',
          );
        }

        setEditingText(null);
      }
    },
    [editingText, onEditText],
  );

  // The Info panel: where the pointer is in the composition and the colour
  // under it. Read at most once per frame; the colour is not read while
  // playing, so it can never slow playback down.
  const pointerFrameRef = useRef(0);

  const reportPointer = (clientX: number, clientY: number) => {
    if (pointerFrameRef.current) {
      return;
    }

    pointerFrameRef.current = requestAnimationFrame(() => {
      pointerFrameRef.current = 0;

      const frame = canvasRef.current;

      if (!frame) {
        return;
      }

      const bounds = frame.getBoundingClientRect();
      const x = Math.floor(((clientX - bounds.left) / bounds.width) * safeWidth);
      const y = Math.floor(((clientY - bounds.top) / bounds.height) * safeHeight);
      const inside = x >= 0 && y >= 0 && x < safeWidth && y < safeHeight;
      const source = frame.querySelector('canvas');
      const previous = getPointerInfo();

      let color: [number, number, number, number] | null = null;

      if (inside && source && !isPlaying) {
        color = readPixel(source, (x + 0.5) / safeWidth, (y + 0.5) / safeHeight);
      }

      setPointerInfo({
        x,
        y,
        inside,
        r: inside ? color?.[0] ?? previous?.r ?? 0 : 0,
        g: inside ? color?.[1] ?? previous?.g ?? 0 : 0,
        b: inside ? color?.[2] ?? previous?.b ?? 0 : 0,
        a: inside ? color?.[3] ?? previous?.a ?? 0 : 0,
      });
    });
  };

  // View aids: rulers, grid, guides, safe margins.
  const guides = useSyncExternalStore(subscribePreviewGuides, getPreviewGuides);
  const [viewMenu, setViewMenu] = useState<{ x: number; y: number } | null>(null);

  const viewMenuItems = (): ContextMenuItem[] => [
    {
      id: 'rulers',
      label: 'Show Rulers',
      checked: guides.rulers,
      onSelect: () => updatePreviewGuides({ rulers: !guides.rulers }),
    },
    {
      id: 'grid',
      label: 'Show Grid',
      checked: guides.grid,
      onSelect: () => updatePreviewGuides({ grid: !guides.grid }),
    },
    {
      id: 'safe',
      label: 'Show Safe Margins',
      checked: guides.safeMargins,
      onSelect: () => updatePreviewGuides({ safeMargins: !guides.safeMargins }),
    },
    { type: 'separator' },
    {
      id: 'snap-guides',
      label: 'Snap to Guides',
      checked: guides.snapGuides,
      onSelect: () => updatePreviewGuides({ snapGuides: !guides.snapGuides }),
    },
    {
      id: 'snap-grid',
      label: 'Snap to Grid',
      checked: guides.snapGrid,
      onSelect: () => updatePreviewGuides({ snapGrid: !guides.snapGrid }),
    },
    {
      id: 'lock-guides',
      label: 'Lock Guides',
      checked: guides.guidesLocked,
      onSelect: () => updatePreviewGuides({ guidesLocked: !guides.guidesLocked }),
    },
    {
      id: 'grid-size',
      label: 'Grid Size',
      children: GRID_SIZES.map((size) => ({
        id: 'grid-' + size,
        label: size + ' px',
        checked: guides.gridSize === size,
        onSelect: () => updatePreviewGuides({ gridSize: size }),
      })),
    },
    { type: 'separator' },
    {
      id: 'clear-guides',
      label: 'Clear Guides',
      disabled: guides.v.length + guides.h.length === 0,
      onSelect: () => clearGuides(),
    },
  ];

  // The selection overlay follows the selected, visible, active layer.
  const overlayLayer =
    previewLayers.find(
      (layer) =>
        layer.id === selectedLayerId &&
        layer.visible !== false &&
        layer.type !== 'audio' &&
        isLayerActive(layer, currentTime),
    ) ?? null;

  const overlayWorld = overlayLayer
    ? getWorldTransform(
        overlayLayer,
        previewLayers,
        safeWidth,
        safeHeight,
      )
    : null;

  const overlayStateRef = useRef<{
    layer: EditorLayerProperties | null;
    world: WorldTransform | null;
  }>({ layer: null, world: null });

  useEffect(() => {
    overlayStateRef.current = {
      layer: overlayLayer,
      world: overlayWorld,
    };
  });

  const handleOverlayPointerDown = useCallback(
    (event: React.PointerEvent<HTMLElement>) => {
      const { layer, world } = overlayStateRef.current;

      if (!layer || !world) {
        return;
      }

      beginLayerTransform(
        event,
        layer,
        world,
        layer.anchorX ?? layer.width / 2,
        layer.anchorY ?? layer.height / 2,
      );
    },
    [beginLayerTransform],
  );

  return (
    <section className="preview-panel" ref={panelRef}>
      <div className="panel-header">
        <div className="panel-title">
          <span className="status-dot" />
          <h3>Preview</h3>
        </div>

        <div className="preview-header-actions">
          <span className="preview-resolution">
            {width} × {height}
          </span>

          <button
            className="panel-icon-button"
            type="button"
            title="Preview settings"
            aria-label="Preview settings"
          >
            <MaterialIcon name="tune" size={17} />
          </button>

          <button
            className="panel-icon-button"
            type="button"
            title="Fullscreen"
            aria-label="Fullscreen"
          >
            <MaterialIcon name="fullscreen" size={17} />
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        className="preview-stage"
        style={{
          cursor:
            activeTool === 'hand' || spaceHeld
              ? isPanning
                ? 'grabbing'
                : 'grab'
              : undefined,
        }}
        onPointerEnter={() => {
          hoverRef.current = true;
        }}
        onPointerLeave={() => {
          hoverRef.current = false;
        }}
        onClick={handleStageClick}
        onDoubleClick={handleStageDoubleClick}
        onScroll={updateViewRect}
        onPointerDownCapture={handleStagePointerDown}
        onPointerMove={handleStagePointerMove}
        onPointerUp={handleStagePointerEnd}
        onPointerCancel={handleStagePointerEnd}
        onMouseDownCapture={(event) => {
          if (event.button === 1) {
            event.preventDefault();
          }
        }}
      >
        <div className="preview-canvas-holder">
        <div
          className="preview-canvas-frame"
          style={{
            position: 'relative',
            width: displayWidth,
            height: displayHeight,
            flex: 'none',
          }}
        >
        <div
          ref={canvasRef}
          className="preview-canvas"
          style={{
            width: displayWidth,
            height: displayHeight,
            flex: 'none',
            position: 'relative',
            overflow: 'hidden',
            perspective: '2000px',
            transformStyle: 'preserve-3d',
            containerType: 'size',
            background: transparentGrid
              ? 'conic-gradient(#292929 25%, #222 0 50%, #292929 0 75%, #222 0) 0 0 / 16px 16px'
              : backgroundColor,
          }}
        >
          <canvas
            ref={compositeCanvasRef}
            className="preview-composite"
            aria-hidden="true"
          />

          {previewLayers.length === 0 && (
            <div className="preview-placeholder">
              <h3>Empty Canvas</h3>
              <p>Select a tool to add a layer.</p>
            </div>
          )}

          {previewLayers.map((layer, layerIndex) => {
            const matteOnly = matteSourceIds.has(layer.id);

            if (
              (
                layer.visible === false ||
                (soloActive && !layer.solo)
              ) &&
              !matteOnly
            ) {
              return null;
            }

            const start = layer.startTime ?? 0;
            const inPoint = layer.inPoint ?? 0;

            const outPoint =
              layer.outPoint ?? Number.POSITIVE_INFINITY;

            const stretch = Math.max(
              0.01,
              layer.stretch ?? 100,
            );

            const duration = Math.max(
              0,
              outPoint - inPoint,
            );

            const timelineDuration =
              duration * stretch / 100;

            const end = start + timelineDuration;

            if (
              currentTime < start ||
              currentTime >= end
            ) {
              return null;
            }

            if (layer.type === 'audio') {
              return null;
            }

            const isSelected =
              layer.id === selectedLayerId;

            const world: WorldTransform =
              getWorldTransform(
                layer,
                previewLayers,
                safeWidth,
                safeHeight,
              );

            const scaleX = world.scaleX;
            const scaleY = world.scaleY;

            const anchorX =
              layer.anchorX ?? layer.width / 2;

            const anchorY =
              layer.anchorY ?? layer.height / 2;

            const textValue =
              layer.text ?? layer.name;

            const mediaUrl = layer.sourceId
              ? mediaUrls[layer.sourceId]
              : undefined;

            const isMissing =
              Boolean(layer.sourceId) &&
              (
                missingMediaIds.includes(
                  layer.sourceId ?? '',
                ) ||
                !mediaUrl
              );

            return (
              <div
                key={layer.id}
                className="preview-layer-interaction"
                role="button"
                tabIndex={0}
                aria-label={`Select ${layer.name}`}
                onClick={() => {
                  if (!layer.locked) {
                    onSelectLayer?.(layer.id);
                  }
                }}
                onDoubleClick={(event) => {
                  if (
                    layer.type !== 'text' ||
                    activeTool !== 'text'
                  ) {
                    return;
                  }

                  event.stopPropagation();

                  setEditingText({
                    id: layer.id,
                    value: textValue,
                  });
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelectLayer?.(layer.id);
                  onOpenContextMenu?.({
                    kind: 'layer',
                    x: event.clientX,
                    y: event.clientY,
                    layerId: layer.id,
                    ids: [layer.id],
                  });
                }}
                onPointerDown={(event) =>
                  beginLayerTransform(
                    event,
                    layer,
                    world,
                    anchorX,
                    anchorY,
                  )
                }
                onKeyDown={(event) => {
                  if (
                    !layer.locked &&
                    (
                      event.key === 'Enter' ||
                      event.key === ' '
                    )
                  ) {
                    event.preventDefault();
                    onSelectLayer?.(layer.id);
                  }
                }}
                style={{
                  position: 'absolute',

                  zIndex:
                    previewLayers.length - layerIndex,

                  left:
                    `${((world.x - anchorX) / safeWidth) * 100}%`,

                  top:
                    `${((world.y - anchorY) / safeHeight) * 100}%`,

                  width:
                    `${(layer.width / safeWidth) * 100}%`,

                  height:
                    `${(layer.height / safeHeight) * 100}%`,

                  opacity: matteOnly
                    ? 0
                    : layer.opacity / 100,

                  transform: layer.threeDLayer
                    ? `translateZ(${layer.z ?? 0}px) rotateX(${(layer.orientationX ?? 0) + (layer.rotationX ?? 0)}deg) rotateY(${(layer.orientationY ?? 0) + (layer.rotationY ?? 0)}deg) rotateZ(${world.rotation + (layer.orientationZ ?? 0)}deg) scale3d(${scaleX}, ${scaleY}, ${(layer.scaleZ ?? 100) / 100})`
                    : `rotate(${world.rotation + (layer.orientationZ ?? 0)}deg) scale(${scaleX}, ${scaleY})`,

                  transformStyle: 'preserve-3d',

                  transformOrigin:
                    `${(anchorX / Math.max(1, layer.width)) * 100}% ${(anchorY / Math.max(1, layer.height)) * 100}%`,

                  mixBlendMode:
                    getCssBlendMode(layer.blendMode) as React.CSSProperties['mixBlendMode'],

                  filter: [
                    motionBlurEnabled &&
                    isPlaying &&
                    layer.motionBlur
                      ? 'blur(0.6px)'
                      : '',

                    frameBlendingEnabled &&
                    isPlaying &&
                    layer.frameBlending
                      ? 'blur(0.2px)'
                      : '',
                  ]
                    .filter(Boolean)
                    .join(' ') || undefined,

                  boxSizing: 'border-box',

                  overflow:
                    isSelected || layer.type === 'text'
                      ? 'visible'
                      : 'hidden',

                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',

                  fontSize:
                    layer.type === 'text'
                      ? `${Math.max(48, safeHeight * 0.05) * previewScale}px`
                      : `${Math.max(12, (layer.height / safeHeight) * 70)}px`,

                  fontWeight: 700,
                  textAlign: 'center',

                  whiteSpace:
                    layer.type === 'text'
                      ? 'nowrap'
                      : 'normal',

                  cursor: layer.locked
                    ? 'not-allowed'
                    : activeTool === 'anchor'
                      ? 'crosshair'
                      : isSelected
                        ? 'move'
                        : 'pointer',

                  background: 'transparent',
                  color: 'transparent',

                  pointerEvents:
                    matteOnly || layer.locked
                      ? 'none'
                      : undefined,

                  border: 'none',
                  outline: 'none',
                }}
              >
                {isMissing ? (
                  <span>
                    Missing footage: {layer.name}
                  </span>
                ) : editingText?.id === layer.id ? (
                  <textarea
                    autoFocus
                    aria-label={`Edit ${layer.name}`}
                    value={editingText.value}
                    onChange={(event) =>
                      setEditingText({
                        id: layer.id,
                        value: event.target.value,
                      })
                    }
                    onKeyDown={(event) =>
                      handleTextKeyDown(event, layer.id)
                    }
                    style={{
                      width: '100%',
                      minHeight: '100%',
                      border: 0,
                      outline: 0,
                      resize: 'none',
                      background: 'transparent',
                      color: 'white',
                      font: 'inherit',
                      textAlign: 'center',
                    }}
                  />
                ) : layer.type === 'video' ||
                  layer.type === 'image' ? (
                  null
                ) : layer.type === 'shape' ? (
                  ''
                ) : layer.type === 'text' ? (
                  textValue
                ) : (
                  layer.name
                )}
              </div>
            );
          })}
        </div>

        <PreviewGuidesLayer
          compWidth={safeWidth}
          compHeight={safeHeight}
          viewScale={viewScale}
        />

        <PreviewOverlay
          layer={overlayLayer}
          world={overlayWorld}
          compWidth={safeWidth}
          compHeight={safeHeight}
          viewScale={viewScale}
          interactive={
            Boolean(overlayLayer) &&
            (activeTool === 'select' || activeTool === 'anchor') &&
            !overlayLayer?.locked
          }
          apiRef={overlayApiRef}
          onHandlePointerDown={handleOverlayPointerDown}
        />
        </div>
        </div>
      </div>

      {guides.rulers && (
        <PreviewRulers
          stageRef={stageRef}
          panelRef={panelRef}
          viewScale={viewScale}
          compWidth={safeWidth}
          compHeight={safeHeight}
        />
      )}

      {showNavigator && (
        <div
          ref={navBoxRef}
          className="preview-navigator"
          style={{
            width: navWidth,
            height: navHeight,
            boxSizing: 'content-box',
          }}
          title="Navigator: click or drag to move the view"
          onPointerDown={handleNavPointerDown}
          onPointerMove={handleNavPointerMove}
          onPointerUp={handleNavPointerEnd}
          onPointerCancel={handleNavPointerEnd}
        >
          <canvas
            ref={navCanvasRef}
            width={navWidth}
            height={navHeight}
          />

          <div
            className="preview-navigator-view"
            style={{
              left: viewRect.left * 100 + '%',
              top: viewRect.top * 100 + '%',
              width: viewRect.width * 100 + '%',
              height: viewRect.height * 100 + '%',
            }}
          />
        </div>
      )}

      <button
        type="button"
        className="preview-zoom-badge"
        title="Zoom (click for Fit)"
        aria-label={'Zoom ' + zoomLabel + ', click for Fit'}
        onClick={() => changeZoom(0)}
      >
        {zoomLabel}
      </button>

      {viewMenu && (
        <ContextMenu
          key={viewMenu.x + ':' + viewMenu.y}
          x={viewMenu.x}
          y={viewMenu.y}
          items={viewMenuItems()}
          onClose={() => setViewMenu(null)}
        />
      )}

      <div className="preview-controls">
        <div className="preview-playback">
          <button
            className="preview-control-button"
            type="button"
            title={
              isMuted
                ? 'Unmute audio'
                : 'Mute audio'
            }
            aria-label={
              isMuted
                ? 'Unmute audio'
                : 'Mute audio'
            }
            aria-pressed={isMuted}
            onClick={onToggleMute}
          >
            <MaterialIcon
              name={
                isMuted
                  ? 'volume_off'
                  : 'volume_up'
              }
              size={14}
            />
          </button>

          <button
            className={`preview-control-button preview-play-button ${isPlaying ? 'is-active' : ''}`}
            type="button"
            onClick={onTogglePlayback}
            title={isPlaying ? 'Pause' : 'Play'}
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            <MaterialIcon
              name={
                isPlaying
                  ? 'pause'
                  : 'play_arrow'
              }
              size={14}
            />
          </button>

          <button
            className="preview-control-button"
            type="button"
            title="Stop"
            aria-label="Stop"
            onClick={onStopPlayback}
          >
            <MaterialIcon name="stop" size={14} />
          </button>

          <button
            className={'preview-control-button' + (isLooping ? ' is-active' : '')}
            type="button"
            title={isLooping ? 'Loop is on: playback repeats' : 'Loop is off: playback stops at the end'}
            aria-label="Loop playback"
            aria-pressed={isLooping}
            onClick={onToggleLoop}
          >
            <MaterialIcon name="repeat" size={14} />
          </button>

          <span className="preview-time">
            {formatTime(currentTime, fps)}
          </span>
        </div>

        <div className="preview-zoom">
          <button
            className={`preview-control-button ${transparentGrid ? 'is-active' : ''}`}
            type="button"
            title={
              transparentGrid
                ? 'Show composition background'
                : 'Toggle transparency grid'
            }
            aria-label="Toggle transparency grid"
            aria-pressed={transparentGrid}
            onClick={() =>
              setTransparentGrid((value) => !value)
            }
          >
            <MaterialIcon name="grid_on" size={14} />
          </button>

          <button
            className={`preview-control-button ${showNavigator ? 'is-active' : ''}`}
            type="button"
            title="Navigator (mini map)"
            aria-label="Toggle navigator"
            aria-pressed={showNavigator}
            onClick={() => setShowNavigator((value) => !value)}
          >
            <MaterialIcon name="map" size={14} />
          </button>

          <button
            className="preview-control-button"
            type="button"
            title="Zoom out (Ctrl + -)"
            aria-label="Zoom out"
            onClick={() => changeZoom(stepZoom(viewScale * 100, -1))}
          >
            <MaterialIcon name="zoom_out" size={14} />
          </button>

          <button
            className="preview-control-button preview-zoom-label"
            type="button"
            title="Click: Fit / 100%   (Ctrl+0 = Fit, Ctrl+1 = 100%)"
            aria-label="Fit or 100 percent"
            onClick={() => changeZoom(isFit ? 100 : 0)}
          >
            {isFit ? 'Fit ' + zoomLabel : zoomLabel}
          </button>

          <button
            className="preview-control-button"
            type="button"
            title="Zoom in (Ctrl + =)"
            aria-label="Zoom in"
            onClick={() => changeZoom(stepZoom(viewScale * 100, 1))}
          >
            <MaterialIcon name="zoom_in" size={14} />
          </button>

          <button
            className={'preview-control-button' + (guides.rulers || guides.grid || guides.safeMargins ? ' is-active' : '')}
            type="button"
            title="View options: rulers, grid, guides, safe margins"
            aria-label="View options"
            aria-haspopup="menu"
            onClick={(event) => {
              const bounds = event.currentTarget.getBoundingClientRect();
              setViewMenu({ x: bounds.left, y: bounds.top });
            }}
          >
            <MaterialIcon name="straighten" size={14} />
          </button>

          <select
            className="preview-resolution-select"
            title="Preview resolution (only the preview, not the project)"
            aria-label="Preview resolution"
            value={previewResolution}
            onChange={(event) =>
              setPreviewResolution(event.currentTarget.value as PreviewResolution)
            }
          >
            {PREVIEW_RESOLUTIONS.map((item) => (
              <option value={item.value} key={item.value}>
                {item.label}
              </option>
            ))}
          </select>

          <span className="preview-fps">
            {fps} FPS
          </span>

          <span className="preview-render-time" title="Frame render time">
            <RenderTimeLabel />
          </span>
        </div>
      </div>
    </section>
  );
}