import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Copy,
  Eye,
  FlipHorizontal,
  FlipVertical,
  FolderPlus,
  Lock,
  Maximize2,
  Minimize2,
  RotateCw,
  Scissors,
  Trash2,
  Unlock,
  Volume2,
} from 'lucide-react';

import ContextMenu, {
  type ContextMenuItem,
} from '../../components/common/ContextMenu';
import type { useWorkspace } from '../../hooks/useWorkspace';
import { SHORTCUT } from '../../utils/shortcuts';
import type { EditorLayerProperties } from '../project/project.types';

// Right-click menus of the editor (Step 7B, Part 5A: the layer menu).
// Every entry calls the same store action as the toolbar, so each one is a
// single undo step.

export type LayerMenuRequest = {
  kind: 'layer';
  x: number;
  y: number;
  layerId: string;
  ids: string[];
};

export type MenuRequest =
  | LayerMenuRequest
  | { kind: 'timeline'; x: number; y: number }
  | { kind: 'ruler'; x: number; y: number; time: number; bookmarkId?: string };

// Things the menus need from the workspace that are not part of the store.
export type MenuExtras = {
  snapping: boolean;
  toggleSnapping: () => void;
  openMediaPicker: () => void;
  getSelection: () => string[];
};

type EditorApi = ReturnType<typeof useWorkspace>;

type WorkspaceMenusProps = {
  editor: EditorApi;
  request: MenuRequest | null;
  extras: MenuExtras;
  notify: (message: string) => void;
  onClose: () => void;
};

function formatSeconds(seconds: number): string {
  return `${seconds.toFixed(2)}s`;
}

function getLayerSpan(layer: EditorLayerProperties): number {
  return (
    Math.max(0, (layer.outPoint ?? 0) - (layer.inPoint ?? 0)) *
    (Math.max(0.01, layer.stretch ?? 100) / 100)
  );
}

