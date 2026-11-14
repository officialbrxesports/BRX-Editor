import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, KeyboardEvent, MouseEvent, PointerEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  Lock,
  Volume2,
} from 'lucide-react';

import type {
  AnimatedPropertyName,
  BlendMode,
  EditorLayerProperties,
  Keyframe,
  LayerAnimation,
  TrackMatteMode,
} from '../../project/project.types';
import { getProperties } from './TimelinePropertyData';
import { PropertyRows } from './TimelineProperties';
import LinkToPicker from './LinkToPicker';
import './TimelineGroups.css';
import type { MenuRequest } from '../WorkspaceMenus';

type TimelineRowsProps = {
  layers: EditorLayerProperties[];
  animations: LayerAnimation[];
  onCreateLayer: (type: EditorLayerProperties['type']) => void;
  selectedLayerId: string | null;
  currentTime: number;
  duration: number;
  pixelsPerSecond: number;
  zoom?: number;
  onZoomChange?: (zoom: number) => void;
  fps: number;
  snapping: boolean;
  onSelectLayer: (layerId: string | null) => void;
  onOpenContextMenu?: (request: MenuRequest) => void;
  onBeginLayerEdit: () => () => void;
  onUpdateLayers: (
    updates: Record<string, Partial<EditorLayerProperties>>,
    order?: string[],
    options?: { keyframeProperties?: AnimatedPropertyName[]; time?: number },
  ) => void;
  onAddKeyframe: (
    layerId: string,
    propertyName: AnimatedPropertyName,
    value: number,
    time?: number,
    interpolation?: Keyframe['interpolation'],
    recordHistory?: boolean,
  ) => void;
  onUpdateKeyframe: (
    layerId: string,
    propertyName: AnimatedPropertyName,
    keyframeId: string,
    updates: Partial<Pick<Keyframe, 'time' | 'value' | 'interpolation'>>,
    recordHistory?: boolean,
  ) => void;
  onDeleteKeyframe: (
    layerId: string,
    propertyName: AnimatedPropertyName,
    keyframeId: string,
    recordHistory?: boolean,
  ) => void;
  onSeekTime: (time: number) => void;
  onDeleteLayers: (layerIds: string[]) => void;
  onDuplicateLayers: (layerIds: string[]) => void;
  onGroupLayers: (layerIds: string[]) => void;
  onUngroupLayers: (layerIds: string[]) => void;
  onSplitLayers: (layerIds: string[], time: number) => void;
  onScrollLeft: (scrollLeft: number) => void;
  missingMediaIds?: string[];
  onToggleVisibility?: (layerId: string) => void;
  onToggleAudio?: (layerId: string) => void;
  onToggleSolo?: (layerId: string) => void;
  sourceNameMode?: 'source' | 'layer';
  sourceNames?: Record<string, string>;
  sourceThumbnails?: Record<string, string>;
  hideShy?: boolean;
  visibleExtraColumns?: string[];
  onToggleModes?: () => void;
};

type TimelineKeyframeSelection = {
  layerId: string;
  propertyName: AnimatedPropertyName;
  keyframeId: string;
};

type TimelineKeyframeDrag = {
  pointerId: number;
  element: HTMLElement;
  startX: number;
  startTimes: Array<TimelineKeyframeSelection & { time: number }>;
  cancelEdit: (() => void) | null;
  changed: boolean;
  stretch: boolean;
};

const blendModeGroups: { label: string; modes: { value: BlendMode; label: string }[] }[] = [
  { label: 'Normal', modes: [{ value: 'normal', label: 'Normal' }, { value: 'dissolve', label: 'Dissolve' }] },
  { label: 'Darken', modes: [
    { value: 'darken', label: 'Darken' }, { value: 'multiply', label: 'Multiply' },
    { value: 'color-burn', label: 'Color Burn' }, { value: 'linear-burn', label: 'Linear Burn' },
  ] },
  { label: 'Lighten', modes: [
    { value: 'lighten', label: 'Lighten' }, { value: 'screen', label: 'Screen' },
    { value: 'color-dodge', label: 'Color Dodge' }, { value: 'linear-dodge', label: 'Linear Dodge (Add)' },
  ] },
  { label: 'Contrast', modes: [
    { value: 'overlay', label: 'Overlay' }, { value: 'soft-light', label: 'Soft Light' },
    { value: 'hard-light', label: 'Hard Light' }, { value: 'vivid-light', label: 'Vivid Light' },
    { value: 'linear-light', label: 'Linear Light' }, { value: 'pin-light', label: 'Pin Light' },
  ] },
  { label: 'Difference', modes: [
    { value: 'difference', label: 'Difference' }, { value: 'exclusion', label: 'Exclusion' },
  ] },
  { label: 'HSL', modes: [
    { value: 'hue', label: 'Hue' }, { value: 'saturation', label: 'Saturation' },
    { value: 'color', label: 'Color' }, { value: 'luminosity', label: 'Luminosity' },
  ] },
];

const trackMatteOptions: { value: TrackMatteMode; label: string }[] = [
  { value: 'none', label: 'No Track Matte' },
  { value: 'alpha', label: 'Alpha Matte' },
  { value: 'alpha-inverted', label: 'Alpha Inverted Matte' },
  { value: 'luma', label: 'Luma Matte' },
  { value: 'luma-inverted', label: 'Luma Inverted Matte' },
];

const approximateBlendModes = new Set<BlendMode>([
  'dissolve',
  'linear-burn',
  'vivid-light',
  'linear-light',
  'pin-light',
]);

const switchFields = [
  ['shy', 'Shy', '◉'],
  ['collapseTransformations', 'Collapse Transformations', '☼'],
  ['quality', 'Quality', '╱'],
  ['effectsEnabled', 'Effects enabled', 'fx'],
  ['frameBlending', 'Frame Blending', '▧'],
  ['motionBlur', 'Motion Blur', '◌'],
  ['adjustmentLayer', 'Adjustment Layer', '◩'],
  ['threeDLayer', '3D Layer', '3D'],
] as const;

const labelColors = [
  'label-none',
  'label-red',
  'label-yellow',
  'label-aqua',
  'label-pink',
  'label-lavender',
  'label-peach',
  'label-seafoam',
  'label-blue',
  'label-green',
  'label-purple',
  'label-orange',
  'label-brown',
  'label-fuchsia',
  'label-cyan',
  'label-sandstone',
  'label-darkgreen',
];

const defaultLabelByType: Record<EditorLayerProperties['type'], number> = {
  footage: 3,
  video: 3,
  image: 3,
  audio: 3,
  solid: 1,
  text: 10,
  shape: 8,
  null: 9,
  camera: 4,
  light: 6,
  adjustment: 1,
  precomp: 16,
};

function getLayerLabelClass(layer: EditorLayerProperties) {
  const index = layer.labelColor ?? defaultLabelByType[layer.type];
  return labelColors[index] ?? labelColors[defaultLabelByType[layer.type]];
}

function LayerTypeIcon({ type }: { type: EditorLayerProperties['type'] }) {
  if (type === 'text') return <b className="tl-type-glyph">T</b>;
  if (type === 'shape') return <b className="tl-type-glyph">✦</b>;
  if (type === 'audio') return <Volume2 size={11} />;
  if (type === 'image') return <span className="tl-type-glyph">▧</span>;
  return <span className="tl-type-glyph">▣</span>;
}

function getLayerStart(layer: EditorLayerProperties) {
  return layer.startTime ?? layer.inPoint ?? 0;
}

function getLayerDuration(layer: EditorLayerProperties, duration: number) {
  const inPoint = layer.inPoint ?? 0;
  const outPoint = layer.outPoint ?? duration;
  return Math.max(0, outPoint - inPoint);
}

