
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { DragEvent } from 'react';

import PreviewPanel from './components/PreviewPanel';
import TimelineAe from './timeline-ae/TimelineAe';
import WorkspaceSplitter from './components/WorkspaceSplitter';
import { deleteMediaBlob, loadMediaBlob, prepareMediaFile } from './mediaStore';

import {
  AeMenuBar,
  AeToolsBar,
  ProjectPanel,
  RightPanelStack,
} from './components/WorkspacePanels';

import type {
  AnimatedPropertyName,
  EditorLayerProperties,
  EditorTool,
  Project,
} from '../project/project.types';

import { useWorkspace } from '../../hooks/useWorkspace';
import WorkspaceMenus, { type MenuRequest } from './WorkspaceMenus';
import { isTypingTarget } from '../../utils/shortcuts';

import './Workspace.css';
import '../../styles/ae-theme.css';

type WorkspaceProps = {
  project?: Project;
  projectName?: string;
  onBack?: () => void;
  onSave?: () => void;
  onExport?: () => void;
};

const MEDIA_ACCEPT =
  '.png,.jpg,.jpeg,.webp,.gif,.svg,.mp4,.webm,.mov,.mp3,.wav,.ogg,.m4a';

export default function Workspace({
  project,
  projectName,
  onBack,
  onSave,
  onExport,
}: WorkspaceProps) {
  const [isMuted, setIsMuted] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(() => {
    const saved = Number(localStorage.getItem('brx-editor-timeline-height'));
    return Number.isFinite(saved) && saved >= 120 ? saved : 270;
  });
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('brx-editor-left-panel-width'));
    return Number.isFinite(saved) && saved >= 190 ? saved : 270;
  });
  const [rightPanelWidth, setRightPanelWidth] = useState(() => {
    const saved = Number(localStorage.getItem('brx-editor-right-panel-width'));
    return Number.isFinite(saved) && saved >= 205 ? saved : 270;
  });
  const [compactViewport, setCompactViewport] = useState(() => window.innerWidth <= 680);
  const [timelineMaximized, setTimelineMaximized] = useState(false);
  const [snapping, setSnapping] = useState(true);
  const [frameBlendingEnabled, setFrameBlendingEnabled] = useState(false);
  const [motionBlurEnabled, setMotionBlurEnabled] = useState(false);
  const [filePickerAccept, setFilePickerAccept] = useState(MEDIA_ACCEPT);
  const [importToTimeline, setImportToTimeline] = useState(false);
  const [mediaUrls, setMediaUrls] = useState<Record<string, string>>({});
  const [missingMediaIds, setMissingMediaIds] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const filePickerRef = useRef<HTMLInputElement>(null);
  const timelinePointerRef = useRef(false);
  const mediaUrlsRef = useRef(new Map<string, string>());
  const editor = useWorkspace({
    project: project
      ? {
          ...project,
          name: projectName ?? project.name,
        }
      : undefined,
  });
  const workspaceStyle: CSSProperties = {
    gridTemplateRows: `29px 36px minmax(0, 1fr) 6px ${timelineHeight}px 22px`,
    '--timeline-height': `${timelineHeight}px`,
    gridTemplateColumns: 'minmax(0, 1fr)',
  } as CSSProperties;
  const panelWidths = `minmax(190px, ${leftPanelWidth}px) 6px minmax(300px, 1fr) 6px minmax(205px, ${rightPanelWidth}px)`;

  const openMediaPicker = useCallback((accept = MEDIA_ACCEPT, addToTimeline = false) => {
    setFilePickerAccept(accept);
    setImportToTimeline(addToTimeline);
    if (filePickerRef.current) {
      filePickerRef.current.accept = accept;
      filePickerRef.current.click();
    }
  }, []);

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3500);
  }, []);

  const [menuRequest, setMenuRequest] = useState<MenuRequest | null>(null);
  const closeMenu = useCallback(() => setMenuRequest(null), []);

  const selectionRef = useRef<{ ids: string[]; keyframes: number }>({
    ids: [],
    keyframes: 0,
  });
  const editorRef = useRef(editor);

  useEffect(() => {
    editorRef.current = editor;
  });

  // The timeline reports its selection, and asks for messages, through events.
  useEffect(() => {
    const onSelection = (event: Event) => {
      const detail = (event as CustomEvent<{ ids: string[]; keyframes: number }>).detail;

      if (detail) {
        selectionRef.current = detail;
      }
    };

    const onNotify = (event: Event) => {
      const message = (event as CustomEvent<string>).detail;

      if (message) {
        notify(message);
      }
    };

    window.addEventListener('brx-selection', onSelection);
    window.addEventListener('brx-notify', onNotify);

    return () => {
      window.removeEventListener('brx-selection', onSelection);
      window.removeEventListener('brx-notify', onNotify);
    };
  }, [notify]);

  // Desktop shortcuts (ignored while typing): Ctrl+C / X / V / D / G,
  // Ctrl+Shift+G, S = split, M = bookmark, Left / Right = one frame
  // (Shift = ten frames). Space, Home, End, Delete and Ctrl+A live elsewhere.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target) || document.querySelector('.cm-root')) {
        return;
      }

      const api = editorRef.current;
      const { ids: selected, keyframes } = selectionRef.current;
      const ids =
        selected.length > 0
          ? selected
          : api.selectedLayerId
            ? [api.selectedLayerId]
            : [];
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      const handled = () => {
        event.preventDefault();
        event.stopImmediatePropagation();
      };

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (modifier || event.altKey) return;

        handled();
        const step = (event.shiftKey ? 10 : 1) / Math.max(1, api.fps);
        api.seekTimeline(
          api.getCurrentTime() + (event.key === 'ArrowRight' ? step : -step),
        );
        return;
      }

      if (event.repeat) return;

      if (modifier && !event.altKey) {
        // Selected keyframes keep their own copy and paste in the timeline.
        if (keyframes > 0 && (key === 'c' || key === 'x' || key === 'v')) return;

        if (key === 'c' && !event.shiftKey && ids.length > 0) {
          if (window.getSelection()?.toString()) return;
          handled();
          api.copyLayers(ids);
        } else if (key === 'x' && !event.shiftKey && ids.length > 0) {
          handled();
          api.cutLayers(ids);
        } else if (key === 'v' && !event.shiftKey && api.clipboardCount > 0) {
          handled();
          api.pasteLayers();
        } else if (key === 'd' && !event.shiftKey && ids.length > 0) {
          handled();
          api.duplicateLayers(ids);
        } else if (key === 'g' && ids.length > 0) {
          handled();
          if (event.shiftKey) {
            api.ungroupLayers(ids);
          } else {
            api.groupLayers(ids);
          }
        }

        return;
      }

      if (modifier || event.altKey || event.shiftKey) return;

      if (key === 's' && ids.length > 0) {
        handled();
        api.splitLayers(ids, api.getCurrentTime());
      } else if (key === 'm') {
        handled();
        api.toggleBookmark();
      }
    };

    window.addEventListener('keydown', onKeyDown, true);

    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, []);

  const menuExtras = {
    snapping,
    toggleSnapping: () => setSnapping((value) => !value),
    openMediaPicker: () => openMediaPicker(),
    getSelection: () => selectionRef.current.ids,
  };

  const importMediaFiles = useCallback(
    async (files: File[], addToTimeline = false) => {
      let historyRecorded = false;
      for (const file of files) {
        try {
          const item = await prepareMediaFile(file, editor.fps);
          editor.importFootage(item, !historyRecorded);
          historyRecorded = true;
          if (addToTimeline) editor.addMediaLayer(item, false);
        } catch (error) {
          notify(error instanceof Error ? error.message : `Unable to import ${file.name}`);
        }
      }
    },
    [editor.addMediaLayer, editor.fps, editor.importFootage, notify],
  );

  const handleDropFiles = useCallback(
    (event: DragEvent<HTMLElement>) => {
      const files = Array.from(event.dataTransfer.files);
      if (!files.length) return;
      event.preventDefault();
      void importMediaFiles(files, true);
    },
    [importMediaFiles],
  );

  const deleteProjectItem = useCallback(
    async (item: (typeof editor.projectItems)[number]) => {
      editor.deleteUnusedProjectItem(item.id);
      if (!item.mediaType) return;
      try {
        await deleteMediaBlob(item.id);
      } catch (error) {
        notify(error instanceof Error ? error.message : `Unable to remove ${item.name}`);
      }
    },
    [editor.deleteUnusedProjectItem, notify],
  );

  useEffect(() => {
    let cancelled = false;
    const loadMedia = async () => {
      const urls: Record<string, string> = {};
      const missing: string[] = [];
      const activeIds = new Set(
        editor.projectItems
          .filter((item) => item.mediaType)
          .map((item) => item.id),
      );
      for (const [mediaId, url] of mediaUrlsRef.current) {
        if (activeIds.has(mediaId)) {
          urls[mediaId] = url;
        } else {
          URL.revokeObjectURL(url);
          mediaUrlsRef.current.delete(mediaId);
        }
      }
      for (const item of editor.projectItems) {
        if (!item.mediaType) continue;
        if (mediaUrlsRef.current.has(item.id)) continue;
        try {
          const blob = await loadMediaBlob(item.id);
          if (!blob) {
            missing.push(item.id);
          } else if (cancelled) {
            continue;
          } else {
            const url = URL.createObjectURL(blob);
            mediaUrlsRef.current.set(item.id, url);
            urls[item.id] = url;
          }
        } catch (error) {
          console.error(`Unable to restore media ${item.name}`, error);
          missing.push(item.id);
        }
      }
      if (!cancelled) {
        setMediaUrls(urls);
        setMissingMediaIds(missing);
      }
    };
    void loadMedia();
    return () => { cancelled = true; };
  }, [editor.projectItems]);

  useEffect(() => () => {
    for (const url of mediaUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    mediaUrlsRef.current.clear();
  }, []);

  useEffect(() => {
    localStorage.setItem('brx-editor-timeline-height', String(timelineHeight));
    localStorage.setItem('brx-editor-left-panel-width', String(leftPanelWidth));
    localStorage.setItem('brx-editor-right-panel-width', String(rightPanelWidth));
  }, [timelineHeight, leftPanelWidth, rightPanelWidth]);

  useEffect(() => {
    const updateViewport = () => setCompactViewport(window.innerWidth <= 680);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (timelineMaximized && (event.key === 'Escape' || event.code === 'Backquote')) {
        event.preventDefault();
        setTimelineMaximized(false);
      } else if (!timelineMaximized && event.code === 'Backquote' && timelinePointerRef.current) {
        event.preventDefault();
        setTimelineMaximized(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [timelineMaximized]);

  // SAVE

  const handleSave = useCallback(() => {
    onSave?.();
    editor.markSaved();
  }, [onSave, editor.markSaved]);

  // KEYBOARD SHORTCUTS

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;

      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable;

      if (isTyping) return;

      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();

      if (!modifier && !event.altKey && key === 'y') {
        event.preventDefault();
        editor.selectTool('anchor');
        return;
      }

      if (modifier && !event.altKey && key === 'i') {
        event.preventDefault();
        openMediaPicker();
        return;
      }
      if (modifier && event.altKey && !event.shiftKey && key === 'f') {
        event.preventDefault();
        editor.fitSelectedLayer('comp');
        return;
      }
      // UNDO
      if (modifier && !event.shiftKey && key === 'z') {
        event.preventDefault();
        editor.undo();
        return;
      }

      // REDO
      if (
        (modifier && event.shiftKey && key === 'z') ||
        (modifier && event.shiftKey && key === 'y')
      ) {
        event.preventDefault();
        editor.redo();
        return;
      }

      if (modifier && !event.altKey && !event.shiftKey && key === 'y') {
        event.preventDefault();
        editor.addLayer('solid');
        return;
      }

      if (
        modifier &&
        event.altKey &&
        event.shiftKey &&
        key === 't'
      ) {
        event.preventDefault();
        editor.addLayer('text');
        return;
      }

      if (
        modifier &&
        event.altKey &&
        event.shiftKey &&
        key === 'y'
      ) {
        event.preventDefault();
        editor.addLayer('null');
        return;
      }

      if (
        modifier &&
        event.altKey &&
        !event.shiftKey &&
        key === 'y'
      ) {
        event.preventDefault();
        editor.addLayer('adjustment');
        return;
      }

      if (event.code === 'Space') {
        event.preventDefault();
        editor.togglePlayback();
        return;
      }

      if (event.key === 'Delete' && editor.selectedLayerId) {
        event.preventDefault();
        editor.deleteLayer();
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        editor.seekTimeline(0);
        return;
      }

      // GO TO END
      if (event.key === 'End') {
        event.preventDefault();
        editor.seekTimeline(editor.duration);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [
    editor.undo,
    editor.redo,
    editor.selectTool,
    editor.addLayer,
    editor.fitSelectedLayer,
    editor.togglePlayback,
    editor.selectedLayerId,
    editor.deleteLayer,
    editor.seekTimeline,
    editor.duration,
    openMediaPicker,
  ]);

  // TOOL HANDLING

  const handleToolChange = useCallback(
    (tool: EditorTool) => {
      editor.selectTool(tool);

      if (tool === 'select' || tool === 'hand' || tool === 'anchor') return;

      const type: EditorLayerProperties['type'] =
        tool === 'text'
          ? 'text'
          : 'shape';

      editor.addLayer(type);
    },
    [editor.selectTool, editor.addLayer],
  );

  // ANIMATED PREVIEW LAYERS

  const animatedLayers = editor.layers.map((layer) =>
    editor.getAnimatedLayer(layer),
  );

  // Used by the canvas while playing, so video/animation stay smooth
  // even though React state updates only ~15 times per second.
  const { layers: editorLayers, getAnimatedLayer } = editor;

  const resolveLayersAtTime = useCallback(
    (time: number) =>
      editorLayers.map((layer) => getAnimatedLayer(layer, time)),
    [editorLayers, getAnimatedLayer],
  );

  return (
    <main className={`brx-workspace ${timelineMaximized ? 'is-timeline-maximized' : ''}`} style={workspaceStyle}>
      <AeMenuBar
        projectName={editor.projectName}
        canUndo={editor.canUndo}
        canRedo={editor.canRedo}
        onBack={onBack}
        onSave={handleSave}
        onExport={onExport}
        onUndo={editor.undo}
        onRedo={editor.redo}
        onNewLayer={editor.addLayer}
        onFitToComp={editor.fitSelectedLayer}
        onImportMedia={() => openMediaPicker()}
      />

      <AeToolsBar
        activeTool={editor.activeTool}
        onToolChange={handleToolChange}
        snapping={snapping}
        onSnappingChange={setSnapping}
        onImportMedia={(kind) => {
          const accept = kind === 'image'
            ? '.png,.jpg,.jpeg,.webp,.gif,.svg'
            : '.mp4,.webm,.mov';
          openMediaPicker(accept, true);
        }}
      />

      <input
        ref={filePickerRef}
        className="workspace-file-picker"
        type="file"
        accept={filePickerAccept}
        multiple
        onChange={(event) => {
          const files = Array.from(event.currentTarget.files ?? []);
          void importMediaFiles(files, importToTimeline);
          event.currentTarget.value = '';
        }}
      />

      <div
        className="workspace-main"
        style={compactViewport ? undefined : { gridTemplateColumns: panelWidths }}
      >
        <ProjectPanel
          projectItems={editor.projectItems}
          layers={editor.layers}
          onRequestImport={() => openMediaPicker()}
          onImportFiles={(files) => { void importMediaFiles(files); }}
          onAddMediaLayer={editor.addMediaLayer}
          onDeleteItem={(item) => { void deleteProjectItem(item); }}
          mediaUrls={mediaUrls}
        />
        <WorkspaceSplitter
          axis="horizontal"
          value={leftPanelWidth}
          min={190}
          max={Math.max(320, window.innerWidth - rightPanelWidth - 360)}
          onChange={setLeftPanelWidth}
        />

        <section className="workspace-center">
          <div className="workspace-composition-header">
            <span>Composition</span>

            <span className="ae-blue-text">
              {editor.projectName}
            </span>
          </div>

          <div
            className="workspace-preview-area"
            data-media-dropzone="viewer"
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDropFiles}
          >
            <PreviewPanel
              width={editor.width}
              height={editor.height}
              fps={editor.fps}
              currentTime={editor.currentTime}
              isPlaying={editor.isPlaying}
              isMuted={isMuted}
              zoom={editor.previewZoom}
              backgroundColor={editor.backgroundColor}
              mediaUrls={mediaUrls}
              mediaThumbnails={Object.fromEntries(
                editor.projectItems.flatMap((item) =>
                  item.thumbnail ? [[item.id, item.thumbnail] as const] : [],
                ),
              )}
              missingMediaIds={missingMediaIds}
              masterMuted={isMuted}
              activeTool={editor.activeTool}
              layers={editor.layers}
              frameBlendingEnabled={frameBlendingEnabled}
              motionBlurEnabled={motionBlurEnabled}
              animatedLayers={animatedLayers}
              getCurrentTime={editor.getCurrentTime}
              resolveLayers={resolveLayersAtTime}
              selectedLayerId={editor.selectedLayerId}
              onSelectLayer={editor.selectLayer}
              onOpenContextMenu={setMenuRequest}
              onBeginLayerEdit={editor.beginLayerEdit}
              onLiveTransform={(layerId, updates, names = []) => {
                const animation = editor.animations.find((item) => item.layerId === layerId);
                const keyframeProperties = names.filter((name: AnimatedPropertyName) =>
                  (animation?.properties[name]?.keyframes.length ?? 0) > 0,
                );
                editor.updateLayers(
                  { [layerId]: updates },
                  undefined,
                  { keyframeProperties, time: editor.currentTime },
                );
              }}
              onTogglePlayback={editor.togglePlayback}
              onStopPlayback={() => {
                editor.stopPlayback();
                editor.seekTimeline(0);
              }}
              onToggleMute={() => setIsMuted((muted) => !muted)}
              onZoomChange={editor.updatePreviewZoom}
              onEditText={(layerId, text) => editor.updateLayer(layerId, { text })}
              onMediaDecodeError={(name) => notify(`Cannot decode ${name} in this browser`)}
            />
          </div>
        </section>

        <WorkspaceSplitter
          axis="horizontal"
          value={rightPanelWidth}
          min={205}
          max={Math.max(320, window.innerWidth - leftPanelWidth - 360)}
          onChange={setRightPanelWidth}
        />
        <RightPanelStack
          selectedLayer={editor.selectedLayer}
          onChange={editor.updateSelectedLayer}
          onLiveChange={(updates, keyframeProperties) => {
            if (editor.selectedLayerId) {
              editor.updateLayers(
                { [editor.selectedLayerId]: updates },
                undefined,
                { keyframeProperties, time: editor.currentTime },
              );
            }
          }}
          onBeginEdit={editor.beginLayerEdit}
          onFlip={(axis) => {
            if (editor.selectedLayerId) {
              editor.flipLayers([editor.selectedLayerId], axis);
            }
          }}
          currentTime={editor.currentTime}
          isPlaying={editor.isPlaying}
          isMuted={isMuted}
          zoom={editor.previewZoom}
          onTogglePlayback={editor.togglePlayback}
          onStopPlayback={() => {
            editor.stopPlayback();
            editor.seekTimeline(0);
          }}
          onToggleMute={() => setIsMuted((muted) => !muted)}
          onZoomChange={editor.updatePreviewZoom}
        />
      </div>

      {/* TIMELINE DOCK */}

      <WorkspaceSplitter
        axis="vertical"
        value={timelineHeight}
        min={120}
        max={Math.max(120, window.innerHeight - 200)}
        onChange={setTimelineHeight}
        onDoubleClick={() => setTimelineHeight((current) =>
          current >= window.innerHeight - 210 ? 270 : Math.max(120, window.innerHeight - 200),
        )}
      />

      <section
        className={`workspace-timeline-dock ${timelineMaximized ? 'is-maximized' : ''}`}
        data-media-dropzone="timeline"
        onDragOver={(event) => event.preventDefault()}
        onDrop={handleDropFiles}
        onPointerEnter={() => { timelinePointerRef.current = true; }}
        onPointerLeave={() => { timelinePointerRef.current = false; }}
      >
        <div className="workspace-active-timeline">
          <TimelineAe
              projectId={project?.id ?? 'default'}
              projectName={editor.projectName}
              layers={editor.layers}
              sourceNames={Object.fromEntries(editor.projectItems.map((item) => [item.id, item.name]))}
              sourceThumbnails={Object.fromEntries(
                editor.projectItems.flatMap((item) =>
                  item.thumbnail ? [[item.id, item.thumbnail] as const] : [],
                ),
              )}
              frameBlendingEnabled={frameBlendingEnabled}
              motionBlurEnabled={motionBlurEnabled}
              onToggleFrameBlending={() => setFrameBlendingEnabled((value) => !value)}
              onToggleMotionBlur={() => setMotionBlurEnabled((value) => !value)}
              animations={editor.animations}
              selectedLayerId={editor.selectedLayerId}
              currentTime={editor.currentTime}
              duration={editor.duration}
              fps={editor.fps}
              zoom={editor.timelineZoom}
              snapping={snapping}
              onBeginLayerEdit={editor.beginLayerEdit}
              onUpdateLayers={editor.updateLayers}
              onOpenContextMenu={setMenuRequest}
              bookmarks={editor.bookmarks}
              onAddKeyframe={editor.addKeyframe}
              onUpdateKeyframe={editor.updateKeyframe}
              onDeleteKeyframe={editor.deleteKeyframe}
              onDeleteLayers={editor.deleteLayers}
              onDuplicateLayers={editor.duplicateLayers}
              onGroupLayers={editor.groupLayers}
              onUngroupLayers={editor.ungroupLayers}
              onSplitLayers={editor.splitLayers}
              onSelectLayer={editor.selectLayer}
              onZoomChange={editor.updateTimelineZoom}
              onCreateLayer={editor.addLayer}
              missingMediaIds={missingMediaIds}
              onSeekTime={editor.seekTimeline}
              onToggleVisibility={(layerId) => {
                const layer = editor.layers.find((item) => item.id === layerId);
                if (layer) editor.updateLayer(layerId, { visible: layer.visible === false });
              }}
              onToggleAudio={(layerId) => {
                const layer = editor.layers.find((item) => item.id === layerId);
                if (layer) editor.updateLayer(layerId, { audioMuted: !layer.audioMuted });
              }}
              onToggleSolo={editor.toggleSoloLayer}
              isMaximized={timelineMaximized}
              onToggleMaximize={() => setTimelineMaximized((value) => !value)}
          />
        </div>
      </section>

      {/* STATUS BAR */}

      <footer className="workspace-statusbar">
        <span>BRX Editor</span>
        <span>{editor.width} × {editor.height}</span>
        <span>{editor.fps} FPS</span>
        <span>{editor.layers.length} Layers</span>
        <span>{editor.saveStatus}</span>
      </footer>
      {toast && <div className="workspace-toast" role="status" aria-live="polite">{toast}</div>}
      <WorkspaceMenus editor={editor} request={menuRequest} extras={menuExtras} notify={notify} onClose={closeMenu} />
    </main>
  );
}