function buildLayerMenu(
  editor: EditorApi,
  request: LayerMenuRequest,
  notify: (message: string) => void,
): ContextMenuItem[] {
  const layers = editor.layers;
  const primary = layers.find((layer) => layer.id === request.layerId);

  if (!primary) {
    return [];
  }

  const targets = request.ids.length > 0 ? request.ids : [primary.id];
  const locked = primary.locked === true;
  const hasMultiple = targets.length >= 2;
  const soon = (label: string) => () => notify(`${label}: Coming soon`);
  const separator: ContextMenuItem = { type: 'separator' };

  // A property change on every target layer, as one undo step.
  const patch = (changes: Partial<EditorLayerProperties>) => {
    editor.beginLayerEdit();
    editor.updateLayers(
      Object.fromEntries(targets.map((id) => [id, changes])),
    );
  };

  const isMediaWithAudio = primary.type === 'video' || primary.type === 'audio';

  const keyframeItem = (
    id: string,
    label: string,
    kind: 'position' | 'scale' | 'rotation' | 'opacity',
  ): ContextMenuItem => ({
    id,
    label,
    disabled: locked,
    onSelect: () => editor.addKeyframesAtPlayhead(targets, [kind]),
  });

  const items: ContextMenuItem[] = [
    {
      id: 'cut',
      label: 'Cut',
      shortcut: SHORTCUT.cut,
      icon: <Scissors size={14} />,
      disabled: locked,
      onSelect: () => editor.cutLayers(targets),
    },
    {
      id: 'copy',
      label: 'Copy',
      shortcut: SHORTCUT.copy,
      icon: <Copy size={14} />,
      onSelect: () => editor.copyLayers(targets),
    },
    {
      id: 'paste',
      label: 'Paste',
      shortcut: SHORTCUT.paste,
      disabled: editor.clipboardCount === 0,
      onSelect: () => editor.pasteLayers(),
    },
    {
      id: 'duplicate',
      label: 'Duplicate',
      shortcut: SHORTCUT.duplicate,
      disabled: locked,
      onSelect: () => editor.duplicateLayers(targets),
    },
    {
      id: 'delete',
      label: 'Delete',
      shortcut: SHORTCUT.remove,
      icon: <Trash2 size={14} />,
      disabled: locked,
      onSelect: () => editor.deleteLayers(targets),
    },
    separator,
    {
      id: 'split',
      label: 'Split at Playhead',
      shortcut: SHORTCUT.split,
      disabled: locked,
      onSelect: () => editor.splitLayers(targets, editor.currentTime),
    },
    {
      id: 'rename',
      label: 'Rename...',
      onSelect: () =>
        window.dispatchEvent(
          new CustomEvent('brx-timeline-rename', { detail: { layerId: primary.id } }),
        ),
    },
    separator,
    {
      id: 'visibility',
      label: primary.visible === false ? 'Show' : 'Hide',
      icon: <Eye size={14} />,
      onSelect: () => patch({ visible: primary.visible === false }),
    },
    {
      id: 'lock',
      label: locked ? 'Unlock' : 'Lock',
      icon: locked ? <Unlock size={14} /> : <Lock size={14} />,
      onSelect: () => patch({ locked: !locked }),
    },
    ...(isMediaWithAudio
      ? [
          {
            id: 'mute',
            label: primary.audioMuted ? 'Unmute' : 'Mute',
            icon: <Volume2 size={14} />,
            disabled: locked,
            onSelect: () => patch({ audioMuted: !primary.audioMuted }),
          } as ContextMenuItem,
        ]
      : []),
    separator,
    {
      id: 'group',
      label: 'Group',
      shortcut: SHORTCUT.group,
      icon: <FolderPlus size={14} />,
      disabled: locked,
      onSelect: () => editor.groupLayers(targets),
    },
    ...(primary.isGroup
      ? [
          {
            id: 'ungroup',
            label: 'Ungroup',
            shortcut: SHORTCUT.ungroup,
            disabled: locked,
            onSelect: () => editor.ungroupLayers(targets),
          } as ContextMenuItem,
        ]
      : []),
    {
      id: 'compound',
      label: 'Compound',
      onSelect: soon('Compound'),
    },
    separator,
    {
      id: 'flip-h',
      label: 'Flip Horizontal',
      icon: <FlipHorizontal size={14} />,
      disabled: locked,
      onSelect: () => editor.flipLayers(targets, 'horizontal'),
    },
    {
      id: 'flip-v',
      label: 'Flip Vertical',
      icon: <FlipVertical size={14} />,
      disabled: locked,
      onSelect: () => editor.flipLayers(targets, 'vertical'),
    },
    {
      id: 'reset',
      label: 'Reset Transform',
      icon: <RotateCw size={14} />,
      disabled: locked,
      onSelect: () => editor.resetTransform(targets),
    },
    {
      id: 'fit',
      label: 'Fit to Canvas',
      icon: <Minimize2 size={14} />,
      disabled: locked,
      onSelect: () => editor.fitLayersToCanvas(targets, 'fit'),
    },
    {
      id: 'fill',
      label: 'Fill Canvas',
      icon: <Maximize2 size={14} />,
      disabled: locked,
      onSelect: () => editor.fitLayersToCanvas(targets, 'fill'),
    },
    separator,
    {
      id: 'copy-effects',
      label: 'Copy All Effects',
      disabled: (primary.effects?.length ?? 0) === 0,
      onSelect: () => editor.copyEffects(primary.id),
    },
    {
      id: 'paste-effects',
      label: 'Paste Effects',
      disabled: locked || !editor.hasEffectsClipboard,
      onSelect: () => editor.pasteEffects(targets),
    },
    separator,
    {
      id: 'front',
      label: 'Bring to Front',
      disabled: locked,
      onSelect: () => editor.moveLayerOrder(targets, 'front'),
    },
    {
      id: 'back',
      label: 'Send to Back',
      disabled: locked,
      onSelect: () => editor.moveLayerOrder(targets, 'back'),
    },
    {
      id: 'up',
      label: 'Move Up',
      disabled: locked,
      onSelect: () => editor.moveLayerOrder(targets, 'up'),
    },
    {
      id: 'down',
      label: 'Move Down',
      disabled: locked,
      onSelect: () => editor.moveLayerOrder(targets, 'down'),
    },
    ...(hasMultiple
      ? [
          separator,
          {
            id: 'align',
            label: 'Align',
            children: [
              {
                id: 'align-left',
                label: 'Left',
                icon: <ArrowLeftToLine size={14} />,
                onSelect: () => editor.alignLayers(targets, 'left'),
              },
              {
                id: 'align-sequential',
                label: 'Sequential',
                onSelect: () => editor.alignLayers(targets, 'sequential'),
              },
              {
                id: 'align-right',
                label: 'Right',
                icon: <ArrowRightToLine size={14} />,
                onSelect: () => editor.alignLayers(targets, 'right'),
              },
            ],
          } as ContextMenuItem,
        ]
      : []),
    separator,
    {
      id: 'keyframe',
      label: 'Add Keyframe at Playhead',
      disabled: locked,
      children: [
        keyframeItem('key-position', 'Position', 'position'),
        keyframeItem('key-scale', 'Scale', 'scale'),
        keyframeItem('key-rotation', 'Rotation', 'rotation'),
        keyframeItem('key-opacity', 'Opacity', 'opacity'),
      ],
    },
    separator,
    {
      id: 'select-all',
      label: 'Select All',
      shortcut: SHORTCUT.selectAll,
      onSelect: () => window.dispatchEvent(new CustomEvent('brx-timeline-select-all')),
    },
    {
      id: 'work-area-to-layer',
      label: 'Set Work Area to Layer',
      onSelect: () => {
        const start = primary.startTime ?? 0;

        editor.setWorkAreaRange(start, start + getLayerSpan(primary));
      },
    },
    {
      id: 'info',
      label: 'Info...',
      onSelect: () => {
        const start = primary.startTime ?? 0;
        const span = getLayerSpan(primary);

        notify(
          `${primary.name} · ${primary.type} · ${Math.round(primary.width)}×${Math.round(primary.height)}` +
            ` · start ${formatSeconds(start)} · length ${formatSeconds(span)}`,
        );
      },
    },
    separator,
    { id: 'extract-audio', label: 'Extract Audio', onSelect: soon('Extract Audio') },
    { id: 'reverse', label: 'Reverse', onSelect: soon('Reverse') },
    { id: 'freeze', label: 'Freeze Frame', onSelect: soon('Freeze Frame') },
    {
      id: 'speed',
      label: 'Speed',
      children: [
        { id: 'speed-half', label: '50%', onSelect: soon('Speed') },
        { id: 'speed-double', label: '200%', onSelect: soon('Speed') },
      ],
    },
  ];

  return items;
}