export default function TimelineRows({
  layers,
  animations,
  onCreateLayer,
  selectedLayerId,
  currentTime,
  duration,
  pixelsPerSecond,
  zoom = 100,
  onZoomChange,
  fps,
  snapping,
  onSelectLayer,
  onOpenContextMenu,
  onBeginLayerEdit,
  onUpdateLayers,
  onAddKeyframe,
  onUpdateKeyframe,
  onDeleteKeyframe,
  onSeekTime,
  onDeleteLayers,
  onDuplicateLayers,
  onGroupLayers,
  onUngroupLayers,
  onSplitLayers,
  onScrollLeft,
  missingMediaIds = [],
  onToggleVisibility,
  onToggleAudio,
  onToggleSolo,
  sourceNameMode = 'source',
  sourceNames = {},
  sourceThumbnails = {},
  hideShy = false,
  visibleExtraColumns = [],
  onToggleModes,
}: TimelineRowsProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLDivElement>(null);
  const layerBarRef = useRef<{
    pointerId: number;
    captureElement: HTMLElement;
    layerId: string;
    mode: 'move' | 'trim-in' | 'trim-out' | 'slip';
    startX: number;
    startY: number;
    startScrollLeft: number;
    initialLayers: EditorLayerProperties[];
    selectedIds: string[];
    changed: boolean;
    cancelEdit: (() => void) | null;
    insertionOrder: string[] | null;
    axis: 'x' | 'y' | null;
  } | null>(null);
  const selectedIdsRef = useRef<string[]>(selectedLayerId ? [selectedLayerId] : []);
  const [, setSelectionVersion] = useState(0);
  const lastSelectedRef = useRef<string | null>(selectedLayerId);
  const flipTopsRef = useRef<Map<string, number> | null>(null);
  const zoomAnchorRef = useRef<{ time: number; offsetX: number } | null>(null);
  const callbacksRef = useRef({ onBeginLayerEdit, onUpdateLayers, onSelectLayer });
  callbacksRef.current = { onBeginLayerEdit, onUpdateLayers, onSelectLayer };
  const [dragTooltip, setDragTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [insertionLine, setInsertionLine] = useState<number | null>(null);
  const [marquee, setMarquee] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layerId?: string } | null>(null);
  const [selectedKeyframes, setSelectedKeyframes] = useState<TimelineKeyframeSelection[]>([]);
  const selectedKeyframesRef = useRef(selectedKeyframes);
  selectedKeyframesRef.current = selectedKeyframes;
  const keyframeClipboardRef = useRef<Array<{
    layerId: string;
    propertyName: AnimatedPropertyName;
    keyframe: Keyframe;
  }>>([]);
  const keyframeDragRef = useRef<TimelineKeyframeDrag | null>(null);
  const [keyframeContextMenu, setKeyframeContextMenu] = useState<{
    x: number;
    y: number;
    target: TimelineKeyframeSelection;
  } | null>(null);
  const parentPickRef = useRef<{ childId: string; x: number; y: number } | null>(null);
  const [parentPickChild, setParentPickChild] = useState<string | null>(null);
  const animationMap = new Map(
    animations.map((animation) => [animation.layerId, animation]),
  );
  const displayLayers = hideShy ? layers.filter((layer) => !layer.shy) : layers;
  const matteSourceLayerIds = new Set(
    layers.map((layer) => layer.matteSourceId).filter((id): id is string => Boolean(id)),
  );
  const handleListScroll = () => {
    const scrollTop = listRef.current?.scrollTop ?? 0;
    if (timeRef.current && timeRef.current.scrollTop !== scrollTop) {
      timeRef.current.scrollTop = scrollTop;
    }
  };
  const handleTimeScroll = () => {
    if (!timeRef.current) return;
    const { scrollLeft, scrollTop } = timeRef.current;
    onScrollLeft(scrollLeft);
    if (listRef.current && listRef.current.scrollTop !== scrollTop) {
      listRef.current.scrollTop = scrollTop;
    }
  };
  const activateLayer = (
    event: KeyboardEvent<HTMLDivElement>,
    layerId: string,
  ) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectLayer(layerId);
    }
  };
  const openNewLayerMenu = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    setContextMenu({
      x: event.clientX,
      y: event.clientY,
    });
  };
  const createLayer = (type: EditorLayerProperties['type']) => {
    setContextMenu(null);
    onCreateLayer(type);
  };
  const commitLayerPatch = (layerId: string, patch: Partial<EditorLayerProperties>) => {
    onBeginLayerEdit();
    onUpdateLayers({ [layerId]: patch });
  };
  const wouldCreateParentCycle = (childId: string, parentId: string | null) => {
    let cursor = parentId;
    const visited = new Set<string>();
    while (cursor && !visited.has(cursor)) {
      if (cursor === childId) return true;
      visited.add(cursor);
      cursor = layers.find((item) => item.id === cursor)?.parentId ?? null;
    }
    return false;
  };
  const setParent = (child: EditorLayerProperties, parentId: string | null) => {
    if (child.locked || wouldCreateParentCycle(child.id, parentId)) return;
    commitLayerPatch(child.id, { parentId });
    setParentPickChild(null);
    parentPickRef.current = null;
  };
  const setTrackMatte = (
    layer: EditorLayerProperties,
    mode: TrackMatteMode,
    source: EditorLayerProperties | undefined,
  ) => {
    if (layer.locked) return;
    const updates: Record<string, Partial<EditorLayerProperties>> = {};
    const oldSource = layer.matteSourceId
      ? layers.find((item) => item.id === layer.matteSourceId)
      : undefined;
    if (oldSource && oldSource.id !== source?.id && layer.matteSourceWasVisible) {
      updates[oldSource.id] = { visible: true };
    }
    if (mode === 'none') {
      if (oldSource && layer.matteSourceWasVisible) updates[oldSource.id] = { visible: true };
      updates[layer.id] = { trackMatte: 'none', matteSourceId: null, matteSourceWasVisible: true };
    } else if (source) {
      updates[source.id] = { ...(updates[source.id] ?? {}), visible: false };
      updates[layer.id] = {
        trackMatte: mode,
        matteSourceId: source.id,
        matteSourceWasVisible: oldSource?.id === source.id
          ? layer.matteSourceWasVisible
          : source.visible !== false,
      };
    } else {
      return;
    }
    onBeginLayerEdit();
    onUpdateLayers(updates);
  };
  const commitRename = () => {
    if (!renaming) return;
    const layer = layers.find((item) => item.id === renaming.id);
    const name = renaming.value.trim();
    if (layer && name && name !== layer.name) {
      onBeginLayerEdit();
      onUpdateLayers({ [layer.id]: { name } });
    }
    setRenaming(null);
  };

  useEffect(() => {
    if (selectedLayerId && !selectedIdsRef.current.includes(selectedLayerId)) {
      selectedIdsRef.current = [selectedLayerId];
    }
  }, [selectedLayerId]);

  useEffect(() => () => {
    layerBarRef.current?.cancelEdit?.();
    keyframeDragRef.current?.cancelEdit?.();
  }, []);

  useEffect(() => {
    const onPickwhipUp = (event: globalThis.PointerEvent) => {
      const pick = parentPickRef.current;
      if (!pick) return;
      const childId = pick.childId;
      if (Math.hypot(event.clientX - pick.x, event.clientY - pick.y) < 3) {
        parentPickRef.current = null;
        setParentPickChild(null);
        return;
      }
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-layer-id]');
      const parentId = target?.dataset.layerId ?? null;
      const child = layers.find((item) => item.id === childId);
      if (child && (!parentId || !wouldCreateParentCycle(childId, parentId))) setParent(child, parentId);
      else {
        parentPickRef.current = null;
        setParentPickChild(null);
      }
    };
    window.addEventListener('pointerup', onPickwhipUp);
    return () => window.removeEventListener('pointerup', onPickwhipUp);
  }, [layers]);

  // Ctrl / Cmd + click toggles a layer. Shift + click selects the range from
  // the last selected layer to this one. A plain click selects just this layer.
  const selectWithModifiers = (layerId: string, shift: boolean, toggle: boolean) => {
    const ids = layers.map((item) => item.id);
    const anchor = lastSelectedRef.current;
    let next: string[];

    if (shift && anchor && ids.includes(anchor)) {
      const from = ids.indexOf(anchor);
      const to = ids.indexOf(layerId);
      const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
      next = toggle
        ? Array.from(new Set([...selectedIdsRef.current, ...range]))
        : range;
    } else if (toggle || shift) {
      next = selectedIdsRef.current.includes(layerId)
        ? selectedIdsRef.current.filter((id) => id !== layerId)
        : [...selectedIdsRef.current, layerId];
      lastSelectedRef.current = layerId;
    } else {
      next = [layerId];
      lastSelectedRef.current = layerId;
    }

    selectedIdsRef.current = next;
    setSelectionVersion((version) => version + 1);
  };

  // Remember where the lanes are now, so they can slide to the new order.
  const rememberLanePositions = () => {
    const tops = new Map<string, number>();

    timeRef.current
      ?.querySelectorAll<HTMLElement>('.tl-track-layer-row')
      .forEach((row) => {
        const id = row.dataset.layerId;
        if (id) tops.set(id, row.getBoundingClientRect().top);
      });

    flipTopsRef.current = tops;
  };

  const beginLayerBarDrag = (
    event: PointerEvent<HTMLSpanElement>,
    layer: EditorLayerProperties,
  ) => {
    if (layer.locked) return;
    event.preventDefault();
    event.stopPropagation();
    timeRef.current?.focus();
    const target = event.target as HTMLElement;
    if (
      (event.ctrlKey || event.metaKey || event.shiftKey) &&
      !target.dataset.edge
    ) {
      selectWithModifiers(layer.id, event.shiftKey, event.ctrlKey || event.metaKey);
      const picked = selectedIdsRef.current;
      if (picked.length > 0) {
        callbacksRef.current.onSelectLayer(
          picked.includes(layer.id) ? layer.id : picked[picked.length - 1],
        );
      }
      return;
    }
    const mode = target.dataset.edge === 'left'
      ? 'trim-in'
      : target.dataset.edge === 'right'
        ? 'trim-out'
        : event.altKey
          ? 'slip'
          : 'move';
    const selectedIds = (selectedIdsRef.current.includes(layer.id)
      ? selectedIdsRef.current
      : [layer.id]).filter((id) =>
        !layers.find((candidate) => candidate.id === id)?.locked,
      );
    selectedIdsRef.current = selectedIds;
    lastSelectedRef.current = layer.id;
    setSelectionVersion((version) => version + 1);
    callbacksRef.current.onSelectLayer(layer.id);
    const captureElement = target.dataset.edge ? target : event.currentTarget;
    captureElement.setPointerCapture(event.pointerId);
    layerBarRef.current = {
      pointerId: event.pointerId,
      captureElement,
      layerId: layer.id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: timeRef.current?.scrollLeft ?? 0,
      initialLayers: structuredClone(layers),
      selectedIds,
      changed: false,
      cancelEdit: null,
      insertionOrder: null,
      axis: null,
    };

    const onMove = (nativeEvent: globalThis.PointerEvent) => {
      const drag = layerBarRef.current;
      if (!drag || nativeEvent.pointerId !== drag.pointerId) return;
      // The drag locks to its dominant axis after 6px: sideways changes the
      // time, up and down reorders the layers (move only; trims stay sideways).
      if (!drag.axis) {
        const movedX = Math.abs(nativeEvent.clientX - drag.startX);
        const movedY = Math.abs(nativeEvent.clientY - drag.startY);
        if (Math.max(movedX, movedY) < 6) return;
        drag.axis = movedY > movedX && drag.mode === 'move' ? 'y' : 'x';
      }
      const pixelsPerFrame = pixelsPerSecond / Math.max(1, fps);
      const currentScrollLeft = timeRef.current?.scrollLeft ?? 0;
      const frameDelta = drag.axis === 'y'
        ? 0
        : Math.round(
            ((nativeEvent.clientX + currentScrollLeft) -
              (drag.startX + drag.startScrollLeft)) / pixelsPerFrame,
          );
      const selectedLayers = drag.initialLayers.filter((item) => drag.selectedIds.includes(item.id));
      const primary = drag.initialLayers.find((item) => item.id === drag.layerId);
      if (!primary) return;

      const rowElements = Array.from(
        timeRef.current?.querySelectorAll<HTMLElement>('.tl-track-layer-row') ?? [],
      );
      if (drag.axis === 'y' && rowElements.length > 1) {
        const rowBounds = rowElements.map((row) => row.getBoundingClientRect());
        const targetIndex = rowBounds.findIndex((bounds) =>
          nativeEvent.clientY < bounds.top + bounds.height / 2,
        );
        const insertionIndex = targetIndex < 0 ? rowBounds.length : targetIndex;
        const markerTop = targetIndex < 0
          ? rowBounds[rowBounds.length - 1].bottom
          : rowBounds[targetIndex].top;
        setInsertionLine(markerTop);
        const dragged = drag.initialLayers.filter((item) => drag.selectedIds.includes(item.id));
        const remaining = drag.initialLayers.filter((item) => !drag.selectedIds.includes(item.id));
        const beforeCount = rowBounds
          .slice(0, insertionIndex)
          .filter((_, index) => !drag.selectedIds.includes(drag.initialLayers[index]?.id)).length;
        remaining.splice(Math.min(beforeCount, remaining.length), 0, ...dragged);
        drag.insertionOrder = remaining.map((item) => item.id);
      } else {
        setInsertionLine(null);
        drag.insertionOrder = null;
      }

      if (frameDelta === 0 && !drag.insertionOrder) return;
      if (!drag.cancelEdit) drag.cancelEdit = callbacksRef.current.onBeginLayerEdit();
      drag.changed = true;
      const snapEnabled = snapping || nativeEvent.shiftKey;
      const snapTargets = [
        currentTime,
        0,
        duration,
        ...drag.initialLayers
          .filter((item) => !drag.selectedIds.includes(item.id))
          .flatMap((item) => [
            item.startTime ?? 0,
            (item.startTime ?? 0) + (item.outPoint ?? duration) - (item.inPoint ?? 0),
          ]),
      ];
      const snapSeconds = (seconds: number) => {
        if (!snapEnabled) return seconds;
        const threshold = 8 / pixelsPerSecond;
        const target = snapTargets
          .filter((candidate) => Math.abs(candidate - seconds) <= threshold)
          .sort((a, b) => Math.abs(a - seconds) - Math.abs(b - seconds))[0];
        if (target !== undefined) return Math.round(target * fps) / fps;
        const eightPixelGrid = Math.round(seconds * pixelsPerSecond / 8) * 8 / pixelsPerSecond;
        return Math.abs(eightPixelGrid - seconds) <= threshold
          ? Math.round(eightPixelGrid * fps) / fps
          : seconds;
      };
      const moveDelta = frameDelta / Math.max(1, fps);
      const primaryStart = primary.startTime ?? 0;
      const groupMoveAdjustment = drag.mode === 'move'
        ? snapSeconds(Math.max(0, primaryStart + moveDelta)) - Math.max(0, primaryStart + moveDelta)
        : 0;
      const updates: Record<string, Partial<EditorLayerProperties>> = {};
      for (const item of selectedLayers) {
        if (item.locked) continue;
        const deltaSeconds = frameDelta / Math.max(1, fps);
        if (drag.mode === 'trim-in' && item.id === drag.layerId) {
          const nextStart = Math.max(0, (item.startTime ?? 0) + deltaSeconds);
          const nextIn = Math.max(0, (item.inPoint ?? 0) + deltaSeconds);
          const snappedStart = snapSeconds(nextStart);
          const adjustment = snappedStart - nextStart;
          updates[item.id] = {
            startTime: Math.min(snappedStart, (item.startTime ?? 0) + (item.outPoint ?? duration) - (item.inPoint ?? 0)),
            inPoint: Math.max(0, nextIn + adjustment),
          };
        } else if (drag.mode === 'trim-out' && item.id === drag.layerId) {
          const nextOut = Math.max((item.inPoint ?? 0) + 1 / fps, (item.outPoint ?? duration) + deltaSeconds);
          updates[item.id] = { outPoint: snapSeconds(nextOut) };
        } else if (drag.mode === 'slip' && item.id === drag.layerId) {
          const inPoint = Math.max(0, (item.inPoint ?? 0) + deltaSeconds);
          updates[item.id] = { inPoint, outPoint: Math.max(inPoint + 1 / fps, (item.outPoint ?? duration) + deltaSeconds) };
                } else {
          // MOVE: Change timeline position only.
          // Keep source In/Out points unchanged so no footage is trimmed.
          const startTime = Math.max(0, (item.startTime ?? 0) + deltaSeconds);
          const snappedStart = Math.max(
            0,
            startTime + groupMoveAdjustment,
          );

          updates[item.id] = {
            startTime: snappedStart,
          };
        }
      }
      callbacksRef.current.onUpdateLayers(updates);
      const preview = updates[drag.layerId] ?? primary;
      const inPoint = preview.inPoint ?? primary.inPoint ?? 0;
      const outPoint = preview.outPoint ?? primary.outPoint ?? duration;
      const deltaFrames = Math.round(frameDelta);
      setDragTooltip({
        x: nativeEvent.clientX + 12,
        y: nativeEvent.clientY + 12,
        text: `In ${Math.round(inPoint * fps)} / Out ${Math.round(outPoint * fps)} / Dur ${Math.round((outPoint - inPoint) * fps)} / Δ ${deltaFrames >= 0 ? '+' : ''}${deltaFrames}f`,
      });
    };
    const finish = (nativeEvent: globalThis.PointerEvent, cancel: boolean) => {
      const drag = layerBarRef.current;
      if (!drag || nativeEvent.pointerId !== drag.pointerId) return;
      if (cancel) {
        drag.cancelEdit?.();
      } else if (drag.changed && drag.insertionOrder) {
        rememberLanePositions();
        callbacksRef.current.onUpdateLayers({}, drag.insertionOrder);
      }
      if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
        drag.captureElement.releasePointerCapture(drag.pointerId);
      }
      layerBarRef.current = null;
      setDragTooltip(null);
      setInsertionLine(null);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown);
    };
    const onUp = (nativeEvent: globalThis.PointerEvent) => finish(nativeEvent, false);
    const onCancel = (nativeEvent: globalThis.PointerEvent) => finish(nativeEvent, true);
    const onKeyDown = (nativeEvent: globalThis.KeyboardEvent) => {
      if (nativeEvent.key === 'Escape' && layerBarRef.current) {
        nativeEvent.preventDefault();
        const drag = layerBarRef.current;
        if (!drag) return;
        drag.cancelEdit?.();
        if (drag.captureElement.hasPointerCapture(drag.pointerId)) {
          drag.captureElement.releasePointerCapture(drag.pointerId);
        }
        layerBarRef.current = null;
        setDragTooltip(null);
        setInsertionLine(null);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKeyDown);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown);
  };

  const getKeyframe = (target: TimelineKeyframeSelection) =>
    animationMap.get(target.layerId)?.properties[target.propertyName]?.keyframes
      .find((keyframe) => keyframe.id === target.keyframeId);

  const beginKeyframeDrag = (
    event: PointerEvent<HTMLButtonElement>,
    target: TimelineKeyframeSelection,
    time: number,
  ) => {
    if (event.button !== 0 || layers.find((layer) => layer.id === target.layerId)?.locked) return;
    event.preventDefault();
    event.stopPropagation();
    const identity = (item: TimelineKeyframeSelection) =>
      item.layerId === target.layerId &&
      item.propertyName === target.propertyName &&
      item.keyframeId === target.keyframeId;
    const currentSelection = selectedKeyframesRef.current;
    const selected = currentSelection.some(identity);
    const nextSelection = event.ctrlKey || event.metaKey || event.shiftKey
      ? selected
        ? currentSelection.filter((item) => !identity(item))
        : [...currentSelection, target]
      : selected
        ? currentSelection
        : [target];
    const dragSelection = nextSelection.some(identity) ? nextSelection : [target];
    selectedKeyframesRef.current = nextSelection;
    setSelectedKeyframes(nextSelection);
    const startTimes = dragSelection.flatMap((item) => {
      const keyframe = getKeyframe(item);
      return keyframe ? [{ ...item, time: keyframe.time }] : [];
    });
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    keyframeDragRef.current = {
      pointerId: event.pointerId,
      element: event.currentTarget,
      startX: event.clientX,
      startTimes: startTimes.length ? startTimes : [{ ...target, time }],
      cancelEdit: null,
      changed: false,
      stretch: event.altKey,
    };
  };

  const moveKeyframeDrag = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const delta = (event.clientX - drag.startX) / pixelsPerSecond;
    if (Math.abs(delta * pixelsPerSecond) < 3) return;

    const times = drag.startTimes.map((item) => item.time);
    const minimum = Math.min(...times);
    const maximum = Math.max(...times);
    const anchor = drag.stretch
      ? times.length > 1 ? minimum : currentTime
      : 0;
    const stretchSpan = Math.max(1 / fps, maximum - anchor);
    const stretchFactor = drag.stretch
      ? Math.max(0.1, 1 + delta / stretchSpan)
      : 1;
    const snapEnabled = snapping || event.shiftKey;
    const snapTargets = [
      currentTime,
      ...animations.flatMap((animation) =>
        Object.values(animation.properties).flatMap((property) =>
          property.keyframes
            .filter((keyframe) =>
              !drag.startTimes.some((item) => item.keyframeId === keyframe.id),
            )
            .map((keyframe) => keyframe.time),
        ),
      ),
    ];
    if (!drag.cancelEdit) drag.cancelEdit = onBeginLayerEdit();

    for (const item of drag.startTimes) {
      const movedTime = drag.stretch
        ? anchor + (item.time - anchor) * stretchFactor
        : item.time + delta;
      const clampedTime = Math.max(0, Math.min(duration, movedTime));
      const snapTarget = snapEnabled
        ? snapTargets.find((candidate) =>
            Math.abs(candidate - clampedTime) <= 8 / pixelsPerSecond,
          )
        : undefined;
      const snappedTime = Math.round(
        (snapTarget ?? clampedTime) * fps,
      ) / fps;
      const time = Math.max(0, Math.min(duration, snappedTime));
      if (Math.abs(time - item.time) < 0.000001) continue;
      onUpdateKeyframe(
        item.layerId,
        item.propertyName,
        item.keyframeId,
        { time },
        false,
      );
      drag.changed = true;
    }
  };

  const finishKeyframeDrag = (
    event: PointerEvent<HTMLButtonElement>,
    cancel: boolean,
  ) => {
    const drag = keyframeDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (cancel) drag.cancelEdit?.();
    if (drag.element.hasPointerCapture(drag.pointerId)) {
      drag.element.releasePointerCapture(drag.pointerId);
    }
    keyframeDragRef.current = null;
  };

  const updateSelectedKeyframesInterpolation = (
    interpolation: Keyframe['interpolation'],
  ) => {
    if (selectedKeyframesRef.current.length === 0) return;
    onBeginLayerEdit();
    selectedKeyframesRef.current.forEach((target) =>
      onUpdateKeyframe(
        target.layerId,
        target.propertyName,
        target.keyframeId,
        { interpolation },
        false,
      ),
    );
    setKeyframeContextMenu(null);
  };

  const deleteSelectedKeyframes = () => {
    if (selectedKeyframesRef.current.length === 0) return;
    onBeginLayerEdit();
    selectedKeyframesRef.current.forEach((target) =>
      onDeleteKeyframe(
        target.layerId,
        target.propertyName,
        target.keyframeId,
        false,
      ),
    );
    selectedKeyframesRef.current = [];
    setSelectedKeyframes([]);
    setKeyframeContextMenu(null);
  };

  // ---- Timeline commands (header buttons, right-click menu, Alt+[ / Alt+]) ----
  type TimelineCommand = 'split' | 'cut-left' | 'cut-right' | 'duplicate' | 'delete' | 'group' | 'ungroup';

  const runTimelineCommand = (command: TimelineCommand) => {
    const ids = selectedIdsRef.current.length
      ? selectedIdsRef.current
      : selectedLayerId ? [selectedLayerId] : [];

    if (ids.length === 0) return;

    if (command === 'split') {
      onSplitLayers(ids, currentTime);
      return;
    }

    if (command === 'duplicate') {
      onDuplicateLayers(ids);
      return;
    }

    if (command === 'group') {
      onGroupLayers(ids);
      return;
    }

    if (command === 'ungroup') {
      onUngroupLayers(ids);
      return;
    }

    if (command === 'delete') {
      onDeleteLayers(ids);
      return;
    }

    // Cut Left = trim the start of the layer to the playhead.
    // Cut Right = trim the end of the layer to the playhead.
    const updates: Record<string, Partial<EditorLayerProperties>> = {};

    for (const layer of layers) {
      if (!ids.includes(layer.id) || layer.locked) continue;

      const start = layer.startTime ?? 0;
      const inPoint = layer.inPoint ?? 0;
      const outPoint = layer.outPoint ?? duration;
      const stretch =
        typeof layer.stretch === 'number' && layer.stretch > 0
          ? layer.stretch / 100
          : 1;
      const end = start + (outPoint - inPoint) * stretch;

      if (currentTime <= start + 0.000001 || currentTime >= end - 0.000001) continue;

      const sourceTime = inPoint + (currentTime - start) / stretch;

      updates[layer.id] = command === 'cut-left'
        ? { startTime: currentTime, inPoint: sourceTime }
        : { outPoint: sourceTime };
    }

    if (Object.keys(updates).length === 0) return;

    onBeginLayerEdit();
    onUpdateLayers(updates);
  };

  const openLayerMenu = (x: number, y: number, layerId: string) => {
    if (!selectedIdsRef.current.includes(layerId)) {
      selectedIdsRef.current = [layerId];
      setSelectionVersion((version) => version + 1);
    }

    onSelectLayer(layerId);

    if (onOpenContextMenu) {
      onOpenContextMenu({
        kind: 'layer',
        x,
        y,
        layerId,
        ids: [...selectedIdsRef.current],
      });
      return;
    }

    setContextMenu({ x, y, layerId });
  };

  const runTimelineCommandRef = useRef(runTimelineCommand);

  useEffect(() => {
    runTimelineCommandRef.current = runTimelineCommand;
  });

  // The header buttons (in TimelineAe) send commands through this event.
  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: TimelineCommand }>).detail;

      if (detail?.command) {
        runTimelineCommandRef.current(detail.command);
      }
    };

    window.addEventListener('brx-timeline-command', onCommand);

    return () => window.removeEventListener('brx-timeline-command', onCommand);
  }, []);

  // The right-click menu asks for these two through events.
  useEffect(() => {
    const onRename = (event: Event) => {
      const id = (event as CustomEvent<{ layerId?: string }>).detail?.layerId;
      const target = layers.find((item) => item.id === id);

      if (target) {
        setRenaming({ id: target.id, value: target.name });
      }
    };

    const onSelectAll = () => {
      selectedIdsRef.current = layers.map((item) => item.id);
      setSelectionVersion((version) => version + 1);

      if (layers.length) {
        onSelectLayer(layers[layers.length - 1].id);
      }
    };

    window.addEventListener('brx-timeline-rename', onRename);
    window.addEventListener('brx-timeline-select-all', onSelectAll);

    return () => {
      window.removeEventListener('brx-timeline-rename', onRename);
      window.removeEventListener('brx-timeline-select-all', onSelectAll);
    };
  }, [layers, onSelectLayer]);

  // Close the right-click menu on outside click or Escape.
  useEffect(() => {
    if (!contextMenu) return;

    const onPointerDown = (event: globalThis.PointerEvent) => {
      const target = event.target as HTMLElement | null;

      if (target?.closest('.tl-empty-context-menu')) return;

      setContextMenu(null);
    };

    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setContextMenu(null);
    };

    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [contextMenu]);

  const handleTimelineKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keyframeSelection = selectedKeyframesRef.current;
    if (event.key === 'Escape') {
      if (keyframeDragRef.current) {
        event.preventDefault();
        keyframeDragRef.current.cancelEdit?.();
        if (keyframeDragRef.current.element.hasPointerCapture(keyframeDragRef.current.pointerId)) {
          keyframeDragRef.current.element.releasePointerCapture(keyframeDragRef.current.pointerId);
        }
        keyframeDragRef.current = null;
      }
      setKeyframeContextMenu(null);
      return;
    }
    const target = event.target as HTMLElement;
    if (target.matches('input, textarea, select, [contenteditable="true"]')) return;

    const selectedIds = selectedIdsRef.current.length
      ? selectedIdsRef.current
      : selectedLayerId ? [selectedLayerId] : [];
    const selected = layers.filter((layer) => selectedIds.includes(layer.id));
    const modifier = event.ctrlKey || event.metaKey;
    if ((event.key === 'j' || event.key === 'J' || event.key === 'k' || event.key === 'K') && !modifier) {
      const keyframeTimes = animations
        .filter((animation) => selectedIds.includes(animation.layerId))
        .flatMap((animation) => Object.values(animation.properties).flatMap((property) =>
          property.keyframes.map((keyframe) => keyframe.time),
        ))
        .sort((a, b) => a - b);
      const nextTime = event.key.toLowerCase() === 'j'
        ? keyframeTimes.filter((time) => time < currentTime - 0.000001).at(-1)
        : keyframeTimes.find((time) => time > currentTime + 0.000001);
      if (nextTime !== undefined) {
        event.preventDefault();
        onSeekTime(nextTime);
      }
      return;
    }
    if (keyframeSelection.length > 0 && event.key === 'F9') {
      event.preventDefault();
      updateSelectedKeyframesInterpolation(
        event.ctrlKey && event.shiftKey
          ? 'ease-out'
          : event.shiftKey
            ? 'ease-in'
            : 'ease-in-out',
      );
      return;
    }
    if (keyframeSelection.length > 0 && modifier && event.altKey && event.key.toLowerCase() === 'h') {
      event.preventDefault();
      updateSelectedKeyframesInterpolation('hold');
      return;
    }
    if (keyframeSelection.length > 0 && modifier && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      keyframeClipboardRef.current = keyframeSelection.flatMap((target) => {
        const keyframe = getKeyframe(target);
        return keyframe ? [{ ...target, keyframe: { ...keyframe } }] : [];
      });
      return;
    }
    if (keyframeSelection.length > 0 && modifier && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      const clipboard = keyframeClipboardRef.current;
      if (clipboard.length === 0) return;
      const origin = Math.min(...clipboard.map((item) => item.keyframe.time));
      onBeginLayerEdit();
      clipboard.forEach((item) =>
        onAddKeyframe(
          item.layerId,
          item.propertyName,
          item.keyframe.value,
          currentTime + item.keyframe.time - origin,
          item.keyframe.interpolation,
          false,
        ),
      );
      return;
    }
    if (keyframeSelection.length > 0 && event.key === 'Delete') {
      event.preventDefault();
      deleteSelectedKeyframes();
      return;
    }
    if (keyframeSelection.length > 0 && event.key === 'Enter') {
      event.preventDefault();
      const selected = keyframeSelection[0];
      const element = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.tl-keyframe'))
        .find((candidate) =>
          candidate.dataset.layerId === selected.layerId &&
          candidate.dataset.propertyName === selected.propertyName &&
          candidate.dataset.keyframeId === selected.keyframeId,
        );
      const bounds = element?.getBoundingClientRect();
      if (bounds) setKeyframeContextMenu({ x: bounds.left, y: bounds.bottom, target: selected });
      return;
    }
    if (event.shiftKey && (event.key === '=' || event.key === '+') || event.shiftKey && event.key === '-') {
      event.preventDefault();
      const modes = blendModeGroups.flatMap((group) => group.modes.map((mode) => mode.value));
      const direction = event.key === '-' ? -1 : 1;
      const updates: Record<string, Partial<EditorLayerProperties>> = {};
      selected.filter((layer) => !layer.locked).forEach((layer) => {
        const index = modes.indexOf(layer.blendMode ?? 'normal');
        updates[layer.id] = { blendMode: modes[(index + direction + modes.length) % modes.length] };
      });
      if (Object.keys(updates).length) {
        onBeginLayerEdit();
        onUpdateLayers(updates);
      }
      return;
    }
    if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      if (keyframeSelection.length > 0) {
        const allKeyframes = animations
          .filter((animation) => selectedIds.includes(animation.layerId))
          .flatMap((animation) =>
            Object.entries(animation.properties).flatMap(([propertyName, property]) =>
              property.keyframes.map((keyframe) => ({
                layerId: animation.layerId,
                propertyName: propertyName as AnimatedPropertyName,
                keyframeId: keyframe.id,
              })),
            ),
          );
        selectedKeyframesRef.current = allKeyframes;
        setSelectedKeyframes(allKeyframes);
        return;
      }
      selectedIdsRef.current = layers.map((layer) => layer.id);
      setSelectionVersion((version) => version + 1);
      if (layers.length) onSelectLayer(layers[layers.length - 1].id);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      if (event.shiftKey) {
        onUngroupLayers(selectedIds);
      } else {
        onGroupLayers(selectedIds);
      }
      return;
    }
    if (modifier && event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      onSplitLayers(selectedIds, currentTime);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      onDuplicateLayers(selectedIds);
      return;
    }
    if (event.key === 'Delete') {
      event.preventDefault();
      onDeleteLayers(selectedIds);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const layer = layers.find((item) => item.id === selectedIds[selectedIds.length - 1]);
      if (layer) setRenaming({ id: layer.id, value: layer.name });
      return;
    }
    if (modifier && (event.key === ']' || event.key === '[')) {
      event.preventDefault();
      const direction = event.key === ']' ? -1 : 1;
      const ordered = [...layers];
      for (let index = direction < 0 ? 1 : ordered.length - 2;
        direction < 0 ? index < ordered.length : index >= 0;
        index += direction) {
        if (!selectedIds.includes(ordered[index].id) || ordered[index].locked) continue;
        const swap = index + direction;
        if (swap < 0 || swap >= ordered.length || ordered[swap].locked) continue;
        [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
      }
      if (ordered.some((layer, index) => layer.id !== layers[index]?.id)) {
        onBeginLayerEdit();
        onUpdateLayers({}, ordered.map((layer) => layer.id));
      }
      return;
    }
    if (event.altKey && (event.key === '[' || event.key === ']')) {
      event.preventDefault();
      runTimelineCommand(event.key === '[' ? 'cut-left' : 'cut-right');
      return;
    }
    if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      const updates: Record<string, Partial<EditorLayerProperties>> = {};
      for (const layer of selected) {
        if (layer.locked) continue;
        const start = layer.startTime ?? 0;
        const input = layer.inPoint ?? 0;
        if (event.altKey && event.key === '[') {
          const delta = Math.max(0, currentTime - start);
          updates[layer.id] = { startTime: currentTime, inPoint: input + delta };
        } else if (event.altKey) {
          updates[layer.id] = {
            outPoint: Math.max(input + 1 / fps, input + currentTime - start),
          };
        } else {
          updates[layer.id] = { startTime: currentTime };
        }
      }
      if (Object.keys(updates).length) {
        onBeginLayerEdit();
        onUpdateLayers(updates);
      }
    }
  };

  const beginMarquee = (event: PointerEvent<HTMLDivElement>) => {
    const startTarget = event.target as HTMLElement;
    if (
      event.button !== 0 ||
      (startTarget !== event.currentTarget &&
        !startTarget.matches('.tl-track-layer-row, .tl-track-property-row'))
    ) {
      return;
    }
    event.preventDefault();
    const track = event.currentTarget;
    const bounds = track.getBoundingClientRect();
    const startX = event.clientX + track.scrollLeft;
    const startY = event.clientY - bounds.top + track.scrollTop;
    track.setPointerCapture(event.pointerId);
    const onMove = (nativeEvent: globalThis.PointerEvent) => {
      const endX = nativeEvent.clientX + track.scrollLeft;
      const endY = nativeEvent.clientY - bounds.top + track.scrollTop;
      setMarquee({
        left: Math.min(startX, endX),
        top: Math.min(startY, endY),
        width: Math.abs(endX - startX),
        height: Math.abs(endY - startY),
      });
    };
    const finish = (nativeEvent: globalThis.PointerEvent, cancel: boolean) => {
      if (nativeEvent.pointerId !== event.pointerId) return;
      if (!cancel) {
        const endX = nativeEvent.clientX + track.scrollLeft;
        const endY = nativeEvent.clientY - bounds.top + track.scrollTop;
        const rect = {
          left: Math.min(startX, endX),
          right: Math.max(startX, endX),
          top: Math.min(startY, endY),
          bottom: Math.max(startY, endY),
        };
        const hits = Array.from(track.querySelectorAll<HTMLElement>('.tl-layer-bar'))
          .filter((bar) => {
            const barBounds = bar.getBoundingClientRect();
            const left = barBounds.left - bounds.left + track.scrollLeft;
            const top = barBounds.top - bounds.top + track.scrollTop;
            return rect.left <= left + barBounds.width && rect.right >= left &&
              rect.top <= top + barBounds.height && rect.bottom >= top;
          })
          .map((bar) => bar.closest<HTMLElement>('.tl-track-layer-row')?.dataset.layerId)
          .filter((id): id is string => Boolean(id));
        const keyframeHits = Array.from(track.querySelectorAll<HTMLButtonElement>('.tl-keyframe'))
          .filter((keyframe) => {
            const keyframeBounds = keyframe.getBoundingClientRect();
            const left = keyframeBounds.left - bounds.left + track.scrollLeft;
            const top = keyframeBounds.top - bounds.top + track.scrollTop;
            return rect.left <= left + keyframeBounds.width && rect.right >= left &&
              rect.top <= top + keyframeBounds.height && rect.bottom >= top;
          })
          .flatMap((keyframe) => {
            const { layerId, propertyName, keyframeId } = keyframe.dataset;
            if (!layerId || !propertyName || !keyframeId) return [];
            return [{
              layerId,
              propertyName: propertyName as AnimatedPropertyName,
              keyframeId,
            }];
          });
        const next = nativeEvent.shiftKey || nativeEvent.ctrlKey || nativeEvent.metaKey
          ? Array.from(new Set([...selectedIdsRef.current, ...hits]))
          : hits;
        selectedIdsRef.current = next;
        if (next.length) lastSelectedRef.current = next[next.length - 1];
        setSelectionVersion((version) => version + 1);
        const nextKeyframes = nativeEvent.shiftKey || nativeEvent.ctrlKey || nativeEvent.metaKey
          ? Array.from(new Map([
              ...selectedKeyframesRef.current,
              ...keyframeHits,
            ].map((item) => [
              `${item.layerId}:${item.propertyName}:${item.keyframeId}`,
              item,
            ])).values())
          : keyframeHits;
        selectedKeyframesRef.current = nextKeyframes;
        setSelectedKeyframes(nextKeyframes);
        if (next.length) callbacksRef.current.onSelectLayer(next[next.length - 1]);
      }
      setMarquee(null);
      if (track.hasPointerCapture(event.pointerId)) track.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onUp = (nativeEvent: globalThis.PointerEvent) => finish(nativeEvent, false);
    const onCancel = (nativeEvent: globalThis.PointerEvent) => finish(nativeEvent, true);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  };

  // Lanes slide (120ms) to their new place after a reorder.
  useLayoutEffect(() => {
    const before = flipTopsRef.current;
    const container = timeRef.current;

    if (!before || !container) {
      return;
    }

    flipTopsRef.current = null;
    const moved: HTMLElement[] = [];

    container
      .querySelectorAll<HTMLElement>('.tl-track-layer-row')
      .forEach((row) => {
        const id = row.dataset.layerId;
        const oldTop = id ? before.get(id) : undefined;

        if (!id || oldTop === undefined) return;

        const delta = oldTop - row.getBoundingClientRect().top;

        if (Math.abs(delta) < 1) return;

        container
          .querySelectorAll<HTMLElement>(
            `.tl-track-layer-row[data-layer-id="${id}"], .tl-track-property-row[data-layer-id="${id}"]`,
          )
          .forEach((element) => {
            element.style.transition = 'none';
            element.style.transform = `translateY(${delta}px)`;
            moved.push(element);
          });
      });

    if (moved.length === 0) return;

    void container.offsetHeight; // apply the start positions first

    moved.forEach((element) => {
      element.style.transition = 'transform 120ms ease-out';
      element.style.transform = '';
    });

    const timer = window.setTimeout(() => {
      moved.forEach((element) => {
        element.style.transition = '';
      });
    }, 160);

    return () => window.clearTimeout(timer);
  }, [layers]);

  // Keep the time under the pointer fixed while zooming with Ctrl + wheel.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const element = timeRef.current;

    if (!anchor || !element) {
      return;
    }

    zoomAnchorRef.current = null;
    element.scrollLeft = Math.max(0, anchor.time * pixelsPerSecond - anchor.offsetX);
  }, [pixelsPerSecond]);

  // Wheel over the lanes: vertical scroll is native, Shift + wheel scrolls
  // sideways, Ctrl + wheel zooms the time.
  useEffect(() => {
    const element = timeRef.current;

    if (!element) {
      return;
    }

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        if (!onZoomChange) return;
        event.preventDefault();
        const bounds = element.getBoundingClientRect();
        const offsetX = event.clientX - bounds.left;
        zoomAnchorRef.current = {
          time: (element.scrollLeft + offsetX) / pixelsPerSecond,
          offsetX,
        };
        onZoomChange(
          Math.min(400, Math.max(25, zoom * Math.exp(-event.deltaY * 0.002))),
        );
        return;
      }

      if (event.shiftKey) {
        event.preventDefault();
        element.scrollLeft += event.deltaY || event.deltaX;
      }
    };

    element.addEventListener('wheel', onWheel, { passive: false });

    return () => element.removeEventListener('wheel', onWheel);
  }, [zoom, pixelsPerSecond, onZoomChange]);

  // Desktop keys that work without clicking the timeline first (ignored
  // while typing): Ctrl+A, Delete / Backspace, Escape, Alt+Up / Alt+Down.
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
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

      // Selected keyframes keep their own handling in the timeline.
      if (selectedKeyframesRef.current.length > 0) {
        return;
      }

      const modifier = event.ctrlKey || event.metaKey;
      const ids = selectedIdsRef.current.length
        ? selectedIdsRef.current
        : selectedLayerId
          ? [selectedLayerId]
          : [];

      if (modifier && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        event.stopImmediatePropagation();
        selectedIdsRef.current = layers.map((layer) => layer.id);
        setSelectionVersion((version) => version + 1);
        if (layers.length) onSelectLayer(layers[layers.length - 1].id);
        return;
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && !modifier && ids.length > 0) {
        event.preventDefault();
        event.stopImmediatePropagation();
        onDeleteLayers(ids);
        selectedIdsRef.current = [];
        setSelectionVersion((version) => version + 1);
        return;
      }

      if (event.key === 'Escape') {
        if (
          layerBarRef.current ||
          document.querySelector('.link-picker-popup, .tl-empty-context-menu, .tl-context-menu')
        ) {
          return;
        }
        if (selectedIdsRef.current.length > 0 || selectedLayerId) {
          selectedIdsRef.current = [];
          setSelectionVersion((version) => version + 1);
          onSelectLayer(null);
        }
        return;
      }

      if (event.altKey && !modifier && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const up = event.key === 'ArrowUp';
        const chosen = new Set(ids);
        const ordered = [...layers];
        const canMove = (index: number) =>
          chosen.has(ordered[index].id) && !ordered[index].locked;
        const canPass = (index: number) =>
          !chosen.has(ordered[index].id) && !ordered[index].locked;

        if (up) {
          for (let index = 1; index < ordered.length; index += 1) {
            if (canMove(index) && canPass(index - 1)) {
              [ordered[index], ordered[index - 1]] = [ordered[index - 1], ordered[index]];
            }
          }
        } else {
          for (let index = ordered.length - 2; index >= 0; index -= 1) {
            if (canMove(index) && canPass(index + 1)) {
              [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
            }
          }
        }

        if (ordered.some((layer, index) => layer.id !== layers[index]?.id)) {
          rememberLanePositions();
          onBeginLayerEdit();
          onUpdateLayers({}, ordered.map((layer) => layer.id));
        }
      }
    };

    window.addEventListener('keydown', onKeyDown, true);

    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [layers, selectedLayerId, onDeleteLayers, onUpdateLayers, onBeginLayerEdit, onSelectLayer]);

  return (
    <div className="tl-row-viewport">
      <div
        className="tl-list-scroll"
        ref={listRef}
        onScroll={handleListScroll}
        onContextMenu={openNewLayerMenu}
        onClick={(event) => {
          if (event.target === event.currentTarget) setContextMenu(null);
        }}
      >
        {displayLayers.map((layer, index) => {
          const selected = layer.id === selectedLayerId || selectedIdsRef.current.includes(layer.id);
          const expanded = selected;
          const labelClass = getLayerLabelClass(layer);
          const rowClass = `tl-layer-row ${selected ? 'is-selected' : ''}${layer.groupId ? ' is-grouped' : ''}${layer.isGroup ? ' is-group' : ''}`;

          return (
            <Fragment key={layer.id}>
              <div
                className={rowClass}
                role="button"
                tabIndex={0}
                onClick={(event) => {
                  selectWithModifiers(layer.id, event.shiftKey, event.ctrlKey || event.metaKey);
                  onSelectLayer(layer.id);
                }}
                onKeyDown={(event) => activateLayer(event, layer.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  openLayerMenu(event.clientX, event.clientY, layer.id);
                }}
                data-layer-id={layer.id}
                onPointerUp={() => {
                }}
                onPointerEnter={() => {
                  if (parentPickRef.current && !wouldCreateParentCycle(parentPickRef.current.childId, layer.id)) {
                    setParentPickChild(layer.id);
                  }
                }}
              >
                <button
                  type="button"
                  className={`tl-row-toggle ${layer.visible === false ? 'is-disabled' : ''}`}
                  aria-label={`${layer.visible === false ? 'Show' : 'Hide'} ${layer.name}`}
                  onClick={(event) => { event.stopPropagation(); onToggleVisibility?.(layer.id); }}
                >
                  <Eye size={11} />
                </button>
                <button
                  type="button"
                  className={`tl-row-toggle ${layer.audioMuted ? 'is-disabled' : ''}`}
                  aria-label={`${layer.audioMuted ? 'Enable' : 'Mute'} audio for ${layer.name}`}
                  onClick={(event) => { event.stopPropagation(); onToggleAudio?.(layer.id); }}
                >
                  <Volume2 size={11} />
                </button>
                <button
                  type="button"
                  className={`tl-row-toggle ${layer.solo ? 'is-solo' : ''}`}
                  aria-label={`${layer.solo ? 'Unsolo' : 'Solo'} ${layer.name}`}
                  onClick={(event) => { event.stopPropagation(); onToggleSolo?.(layer.id); }}
                >
                  <span className="tl-solo-dot" />
                </button>
                <button
                  type="button"
                  className={`tl-row-toggle ${layer.locked ? 'is-locked' : ''}`}
                  aria-label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name}`}
                  title={`${layer.locked ? 'Unlock' : 'Lock'} layer`}
                  onClick={(event) => { event.stopPropagation(); commitLayerPatch(layer.id, { locked: !layer.locked }); }}
                >
                  {layer.locked ? <Lock size={10} /> : null}
                </button>
                <label className="tl-label-picker" title="Layer label color" onClick={(event) => event.stopPropagation()}>
                  <span className={`tl-label-chip ${labelClass}`} />
                  <select
                    aria-label={`Label color for ${layer.name}`}
                    value={layer.labelColor ?? defaultLabelByType[layer.type]}
                    disabled={layer.locked}
                    onChange={(event) => commitLayerPatch(layer.id, { labelColor: Number(event.currentTarget.value) })}
                  >
                    {Array.from({ length: 17 }, (_, color) => (
                      <option value={color} key={color}>{color === 0 ? 'None' : `Label ${color}`}</option>
                    ))}
                  </select>
                </label>
                <span className="tl-layer-number">{index + 1}</span>
                <span className="tl-layer-source">
                  {expanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                  <LayerTypeIcon type={layer.type} />
                  {renaming?.id === layer.id ? (
                    <input
                      className="tl-layer-name-editor"
                      aria-label={`Rename ${layer.name}`}
                      autoFocus
                      value={renaming.value}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => setRenaming({ ...renaming, value: event.target.value })}
                      onBlur={commitRename}
                      onKeyDown={(event) => {
                        event.stopPropagation();
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          commitRename();
                        } else if (event.key === 'Escape') {
                          event.preventDefault();
                          setRenaming(null);
                        }
                      }}
                    />
                  ) : (
                    <span className="tl-layer-name">{sourceNameMode === 'source' && layer.sourceId ? sourceNames[layer.sourceId] ?? layer.name : layer.name}</span>
                  )}
                  {matteSourceLayerIds.has(layer.id) && (
                    <span className="tl-matte-icon" title="Used as a track matte">◩</span>
                  )}
                </span>
                {switchFields.map(([field, title, icon]) => (
                  (() => {
                    const active = field === 'quality' ? layer.quality === 'best' : Boolean(layer[field]);
                    return <button
                      type="button"
                      key={field}
                      className={`tl-switch-cell ${active ? 'is-active' : ''}`}
                      title={field === 'quality' ? `${layer.quality === 'draft' ? 'Draft' : 'Best'} quality` : title}
                      aria-label={`${active ? 'Disable' : 'Enable'} ${title} for ${layer.name}`}
                      aria-pressed={active}
                      disabled={layer.locked}
                      onClick={(event) => {
                        event.stopPropagation();
                        const patch = field === 'quality'
                          ? { quality: layer.quality === 'draft' ? 'best' as const : 'draft' as const }
                          : { [field]: !layer[field] };
                        commitLayerPatch(layer.id, patch);
                      }}
                    >
                      {icon}
                    </button>;
                  })()
                ))}
                <label className="tl-mode-cell" title="Blend mode" onClick={(event) => event.stopPropagation()}>
                  <select
                    aria-label={`Blend mode for ${layer.name}`}
                    value={layer.blendMode ?? 'normal'}
                    disabled={layer.locked}
                    onChange={(event) => commitLayerPatch(layer.id, { blendMode: event.currentTarget.value as BlendMode })}
                  >
                    {blendModeGroups.map((group) => (
                      <optgroup label={group.label} key={group.label}>
                        {group.modes.map((mode) => (
                          <option value={mode.value} key={mode.value}>
                            {mode.label}{approximateBlendModes.has(mode.value) ? ' (approx)' : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  {layer.blendMode && approximateBlendModes.has(layer.blendMode) && <small className="tl-approx-tag">approx</small>}
                </label>
                <button
                  type="button"
                  role="checkbox"
                  className={`tl-switch-cell ${layer.preserveTransparency ? 'is-active' : ''}`}
                  aria-label={`Preserve underlying transparency for ${layer.name}`}
                  aria-checked={Boolean(layer.preserveTransparency)}
                  aria-pressed={Boolean(layer.preserveTransparency)}
                  disabled={layer.locked || (layer.blendMode ?? 'normal') === 'normal'}
                  onClick={(event) => { event.stopPropagation(); commitLayerPatch(layer.id, { preserveTransparency: !layer.preserveTransparency }); }}
                >T</button>
                <label className="tl-mode-cell tl-matte-cell" title="Track matte" onClick={(event) => event.stopPropagation()}>
                  <select
                    aria-label={`Track matte for ${layer.name}`}
                    value={layer.trackMatte ?? 'none'}
                    disabled={layer.locked || index === 0}
                    onChange={(event) => {
                      const mode = event.currentTarget.value as TrackMatteMode;
                      const source = displayLayers[index - 1];
                      setTrackMatte(layer, mode, source);
                    }}
                  >
                    {trackMatteOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className={`tl-parent-cell ${parentPickChild === layer.id ? 'is-parent-target' : ''}`} onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    className="tl-parent-pickwhip"
                    aria-label={`Pick parent for ${layer.name}`}
                    title="Drag to a layer to set parent; release on empty space to clear"
                    disabled={layer.locked}
                    onPointerDown={(event) => {
                      event.preventDefault();
                      parentPickRef.current = { childId: layer.id, x: event.clientX, y: event.clientY };
                      setParentPickChild(layer.id);
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                  >⟳</button>
                  <LinkToPicker
                    layer={layer}
                    layers={layers}
                    thumbnails={sourceThumbnails}
                    sourceNames={sourceNames}
                    disabled={layer.locked}
                    wouldCreateCycle={wouldCreateParentCycle}
                    onChange={(parentId) => setParent(layer, parentId)}
                  />
                  {layer.trackMatte && layer.trackMatte !== 'none' && <span className="tl-matte-icon" title="Uses track matte">◩</span>}
                </label>
                {visibleExtraColumns.map((key) => {
                  const fpsValue = Math.max(1, fps);
                  const animation = animationMap.get(layer.id);
                  if (key === 'in') return <span className="tl-extra-cell" key={key}>{Math.round((layer.inPoint ?? 0) * fpsValue)}</span>;
                  if (key === 'out') return <span className="tl-extra-cell" key={key}>{Math.round((layer.outPoint ?? duration) * fpsValue)}</span>;
                  if (key === 'duration') return <span className="tl-extra-cell" key={key}>{Math.round(((layer.outPoint ?? duration) - (layer.inPoint ?? 0)) * fpsValue)}</span>;
                  if (key === 'stretch') return <input className="tl-extra-input" aria-label={`Stretch for ${layer.name}`} type="number" min="1" defaultValue={layer.stretch ?? 100} disabled={layer.locked} key={key} onClick={(event) => event.stopPropagation()} onBlur={(event) => {
                    const stretch = Math.max(1, Number(event.currentTarget.value));
                    if (stretch !== (layer.stretch ?? 100)) commitLayerPatch(layer.id, { stretch });
                  }} />;
                  if (key === 'keys') return <span className="tl-extra-cell" key={key}>{animation ? Object.values(animation.properties).reduce((count, property) => count + property.keyframes.length, 0) : 0}</span>;
                  return <input className="tl-extra-input" aria-label={`Comments for ${layer.name}`} type="text" defaultValue={layer.comments ?? ''} disabled={layer.locked} key={key} onClick={(event) => event.stopPropagation()} onBlur={(event) => {
                    if (event.currentTarget.value !== (layer.comments ?? '')) commitLayerPatch(layer.id, { comments: event.currentTarget.value });
                  }} />;
                })}
              </div>
              {expanded && (
                <PropertyRows
                  layer={layer}
                  animation={animationMap.get(layer.id)}
                  onBeginEdit={onBeginLayerEdit}
                  onDeleteKeyframes={(propertyNames) => {
                    const targets = propertyNames.flatMap((propertyName) =>
                      animationMap.get(layer.id)?.properties[propertyName]?.keyframes.map((keyframe) => ({
                        propertyName,
                        keyframeId: keyframe.id,
                      })) ?? [],
                    );
                    if (targets.length === 0) return;
                    onBeginLayerEdit();
                    targets.forEach(({ propertyName, keyframeId }) =>
                      onDeleteKeyframe(layer.id, propertyName, keyframeId, false),
                    );
                  }}
                  onLiveChange={(updates, keyframeProperties) => onUpdateLayers(
                    { [layer.id]: updates },
                    undefined,
                    { keyframeProperties, time: currentTime },
                  )}
                />
              )}
            </Fragment>
          );
        })}
        {contextMenu && createPortal(
          <div
            className="tl-empty-context-menu"
            style={{
              position: 'fixed',
              zIndex: 10000,
              left: Math.max(8, Math.min(contextMenu.x, window.innerWidth - 250)),
              top: Math.max(8, Math.min(contextMenu.y, window.innerHeight - 470)),
              maxHeight: window.innerHeight - 16,
              overflowY: 'auto',
            }}
            onContextMenu={(event) => event.preventDefault()}
          >
            {contextMenu.layerId ? (() => {
              const layer = layers.find((item) => item.id === contextMenu.layerId);
              if (!layer) return null;
              const close = () => setContextMenu(null);
              return <>
                <strong>{layer.name}</strong>
                <button type="button" disabled={layer.locked} onClick={() => { runTimelineCommand('split'); close(); }}>Split Layer (Ctrl+Shift+D)</button>
                <button type="button" disabled={layer.locked} onClick={() => { runTimelineCommand('cut-left'); close(); }}>Cut Left - trim start (Alt+[)</button>
                <button type="button" disabled={layer.locked} onClick={() => { runTimelineCommand('cut-right'); close(); }}>Cut Right - trim end (Alt+])</button>
                <button type="button" onClick={() => { setRenaming({ id: layer.id, value: layer.name }); close(); }}>Rename</button>
                <button type="button" disabled={layer.locked} onClick={() => { runTimelineCommand('duplicate'); close(); }}>Duplicate (Ctrl+D)</button>
                <button type="button" disabled={layer.locked} onClick={() => { runTimelineCommand('group'); close(); }}>Group (Ctrl+G)</button>
                {layer.isGroup && <button type="button" disabled={layer.locked} onClick={() => { runTimelineCommand('ungroup'); close(); }}>Ungroup (Ctrl+Shift+G)</button>}
                <button type="button" disabled={layer.locked} onClick={() => { runTimelineCommand('delete'); close(); }}>Delete (Del)</button>
                <label className="tl-context-select">Label
                  <select value={layer.labelColor ?? defaultLabelByType[layer.type]} onChange={(event) => { commitLayerPatch(layer.id, { labelColor: Number(event.currentTarget.value) }); close(); }}>
                    {Array.from({ length: 17 }, (_, color) => <option value={color} key={color}>{color === 0 ? 'None' : `Label ${color}`}</option>)}
                  </select>
                </label>
                <label className="tl-context-select">Blend Mode
                  <select value={layer.blendMode ?? 'normal'} onChange={(event) => { commitLayerPatch(layer.id, { blendMode: event.currentTarget.value as BlendMode }); close(); }}>
                    {blendModeGroups.flatMap((group) => group.modes).map((mode) => <option value={mode.value} key={mode.value}>{mode.label}</option>)}
                  </select>
                </label>
                <label className="tl-context-select">Track Matte
                  <select value={layer.trackMatte ?? 'none'} disabled={layers.indexOf(layer) === 0} onChange={(event) => {
                    const value = event.currentTarget.value as TrackMatteMode;
                    const above = layers[layers.indexOf(layer) - 1];
                    setTrackMatte(layer, value, above);
                    close();
                  }}>
                    {trackMatteOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="tl-context-select">Parent
                  <select value={layer.parentId ?? ''} onChange={(event) => { setParent(layer, event.currentTarget.value || null); close(); }}>
                    <option value="">None</option>
                    {layers.filter((candidate) => candidate.id !== layer.id && !wouldCreateParentCycle(layer.id, candidate.id)).map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => { onToggleModes?.(); close(); }}>Switches</button>
                <button type="button" onClick={() => {
                  const index = layers.findIndex((item) => item.id === layer.id);
                  if (index > 0) onUpdateLayers({}, layers.map((item) => item.id).map((id, i, ids) => i === index ? ids[index - 1] : i === index - 1 ? ids[index] : id));
                  close();
                }}>Bring Forward</button>
                <button type="button" onClick={() => {
                  const index = layers.findIndex((item) => item.id === layer.id);
                  if (index >= 0 && index < layers.length - 1) onUpdateLayers({}, layers.map((item) => item.id).map((id, i, ids) => i === index ? ids[index + 1] : i === index + 1 ? ids[index] : id));
                  close();
                }}>Send Backward</button>
                <button type="button" onClick={() => { commitLayerPatch(layer.id, { locked: !layer.locked }); close(); }}>{layer.locked ? 'Unlock' : 'Lock'}</button>
                <button type="button" onClick={() => { onToggleSolo?.(layer.id); close(); }}>Solo</button>
                <button type="button" disabled={layer.locked} onClick={() => { commitLayerPatch(layer.id, { shy: !layer.shy }); close(); }}>{layer.shy ? 'Unhide from list' : 'Shy'}</button>
              </>;
            })() : <>
              <strong>New</strong>
              <button type="button" onClick={() => createLayer('solid')}>Solid...</button>
              <button type="button" onClick={() => createLayer('text')}>Text</button>
              <button type="button" onClick={() => createLayer('shape')}>Shape Layer</button>
              <button type="button" onClick={() => createLayer('null')}>Null Object</button>
              <button type="button" onClick={() => createLayer('adjustment')}>Adjustment Layer</button>
            </>}
          </div>,
          document.body,
        )}
      </div>

      <div
        className="tl-time-scroll"
        ref={timeRef}
        onScroll={handleTimeScroll}
      >
        <div
          className="tl-track-scroll"
          tabIndex={0}
          onKeyDown={handleTimelineKeyDown}
          onPointerDown={beginMarquee}
        >
          {displayLayers.map((layer) => {
            const selected = layer.id === selectedLayerId || selectedIdsRef.current.includes(layer.id);
            const expanded = selected;
            const labelClass = getLayerLabelClass(layer);
            const missing = Boolean(layer.sourceId && missingMediaIds.includes(layer.sourceId));
            const start = getLayerStart(layer);
            const barStyle = {
              left: `${start * pixelsPerSecond}px`,
              width: `${getLayerDuration(layer, duration) * pixelsPerSecond}px`,
            } as CSSProperties;

            return (
              <Fragment key={layer.id}>
                <div
                  className={`tl-track-layer-row ${selected ? 'is-selected' : ''}`}
                  data-layer-id={layer.id}
                >
                  <span
                    className={`tl-layer-bar ${labelClass} ${selected ? 'bar-selected' : ''} ${missing ? 'is-missing-footage' : ''}`}
                    style={barStyle}
                    title={missing ? `Missing footage: ${layer.name}` : layer.name}
                    onPointerDown={(event) => beginLayerBarDrag(event, layer)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      openLayerMenu(event.clientX, event.clientY, layer.id);
                    }}
                  />
                  <span
                    className="tl-layer-edge tl-layer-edge-left"
                    style={{ left: `${start * pixelsPerSecond}px` }}
                    data-edge="left"
                    aria-label={`Trim ${layer.name} in point`}
                    onPointerDown={(event) => beginLayerBarDrag(event, layer)}
                  />
                  <span
                    className="tl-layer-edge tl-layer-edge-right"
                    style={{ left: `${(start + getLayerDuration(layer, duration)) * pixelsPerSecond - 6}px` }}
                    data-edge="right"
                    aria-label={`Trim ${layer.name} out point`}
                    onPointerDown={(event) => beginLayerBarDrag(event, layer)}
                  />
                </div>
                {expanded && (
                  <>
                    <div className="tl-track-property-row tl-transform-track" />
                    {getProperties(layer).map((property) => {
                      const keyframes = property.animationNames.flatMap((name) =>
                        animationMap.get(layer.id)?.properties[name]?.keyframes.map((keyframe) => ({
                          keyframe,
                          propertyName: name,
                        })) ?? [],
                      );
                      return (
                        <div
                          className="tl-track-property-row"
                          data-layer-id={layer.id}
                          key={property.label}
                        >
                          {keyframes.map(({ keyframe, propertyName }) => {
                            const keyframeStyle = {
                              left: `${keyframe.time * pixelsPerSecond}px`,
                            } as CSSProperties;
                            const interpolation =
                              keyframe.interpolation === 'hold'
                                ? 'is-hold'
                                : keyframe.interpolation.startsWith('ease')
                                  ? 'is-ease'
                                  : '';

                            return (
                              <button
                                type="button"
                                className={`tl-keyframe ${interpolation} ${selectedKeyframes.some((target) => target.layerId === layer.id && target.propertyName === propertyName && target.keyframeId === keyframe.id) ? 'is-selected' : ''}`}
                                style={keyframeStyle}
                                key={keyframe.id}
                                title={`${keyframe.time.toFixed(2)}s`}
                                aria-label={`${property.label} keyframe at ${keyframe.time.toFixed(2)} seconds`}
                                data-keyframe-id={keyframe.id}
                                data-property-name={propertyName}
                                data-layer-id={layer.id}
                                onPointerDown={(event) => beginKeyframeDrag(event, {
                                  layerId: layer.id,
                                  propertyName,
                                  keyframeId: keyframe.id,
                                }, keyframe.time)}
                                onPointerMove={moveKeyframeDrag}
                                onPointerUp={(event) => finishKeyframeDrag(event, false)}
                                onPointerCancel={(event) => finishKeyframeDrag(event, true)}
                                onContextMenu={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const target = { layerId: layer.id, propertyName, keyframeId: keyframe.id };
                                  selectedKeyframesRef.current = [target];
                                  setSelectedKeyframes([target]);
                                  setKeyframeContextMenu({ x: event.clientX, y: event.clientY, target });
                                }}
                                onDoubleClick={(event) => {
                                  event.preventDefault();
                                  const bounds = event.currentTarget.getBoundingClientRect();
                                  setKeyframeContextMenu({
                                    x: bounds.left,
                                    y: bounds.bottom,
                                    target: { layerId: layer.id, propertyName, keyframeId: keyframe.id },
                                  });
                                }}
                              />
                            );
                          })}
                        </div>
                      );
                    })}
                  </>
                )}
              </Fragment>
            );
          })}
          <div className="tl-playhead-line" style={{ left: `${currentTime * pixelsPerSecond}px` }}>
            <span className="tl-playhead-triangle" />
          </div>
          {marquee && <div className="tl-marquee" style={marquee} />}
          {dragTooltip && (
            <div className="tl-drag-tooltip" style={{ left: dragTooltip.x, top: dragTooltip.y }}>
              {dragTooltip.text}
            </div>
          )}
          {insertionLine !== null && (
            <div className="tl-insertion-line" style={{ top: insertionLine - (timeRef.current?.getBoundingClientRect().top ?? 0) + (timeRef.current?.scrollTop ?? 0) }} />
          )}
          {keyframeContextMenu && (
            <label
              className="tl-keyframe-menu"
              style={{ left: keyframeContextMenu.x, top: keyframeContextMenu.y }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              Interpolation
              <select
                aria-label="Keyframe interpolation"
                value={getKeyframe(keyframeContextMenu.target)?.interpolation ?? 'linear'}
                onChange={(event) => updateSelectedKeyframesInterpolation(
                  event.currentTarget.value as Keyframe['interpolation'],
                )}
              >
                <option value="linear">Linear</option>
                <option value="hold">Hold</option>
                <option value="ease-in">Ease In</option>
                <option value="ease-out">Ease Out</option>
                <option value="ease-in-out">Easy Ease</option>
              </select>
            </label>
          )}
        </div>
      </div>
    </div>
  );
}
