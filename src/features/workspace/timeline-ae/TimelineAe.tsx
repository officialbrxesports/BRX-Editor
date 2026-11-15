import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  ChevronDown,
  Circle,
  Copy,
  Eye,
  Hash,
  Lock,
  Maximize2,
  Menu,
  Minimize2,
  PanelLeftClose,
  PanelRightClose,
  Scissors,
  Search,
  Tag,
  Trash2,
  Volume2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

import type {
  AnimatedPropertyName,
  EditorLayerProperties,
  Keyframe,
  LayerAnimation,
} from '../../project/project.types';
import TimelineRows from './TimelineRows';
import type { MenuRequest } from '../WorkspaceMenus';
import TimelineRuler from './TimelineRuler';
import './timeline-ae.css';
import './timeline-ae-footer.css';
import './timeline-ae-layers.css';
import './timeline-ae-properties.css';
import './timeline-ae-ruler.css';

type TimelineAeProps = {
  projectId: string;
  projectName: string;
  layers: EditorLayerProperties[];
  animations: LayerAnimation[];
  selectedLayerId: string | null;
  currentTime: number;
  duration: number;
  fps: number;
  zoom: number;
  snapping: boolean;
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
  onDeleteLayers: (layerIds: string[]) => void;
  onDuplicateLayers: (layerIds: string[]) => void;
  onGroupLayers: (layerIds: string[]) => void;
  onUngroupLayers: (layerIds: string[]) => void;
  onSplitLayers: (layerIds: string[], time: number) => void;
  onSelectLayer: (layerId: string | null) => void;
  onOpenContextMenu?: (request: MenuRequest) => void;
  bookmarks?: Array<{ id: string; time: number }>;
  onZoomChange: (zoom: number) => void;
  onCreateLayer: (type: EditorLayerProperties['type']) => void;
  missingMediaIds?: string[];
  onToggleVisibility?: (layerId: string) => void;
  onToggleAudio?: (layerId: string) => void;
  onToggleSolo?: (layerId: string) => void;
  onSeekTime?: (time: number) => void;
  isMaximized?: boolean;
  onToggleMaximize?: () => void;
  sourceNames?: Record<string, string>;
  sourceThumbnails?: Record<string, string>;
  showModes?: boolean;
  frameBlendingEnabled?: boolean;
  motionBlurEnabled?: boolean;
  onToggleFrameBlending?: () => void;
  onToggleMotionBlur?: () => void;
};

const switchHeaders = [
  ['Shy', '◉'],
  ['Collapse Transformations', '☼'],
  ['Quality', '╱'],
  ['Effects', 'fx'],
  ['Frame Blending', '▧'],
  ['Motion Blur', '◉'],
  ['Adjustment Layer', '◩'],
  ['3D Layer', '3D'],
];

const optionalColumns = [
  { key: 'in', label: 'In', width: '54px' },
  { key: 'out', label: 'Out', width: '54px' },
  { key: 'duration', label: 'Duration', width: '62px' },
  { key: 'stretch', label: 'Stretch', width: '58px' },
  { key: 'keys', label: 'Keys', width: '42px' },
  { key: 'comments', label: 'Comments', width: '100px' },
] as const;

type ColumnResize = {
  pointerId: number;
  columnIndex: number;
  startX: number;
  startWidth: number;
  widths: number[];
};