const separatorItem: ContextMenuItem = { type: 'separator' };

function zoomItems(editor: EditorApi): ContextMenuItem[] {
  return [
    {
      id: 'zoom-fit',
      label: 'Zoom to Fit',
      onSelect: () => window.dispatchEvent(new CustomEvent('brx-timeline-zoom-fit')),
    },
    {
      id: 'zoom-in',
      label: 'Zoom In',
      onSelect: () => editor.updateTimelineZoom(editor.timelineZoom * 1.25),
    },
    {
      id: 'zoom-out',
      label: 'Zoom Out',
      onSelect: () => editor.updateTimelineZoom(editor.timelineZoom / 1.25),
    },
  ];
}

// Right-click on an empty part of the timeline.
function buildTimelineMenu(
  editor: EditorApi,
  extras: MenuExtras,
  notify: (message: string) => void,
): ContextMenuItem[] {
  const selection = extras.getSelection();
  const soon = (label: string) => () => notify(`${label}: Coming soon`);

  return [
    {
      id: 'paste',
      label: 'Paste',
      shortcut: SHORTCUT.paste,
      disabled: editor.clipboardCount === 0,
      onSelect: () => editor.pasteLayers(),
    },
    {
      id: 'select-all',
      label: 'Select All',
      shortcut: SHORTCUT.selectAll,
      onSelect: () => window.dispatchEvent(new CustomEvent('brx-timeline-select-all')),
    },
    separatorItem,
    {
      id: 'add-layer',
      label: 'Add Layer',
      children: [
        { id: 'add-media', label: 'Media...', onSelect: extras.openMediaPicker },
        {
          id: 'add-group',
          label: 'Group',
          disabled: selection.length === 0,
          onSelect: () => editor.groupLayers(selection),
        },
        { id: 'add-text', label: 'Text', onSelect: () => editor.addLayer('text') },
        { id: 'add-text-3d', label: 'Text 3D', onSelect: soon('Text 3D') },
        { id: 'add-shape', label: 'Shape', onSelect: () => editor.addLayer('shape') },
        {
          id: 'add-adjustment',
          label: 'Adjustment Layer',
          onSelect: () => editor.addLayer('adjustment'),
        },
        { id: 'add-fill', label: 'Fill', onSelect: () => editor.addLayer('solid') },
        { id: 'add-3d', label: '3D', onSelect: soon('3D') },
      ],
    },
    separatorItem,
    {
      id: 'bookmark',
      label: 'Add Bookmark at Playhead',
      shortcut: SHORTCUT.bookmark,
      onSelect: () => editor.addBookmark(),
    },
    separatorItem,
    ...zoomItems(editor),
    separatorItem,
    {
      id: 'snapping',
      label: extras.snapping ? 'Disable Snapping' : 'Enable Snapping',
      onSelect: extras.toggleSnapping,
    },
  ];
}