function formatTimecode(time: number, fps: number) {
  const safeFps = Math.max(1, Math.round(fps));
  const totalFrames = Math.floor(Math.max(0, time) * safeFps);
  const frame = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  return `${hours}:${String(minutes).padStart(2, '0')}:${String(
    seconds,
  ).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
}

function getAnimatedCount(animations: LayerAnimation[]) {
  return animations.reduce(
    (count, animation) =>
      count +
      Object.values(animation.properties).reduce(
        (propertyCount, property) =>
          propertyCount + property.keyframes.length,
        0,
      ),
    0,
  );
}

function sendTimelineCommand(command: string) {
  window.dispatchEvent(
    new CustomEvent('brx-timeline-command', { detail: { command } }),
  );
}

export default function TimelineAe({
  projectId,
  projectName,
  layers,
  animations,
  selectedLayerId,
  currentTime,
  duration,
  fps,
  zoom,
  snapping,
  onBeginLayerEdit,
  onUpdateLayers,
  onAddKeyframe,
  onUpdateKeyframe,
  onDeleteKeyframe,
  onDeleteLayers,
  onDuplicateLayers,
  onGroupLayers,
  onUngroupLayers,
  onSplitLayers,
  onSelectLayer,
  onOpenContextMenu,
  bookmarks = [],
  onZoomChange,
  onCreateLayer,
  missingMediaIds = [],
  onToggleVisibility,
  onToggleAudio,
  onToggleSolo,
  onSeekTime,
  isMaximized = false,
  onToggleMaximize,
  sourceNames = {},
  sourceThumbnails = {},
  frameBlendingEnabled = false,
  motionBlurEnabled = false,
  onToggleFrameBlending,
  onToggleMotionBlur,
}: TimelineAeProps) {
  const [scrollLeft, setScrollLeft] = useState(0);
  const [hideShy, setHideShy] = useState(false);
  const [sourceNameMode, setSourceNameMode] = useState<'source' | 'layer'>('source');
  const [showModes, setShowModes] = useState(true);
  const [visibleExtraColumns, setVisibleExtraColumns] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(`brx-editor-timeline-extra-columns-${projectId}`);
      if (!saved) return [];
      const parsed: unknown = JSON.parse(saved);
      return Array.isArray(parsed) && parsed.every((key) => optionalColumns.some((column) => column.key === key))
        ? parsed as string[]
        : [];
    } catch (error) {
      console.error('Unable to restore timeline columns', error);
      return [];
    }
  });
  const [columnMenu, setColumnMenu] = useState<{ x: number; y: number } | null>(null);
  const columnStorageKey = `brx-editor-timeline-columns-${projectId}`;
  const [columnWidths, setColumnWidths] = useState<number[] | null>(() => {
    try {
      const saved = localStorage.getItem(columnStorageKey);
      if (!saved) return null;
      const parsed: unknown = JSON.parse(saved);
      return Array.isArray(parsed) &&
        parsed.length >= 19 &&
        parsed.length <= 25 &&
        parsed.every((width) => typeof width === 'number' && Number.isFinite(width) && width >= 10)
        ? parsed
        : null;
    } catch (error) {
      console.error('Unable to restore timeline column widths', error);
      return null;
    }
  });
  useEffect(() => {
    localStorage.setItem(`brx-editor-timeline-extra-columns-${projectId}`, JSON.stringify(visibleExtraColumns));
  }, [projectId, visibleExtraColumns]);
  const columnResizeRef = useRef<ColumnResize | null>(null);
  const safeDuration = Math.max(1, duration);
  const pixelsPerSecond = 60 * (zoom / 100);
  const timelineWidth = Math.max(900, safeDuration * pixelsPerSecond);
  const panelStyle = {
    '--tl-timeline-width': `${timelineWidth}px`,
    '--tl-playhead-left': `${currentTime * pixelsPerSecond}px`,
    ...(columnWidths
      ? {
          '--tl-columns': [
            ...columnWidths.slice(0, 19).map((width) => `${width}px`),
            ...visibleExtraColumns.map((key, index) => {
              const column = optionalColumns.find((item) => item.key === key);
              return `${columnWidths[19 + index] ?? Number.parseInt(column?.width ?? '54px', 10)}px`;
            }),
          ].join(' '),
        }
      : visibleExtraColumns.length
        ? { '--tl-columns': `16px 16px 16px 16px 20px 20px minmax(72px, 1fr) 14px 14px 14px 14px 14px 14px 14px 14px 74px 17px 62px 104px ${visibleExtraColumns.map((key) => optionalColumns.find((column) => column.key === key)?.width).join(' ')}` }
        : {}),
  } as CSSProperties;
  useEffect(() => {
    if (!columnWidths) return;
    try {
      localStorage.setItem(columnStorageKey, JSON.stringify(columnWidths));
    } catch (error) {
      console.error('Unable to save timeline column widths', error);
    }
  }, [columnStorageKey, columnWidths]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'F4') return;
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setShowModes((value) => !value);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const beginColumnResize = (event: PointerEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const cell = target.closest('.tl-layer-head > span');
    const header = event.currentTarget;
    if (!(cell instanceof HTMLElement) || !header.contains(cell)) return;

    const bounds = cell.getBoundingClientRect();
    if (event.clientX < bounds.right - 5) return;

    const children = Array.from(header.children);
    const columnIndex = children.indexOf(cell);
    if (columnIndex < 0) return;

    const widths = children.map((child) => child.getBoundingClientRect().width);
    event.preventDefault();
    header.setPointerCapture(event.pointerId);
    columnResizeRef.current = {
      pointerId: event.pointerId,
      columnIndex,
      startX: event.clientX,
      startWidth: widths[columnIndex],
      widths,
    };
  };
  const moveColumnResize = (event: PointerEvent<HTMLDivElement>) => {
    const resize = columnResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;

    const widths = [...resize.widths];
    widths[resize.columnIndex] = Math.max(
      14,
      resize.startWidth + event.clientX - resize.startX,
    );
    setColumnWidths(widths);
  };
  const endColumnResize = (event: PointerEvent<HTMLDivElement>) => {
    if (columnResizeRef.current?.pointerId !== event.pointerId) return;
    columnResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <section className={`tl-ae-panel ${showModes ? 'is-modes-view' : 'is-switches-view'}`} style={panelStyle}>
      <div className="tl-tabs">
        <button className="tl-close-tab" type="button" aria-label="Close timeline">
          <X size={12} />
        </button>
        <button
          className="tl-comp-tab is-active"
          type="button"
          onDoubleClick={onToggleMaximize}
        >
          <span className="tl-comp-color" />
          <span>{projectName}</span>
          <Menu size={11} />
        </button>
        <button
          className="tl-maximize"
          type="button"
          title={isMaximized ? 'Restore timeline' : 'Maximize timeline'}
          aria-label={isMaximized ? 'Restore timeline' : 'Maximize timeline'}
          onClick={onToggleMaximize}
        >
          {isMaximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>
      </div>

      <div className="tl-controls">
        <button className="tl-timecode" type="button" title="Current time">
          <strong>{formatTimecode(currentTime, fps)}</strong>
          <small>
            {String(Math.floor(Math.max(0, currentTime) * fps)).padStart(5, '0')}{' '}
            ({fps.toFixed(2)} fps)
          </small>
        </button>
        <label className="tl-search">
          <Search size={12} />
          <input type="search" aria-label="Search timeline layers" />
          <ChevronDown size={11} />
        </label>
        <div className="tl-edit-tools">
          <button
            type="button"
            title="Split layer at playhead (S or Ctrl+Shift+D)"
            aria-label="Split layer at playhead"
            disabled={selectedLayerId === null}
            onClick={() => sendTimelineCommand('split')}
          >
            <Scissors size={13} />
          </button>
          <button
            type="button"
            title="Cut Left: trim start to playhead (Alt+[)"
            aria-label="Cut left"
            disabled={selectedLayerId === null}
            onClick={() => sendTimelineCommand('cut-left')}
          >
            <ArrowLeftToLine size={13} />
          </button>
          <button
            type="button"
            title="Cut Right: trim end to playhead (Alt+])"
            aria-label="Cut right"
            disabled={selectedLayerId === null}
            onClick={() => sendTimelineCommand('cut-right')}
          >
            <ArrowRightToLine size={13} />
          </button>
          <button
            type="button"
            title="Duplicate layer (Ctrl+D)"
            aria-label="Duplicate layer"
            disabled={selectedLayerId === null}
            onClick={() => sendTimelineCommand('duplicate')}
          >
            <Copy size={13} />
          </button>
          <button
            type="button"
            title="Delete layer (Delete)"
            aria-label="Delete layer"
            disabled={selectedLayerId === null}
            onClick={() => sendTimelineCommand('delete')}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <div className="tl-tools">
          <button type="button" title="Composition Mini-Flowchart">⌘</button>
          <button type="button" title="Draft 3D">3D</button>
          <button type="button" title="Hide Shy Layers" aria-pressed={hideShy} onClick={() => setHideShy((value) => !value)}>◉</button>
          <button type="button" title="Frame Blending master" aria-pressed={frameBlendingEnabled} onClick={onToggleFrameBlending}>▧</button>
          <button type="button" title="Motion Blur master" aria-pressed={motionBlurEnabled} onClick={onToggleMotionBlur}>◌</button>
          <button type="button" title="Graph Editor">⌁</button>
        </div>
      </div>

      <div className="tl-grid-head">
        <div
          className="tl-layer-head"
          onPointerDown={beginColumnResize}
          onPointerMove={moveColumnResize}
          onPointerUp={endColumnResize}
          onPointerCancel={endColumnResize}
          onContextMenu={(event) => {
            event.preventDefault();
            const bounds = event.currentTarget.closest('.tl-ae-panel')?.getBoundingClientRect();
            if (!bounds) return;
            setColumnMenu({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
          }}
        >
          <span title="Video"><Eye size={11} /></span>
          <span title="Audio"><Volume2 size={11} /></span>
          <span title="Solo"><Circle size={10} /></span>
          <span title="Lock"><Lock size={10} /></span>
          <span title="Label"><Tag size={11} /></span>
          <span title="Layer number"><Hash size={10} /></span>
          <span className="tl-source-heading" onClick={() => setSourceNameMode((value) => value === 'source' ? 'layer' : 'source')} onContextMenu={(event) => event.preventDefault()}>
            <button type="button" className="tl-heading-text" title="Toggle Source Name / Layer Name">{sourceNameMode === 'source' ? 'Source Name' : 'Layer Name'}</button>
          </span>
          {switchHeaders.map(([title, icon]) => (
            <span className="tl-small-heading" title={title} key={title}>
              {icon}
            </span>
          ))}
          <span className="tl-mode-heading">
            <span className="tl-heading-text">Mode</span>
          </span>
          <span title="Preserve transparency">T</span>
          <span className="tl-track-heading">
            <span className="tl-heading-text">TrkMat</span>
          </span>
          <span className="tl-parent-heading">
            <span className="tl-heading-text">Parent &amp; Link</span>
          </span>
          {visibleExtraColumns.map((key) => {
            const column = optionalColumns.find((item) => item.key === key);
            return column ? <span className="tl-small-heading" key={key}>{column.label}</span> : null;
          })}
        </div>
        <TimelineRuler
          currentTime={currentTime}
          duration={safeDuration}
          fps={fps}
          pixelsPerSecond={pixelsPerSecond}
          timelineWidth={timelineWidth}
          scrollLeft={scrollLeft}
          onSeekTime={onSeekTime}
          bookmarks={bookmarks}
          onOpenContextMenu={onOpenContextMenu}
        />
      </div>

      <TimelineRows
        layers={layers}
        missingMediaIds={missingMediaIds}
        onToggleVisibility={onToggleVisibility}
        onToggleAudio={onToggleAudio}
        onToggleSolo={onToggleSolo}
        sourceNames={sourceNames}
        sourceThumbnails={sourceThumbnails}
        sourceNameMode={sourceNameMode}
        hideShy={hideShy}
        animations={animations}
        selectedLayerId={selectedLayerId}
        currentTime={currentTime}
        duration={safeDuration}
        pixelsPerSecond={pixelsPerSecond}
        zoom={zoom}
        onZoomChange={onZoomChange}
        fps={fps}
        snapping={snapping}
        onBeginLayerEdit={onBeginLayerEdit}
        onUpdateLayers={onUpdateLayers}
        onAddKeyframe={onAddKeyframe}
        onUpdateKeyframe={onUpdateKeyframe}
        onDeleteKeyframe={onDeleteKeyframe}
        onSeekTime={onSeekTime ?? (() => undefined)}
        onDeleteLayers={onDeleteLayers}
        onDuplicateLayers={onDuplicateLayers}
        onGroupLayers={onGroupLayers}
        onUngroupLayers={onUngroupLayers}
        onSplitLayers={onSplitLayers}
        onSelectLayer={onSelectLayer}
        onOpenContextMenu={onOpenContextMenu}
        onScrollLeft={setScrollLeft}
        onCreateLayer={onCreateLayer}
        visibleExtraColumns={visibleExtraColumns}
        onToggleModes={() => setShowModes((value) => !value)}
      />

      <footer className="tl-footer">
        <div className="tl-footer-tools">
          <button type="button" title="Collapse left pane"><PanelLeftClose size={12} /></button>
          <button type="button" title="Collapse right pane"><PanelRightClose size={12} /></button>
          <button type="button" title="Expand properties">⌘</button>
          <button type="button" title="Timeline settings">⚙</button>
        </div>
        <span className="tl-render-time">Frame Render Time&nbsp; <b>0ms</b></span>
        <button className="tl-toggle-modes" type="button" aria-pressed={showModes} onClick={() => setShowModes((value) => !value)}>
          {showModes ? 'Show Switches' : 'Show Modes'}
        </button>
        <div className="tl-zoom">
          <ZoomOut size={12} />
          <input
            type="range"
            min="25"
            max="400"
            value={zoom}
            aria-label="Timeline zoom"
            onChange={(event) => onZoomChange(Number(event.currentTarget.value))}
          />
          <ZoomIn size={12} />
          <span>{Math.round(zoom)}%</span>
        </div>
      </footer>

      {columnMenu && (
        <div className="tl-column-chooser" style={{ left: columnMenu.x, top: columnMenu.y }}>
          <strong>Columns</strong>
          {optionalColumns.map((column) => (
            <label key={column.key}>
              <input
                type="checkbox"
                checked={visibleExtraColumns.includes(column.key)}
                onChange={(event) => setVisibleExtraColumns((current) => event.target.checked
                  ? [...current, column.key]
                  : current.filter((key) => key !== column.key))}
              />
              {column.label}
            </label>
          ))}
          <button type="button" onClick={() => setColumnMenu(null)}>Done</button>
        </div>
      )}

      <span className="tl-a11y-count" aria-live="polite">
        {layers.length} layers, {getAnimatedCount(animations)} keyframes
      </span>
    </section>
  );
}