// Right-click on a ruler.
function buildRulerMenu(
  editor: EditorApi,
  request: Extract<MenuRequest, { kind: 'ruler' }>,
): ContextMenuItem[] {
  const bookmarkId = request.bookmarkId;

  return [
    {
      id: 'bookmark',
      label: bookmarkId ? 'Remove Bookmark' : 'Add Bookmark here',
      onSelect: () =>
        bookmarkId
          ? editor.removeBookmark(bookmarkId)
          : editor.addBookmark(request.time),
    },
    {
      id: 'clear-bookmarks',
      label: 'Clear All Bookmarks',
      disabled: editor.bookmarks.length === 0,
      onSelect: () => editor.clearBookmarks(),
    },
    separatorItem,
    {
      id: 'work-start',
      label: 'Set Work Area Start Here',
      shortcut: 'B',
      onSelect: () => editor.setWorkAreaStart(request.time),
    },
    {
      id: 'work-end',
      label: 'Set Work Area End Here',
      shortcut: 'N',
      onSelect: () => editor.setWorkAreaEnd(request.time),
    },
    {
      id: 'work-reset',
      label: 'Reset Work Area',
      disabled: !editor.workArea,
      onSelect: () => editor.resetWorkArea(),
    },
    separatorItem,
    { id: 'jump-start', label: 'Jump to Start', onSelect: () => editor.seekTimeline(0) },
    {
      id: 'jump-end',
      label: 'Jump to End',
      onSelect: () => editor.seekTimeline(editor.duration),
    },
    separatorItem,
    zoomItems(editor)[0],
  ];
}

export default function WorkspaceMenus({
  editor,
  request,
  extras,
  notify,
  onClose,
}: WorkspaceMenusProps) {
  if (!request) {
    return null;
  }

  const items =
    request.kind === 'layer'
      ? buildLayerMenu(editor, request, notify)
      : request.kind === 'timeline'
        ? buildTimelineMenu(editor, extras, notify)
        : buildRulerMenu(editor, request);

  if (items.length === 0) {
    return null;
  }

  return (
    <ContextMenu
      key={`${request.kind}:${request.x}:${request.y}`}
      x={request.x}
      y={request.y}
      items={items}
      onClose={onClose}
    />
  );
}
