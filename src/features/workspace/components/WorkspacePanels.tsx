import { useRef, useState } from 'react';
import type { DragEvent } from 'react';

import {
  Anchor,
  AlignCenter,
  ArrowDownToLine,
  AudioLines,
  Brush,
  Camera,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  Hand,
  Home,
  Image,
  MousePointer2,
  PanelRight,
  Pen,
  RotateCw,
  Search,
  Shapes,
  Type,
  Video,
  Eraser,
} from 'lucide-react';

import type {
  AnimatedPropertyName,
  EditorLayerProperties,
  EditorTool,
  WorkspaceProjectItem,
} from '../../project/project.types';

import PropertiesPanel from './PropertiesPanel';
import MaterialIcon from './MaterialIcon';

type MenuBarProps = {
  projectName: string;
  canUndo: boolean;
  canRedo: boolean;
  onBack?: () => void;
  onSave?: () => void;
  onExport?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onNewLayer: (type: EditorLayerProperties['type']) => void;
  onFitToComp: (mode: 'comp' | 'width' | 'height') => void;
  onImportMedia?: () => void;
};

const newLayerOptions: {
  label: string;
  type: EditorLayerProperties['type'];
  shortcut?: string;
}[] = [
  { label: 'Solid...', type: 'solid', shortcut: 'Ctrl+Y' },
  { label: 'Text', type: 'text', shortcut: 'Ctrl+Alt+Shift+T' },
  { label: 'Shape Layer', type: 'shape' },
  { label: 'Null Object', type: 'null', shortcut: 'Ctrl+Alt+Shift+Y' },
  { label: 'Adjustment Layer', type: 'adjustment', shortcut: 'Ctrl+Alt+Y' },
];

const transformOptions: {
  label: string;
  mode: 'comp' | 'width' | 'height';
  shortcut?: string;
}[] = [
  { label: 'Fit to Comp', mode: 'comp', shortcut: 'Ctrl+Alt+F' },
  { label: 'Fit to Comp Width', mode: 'width' },
  { label: 'Fit to Comp Height', mode: 'height' },
];

export function AeMenuBar({
  projectName,
  canUndo,
  canRedo,
  onBack,
  onSave,
  onExport,
  onUndo,
  onRedo,
  onNewLayer,
  onFitToComp,
  onImportMedia,
}: MenuBarProps) {
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [openSubmenu, setOpenSubmenu] = useState<string | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);

  const menus = [
    'File',
    'Edit',
    'Composition',
    'Layer',
    'Effect',
    'Animation',
    'View',
    'Window',
    'Help',
  ];

  const handleAction = (action: string) => {
    setOpenMenu(null);

    switch (action) {
      case 'Open':
        onBack?.();
        break;

      case 'Save':
        onSave?.();
        break;

      case 'Export':
        onExport?.();
        break;

      case 'Import File':
        onImportMedia?.();
        break;

      case 'Undo':
        onUndo();
        break;

      case 'Redo':
        onRedo();
        break;
    }
  };

  const menuItems: Record<string, string[]> = {
    File: [
      'New',
      'Open',
      'Import File',
      'Save',
      'Export',
    ],
    Edit: [
      'Undo',
      'Redo',
    ],
    Composition: [
      'New Composition',
    ],
    Effect: [
      'Effect Controls',
    ],
    Animation: [
      'Keyframe Assistant',
    ],
    View: [
      'Default',
      'Learn',
      'Standard',
      'Small Screen',
    ],
    Window: [
      'Project',
      'Preview',
      'Properties',
    ],
    Help: [
      'About BRX Editor',
    ],
  };

  return (
    <header className="ae-menu-bar">
      <button
        type="button"
        className="ae-logo"
        onClick={onBack}
        title="BRX Editor"
      >
        {logoFailed ? (
          <span className="ae-logo-fallback">Br</span>
        ) : (
          <img
            src="/brx-logo.png"
            alt=""
            onError={() => setLogoFailed(true)}
          />
        )}
      </button>

      <div className="ae-menu-items">
        {menus.map((menu) => (
          <div className="ae-menu-wrapper" key={menu}>
            <button
              type="button"
              className={`ae-menu-button ${
                openMenu === menu ? 'active' : ''
              }`}
              onClick={() =>
                setOpenMenu(
                  openMenu === menu ? null : menu,
                )
              }
            >
              {menu}
            </button>

            {openMenu === menu && (
              <div className="ae-dropdown">
                {menu === 'Layer' ? (
                  <>
                    <div
                      className="ae-submenu-wrapper"
                      onMouseEnter={() => setOpenSubmenu('New')}
                      onMouseLeave={() => setOpenSubmenu(null)}
                    >
                      <button
                        type="button"
                        className="ae-submenu-trigger"
                        aria-expanded={openSubmenu === 'New'}
                        onClick={() =>
                          setOpenSubmenu(
                            openSubmenu === 'New' ? null : 'New',
                          )
                        }
                      >
                        <span>New</span>
                        <ChevronRight size={13} />
                      </button>
                      {openSubmenu === 'New' && (
                        <div className="ae-dropdown ae-submenu">
                          {newLayerOptions.map((option) => (
                            <button
                              type="button"
                              key={option.type}
                              onClick={() => {
                                setOpenMenu(null);
                                setOpenSubmenu(null);
                                onNewLayer(option.type);
                              }}
                            >
                              <span>{option.label}</span>
                              {option.shortcut && (
                                <small>{option.shortcut}</small>
                              )}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <div
                      className="ae-submenu-wrapper"
                      onMouseEnter={() => setOpenSubmenu('Transform')}
                      onMouseLeave={() => setOpenSubmenu(null)}
                    >
                      <button
                        type="button"
                        className="ae-submenu-trigger"
                        aria-expanded={openSubmenu === 'Transform'}
                        onClick={() =>
                          setOpenSubmenu(
                            openSubmenu === 'Transform' ? null : 'Transform',
                          )
                        }
                      >
                        <span>Transform</span>
                        <ChevronRight size={13} />
                      </button>
                      {openSubmenu === 'Transform' && (
                        <div className="ae-dropdown ae-submenu">
                          {transformOptions.map((option) => (
                            <button
                              type="button"
                              key={option.mode}
                              onClick={() => {
                                setOpenMenu(null);
                                setOpenSubmenu(null);
                                onFitToComp(option.mode);
                              }}
                            >
                              <span>{option.label}</span>
                              {option.shortcut && <small>{option.shortcut}</small>}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </>
                ) : menuItems[menu]?.map((item) => {
                  const disabled =
                    (item === 'Undo' && !canUndo) ||
                    (item === 'Redo' && !canRedo);

                  return (
                    <button
                      type="button"
                      key={item}
                      disabled={disabled}
                      onClick={() => handleAction(item)}
                    >
                      {item}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="ae-menu-project">
        {projectName}
      </div>
    </header>
  );
}

type ToolsBarProps = {
  activeTool: EditorTool;
  onToolChange: (tool: EditorTool) => void;
  onImportMedia: (kind: 'image' | 'video') => void;
  snapping: boolean;
  onSnappingChange: (enabled: boolean) => void;
};

export function AeToolsBar({
  activeTool,
  onToolChange,
  onImportMedia,
  snapping,
  onSnappingChange,
}: ToolsBarProps) {
  const [workspace, setWorkspace] = useState('Default');

  const tools: {
    id: EditorTool;
    label: string;
    icon: React.ReactNode;
  }[] = [
    { id: 'select', label: 'Selection', icon: <MousePointer2 /> },
    { id: 'hand', label: 'Hand', icon: <Hand /> },
    { id: 'image', label: 'Image', icon: <Image /> },
    { id: 'video', label: 'Video', icon: <Video /> },
    { id: 'shape', label: 'Shape', icon: <Shapes /> },
    { id: 'pen', label: 'Pen', icon: <Pen /> },
    { id: 'anchor', label: 'Anchor Point (Y)', icon: <Anchor /> },
    { id: 'text', label: 'Text', icon: <Type /> },
  ];

  return (
    <div className="ae-tools-bar">
      <div className="ae-tools-left">
        <button
          type="button"
          className="ae-tool-button"
          title="Home"
        >
          <Home />
        </button>

        {tools.map((tool) => (
          <button
            type="button"
            key={tool.id}
            className={`ae-tool-button ${
              activeTool === tool.id ? 'active' : ''
            }`}
            title={tool.label}
            onClick={() => {
              if (tool.id === 'image' || tool.id === 'video') {
                onImportMedia(tool.id);
              } else {
                onToolChange(tool.id);
              }
            }}
          >
            {tool.icon}
          </button>
        ))}

        <button
          type="button"
          className="ae-tool-button"
          title="Rotate"
          disabled
        >
          <RotateCw />
        </button>

        <button
          type="button"
          className="ae-tool-button"
          title="Camera"
          disabled
        >
          <Camera />
        </button>

        <button
          type="button"
          className="ae-tool-button"
          title="Brush"
          disabled
        >
          <Brush />
        </button>

        <button
          type="button"
          className="ae-tool-button"
          title="Eraser"
          disabled
        >
          <Eraser />
        </button>

        <label className="ae-snapping">
          <input
            type="checkbox"
            checked={snapping}
            onChange={(event) => onSnappingChange(event.target.checked)}
          />
          Snapping
        </label>
      </div>

      <div className="ae-workspace-tabs">
        {['Default', 'Learn', 'Standard', 'Small Screen'].map(
          (item) => (
            <button
              type="button"
              key={item}
              className={workspace === item ? 'active' : ''}
              onClick={() => setWorkspace(item)}
            >
              {item}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

type ProjectPanelProps = {
  projectItems: WorkspaceProjectItem[];
  layers: EditorLayerProperties[];
  onRequestImport: () => void;
  onImportFiles: (files: File[]) => void;
  onAddMediaLayer: (item: WorkspaceProjectItem) => void;
  onDeleteItem: (item: WorkspaceProjectItem) => void;
  mediaUrls: Record<string, string>;
};

export function ProjectPanel({
  projectItems,
  layers,
  onRequestImport,
  onImportFiles,
  onAddMediaLayer,
  onDeleteItem,
  mediaUrls,
}: ProjectPanelProps) {
  const [search, setSearch] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const draggingRef = useRef<{ id: string; x: number; y: number } | null>(null);

  const filteredItems = projectItems.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase()),
  );
  const isItemUsed = (itemId: string) => {
    const item = projectItems.find((projectItem) => projectItem.id === itemId);
    return item?.type === 'composition' ||
      layers.some((layer) => layer.sourceId === itemId);
  };
  const selectedItem =
    projectItems.find((item) => item.id === selectedItemId) ?? null;
  const selectedItemUsed = selectedItem ? isItemUsed(selectedItem.id) : false;

  const handleFileDrop = (event: DragEvent<HTMLElement>) => {
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    onImportFiles(files);
  };
  const deleteItem = (item: WorkspaceProjectItem) => {
    if (isItemUsed(item.id) && !window.confirm(`"${item.name}" is used by a layer. Remove it anyway?`)) {
      return;
    }
    onDeleteItem(item);
    if (selectedItemId === item.id) setSelectedItemId(null);
  };

  return (
    <section
      className="ae-panel ae-project-panel"
      onDoubleClick={(event) => {
        if (!(event.target as HTMLElement).closest('.ae-project-item')) onRequestImport();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleFileDrop}
    >
      <div className="ae-panel-heading">
        <span>Project</span>

        <div>
          <button
            type="button"
            title="Import footage"
            aria-label="Import media"
            onClick={onRequestImport}
          >
            <ArrowDownToLine size={14} />
          </button>

          <button
            type="button"
            title="New folder"
            disabled
          >
            <FolderPlus size={14} />
          </button>

          <button
            type="button"
            title="Panel options"
          >
            <PanelRight size={14} />
          </button>
        </div>
      </div>

      <div className="ae-project-preview">
        {selectedItem ? (
          <div className="ae-project-preview-content">
            <div className="ae-project-preview-thumbnail">
              {selectedItem.thumbnail ? (
                <img src={selectedItem.thumbnail} alt="" />
              ) : selectedItem.mediaType === 'video' && mediaUrls[selectedItem.id] ? (
                <video src={mediaUrls[selectedItem.id]} muted playsInline />
              ) : selectedItem.mediaType === 'audio' ? (
                <AudioLines size={22} />
              ) : selectedItem.type === 'composition' ? (
                <Video size={22} />
              ) : selectedItem.type === 'solid' ? (
                <Shapes size={22} />
              ) : (
                <Image size={22} />
              )}
            </div>
            <div className="ae-project-preview-info">
              <strong>{selectedItem.name}</strong>
              <span>
                {selectedItem.mediaType ?? selectedItem.type}
                {selectedItemUsed ? '' : ' · unused'}
              </span>
              <span>
                {selectedItem.width && selectedItem.height
                  ? `${selectedItem.width} × ${selectedItem.height}`
                  : ''}
                {selectedItem.duration ? ` · ${selectedItem.duration.toFixed(2)}s` : ''}
                {selectedItem.frameRate ? ` · ${selectedItem.frameRate} fps` : ''}
                {selectedItem.size ? ` · ${(selectedItem.size / 1024).toFixed(1)} KB` : ''}
              </span>
            </div>
          </div>
        ) : (
          <div className="ae-project-preview-content ae-project-preview-empty" />
        )}
      </div>

      <div className="ae-project-search">
        <Search size={13} />

        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search Project"
        />

      </div>

      <div className="ae-project-table-header">
        <span>Name</span>
        <span>Type</span>
        <span>Size</span>
        <span>Duration</span>
        <span>Frame Rate</span>
      </div>

      <div className="ae-project-list">
        {filteredItems.map((item) => (
          <button
            type="button"
            key={item.id}
            title={isItemUsed(item.id) ? item.name : `${item.name} (unused)`}
            className={`ae-project-item ${
              selectedItemId === item.id ? 'active' : ''
            } ${isItemUsed(item.id) ? '' : 'unused'}`}
            onClick={() => setSelectedItemId(item.id)}
            onDoubleClick={() => {
              if (item.mediaType && !item.missing) onAddMediaLayer(item);
            }}
            onPointerDown={(event) => {
              if (event.button !== 0 || !item.mediaType) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              draggingRef.current = { id: item.id, x: event.clientX, y: event.clientY };
            }}
            onPointerMove={(event) => {
              const start = draggingRef.current;
              if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
              setDraggingId(item.id);
            }}
            onPointerUp={(event) => {
              const start = draggingRef.current;
              draggingRef.current = null;
              setDraggingId(null);
              if (!start || start.id !== item.id || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
              const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-media-dropzone]');
              const media = projectItems.find((candidate) => candidate.id === item.id);
              if (target && media?.mediaType && !media.missing) onAddMediaLayer(media);
            }}
            onKeyDown={(event) => {
              if (event.key !== 'Delete') return;
              event.preventDefault();
              event.stopPropagation();
              deleteItem(item);
            }}
            style={{ touchAction: 'none', userSelect: 'none', cursor: draggingId === item.id ? 'grabbing' : undefined }}
          >
            <span className={`ae-file-icon ${item.mediaType ?? item.type}`}>
              {item.type === 'solid' ? (
                <Shapes size={13} />
              ) : item.type === 'composition' ? (
                <Video size={13} />
              ) : item.mediaType === 'video' ? (
                <Video size={13} />
              ) : item.mediaType === 'audio' ? (
                <AudioLines size={13} />
              ) : (
                <Image size={13} />
              )}
            </span>

            <span className="ae-project-item-name">
              {item.name}
            </span>

            <span className="ae-project-item-type">{item.type}</span>
            <span>{item.size ? `${(item.size / 1024).toFixed(0)} KB` : '—'}</span>
            <span>{item.duration ? `${item.duration.toFixed(2)}s` : '—'}</span>
            <span>{item.frameRate ? `${item.frameRate} fps` : '—'}</span>
          </button>
        ))}

        {filteredItems.length === 0 && (
          <div className="ae-project-empty" onDoubleClick={onRequestImport}>
            No project items. Double-click to import.
          </div>
        )}
      </div>

      <div className="ae-project-footer">
        <span>8 bpc</span>
        <span>{projectItems.length} Items</span>
      </div>
    </section>
  );
}

type RightPanelStackProps = {
  selectedLayer: EditorLayerProperties | null;
  onChange: (updates: Partial<EditorLayerProperties>) => void;
  onLiveChange: (
    updates: Partial<EditorLayerProperties>,
    keyframeProperties?: AnimatedPropertyName[],
  ) => void;
  onBeginEdit: () => () => void;
  onFlip?: (axis: 'horizontal' | 'vertical') => void;
  currentTime: number;
  isPlaying: boolean;
  isMuted: boolean;
  zoom: number;
  onTogglePlayback: () => void;
  onStopPlayback: () => void;
  onToggleMute: () => void;
  onZoomChange: (zoom: number) => void;
};

export function RightPanelStack({
  selectedLayer,
  onChange,
  onLiveChange,
  onBeginEdit,
  onFlip,
  currentTime,
  isPlaying,
  isMuted,
  zoom,
  onTogglePlayback,
  onStopPlayback,
  onToggleMute,
  onZoomChange,
}: RightPanelStackProps) {
  const [expanded, setExpanded] = useState<string[]>([
    'Preview',
    'Properties',
  ]);

  const toggle = (name: string) => {
    setExpanded((current) =>
      current.includes(name)
        ? current.filter((item) => item !== name)
        : [...current, name],
    );
  };

  const sections = [
    'Preview',
    'Info',
    'Audio',
    'Effects & Presets',
    'Align',
    'Tracker',
    'Wiggler',
    'Libraries',
    'Properties',
  ];

  return (
    <aside className="ae-right-stack">
      {sections.map((section) => {
        const isOpen = expanded.includes(section);

        return (
          <section className="ae-panel ae-right-panel" key={section}>
            <button
              type="button"
              className="ae-panel-heading ae-collapsible-heading"
              onClick={() => toggle(section)}
            >
              <span>{section}</span>
              <ChevronDown
                size={13}
                className={isOpen ? '' : 'collapsed'}
              />
            </button>

            {isOpen && (
              <div className="ae-right-panel-content">
                {section === 'Preview' && (
                  <div className="ae-preview-transport">
                    <button
                      className="preview-control-button"
                      type="button"
                      title={isMuted ? 'Unmute audio' : 'Mute audio'}
                      aria-label={isMuted ? 'Unmute audio' : 'Mute audio'}
                      aria-pressed={isMuted}
                      onClick={onToggleMute}
                    >
                      <MaterialIcon name={isMuted ? 'volume_off' : 'volume_up'} size={14} />
                    </button>
                    <button
                      className={`preview-control-button ${isPlaying ? 'is-active' : ''}`}
                      type="button"
                      onClick={onTogglePlayback}
                      title={isPlaying ? 'Pause' : 'Play'}
                      aria-label={isPlaying ? 'Pause' : 'Play'}
                    >
                      <MaterialIcon name={isPlaying ? 'pause' : 'play_arrow'} size={14} />
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
                    <span className="ae-preview-time">{currentTime.toFixed(2)} s</span>
                    <button
                      className="preview-control-button"
                      type="button"
                      title="Zoom out"
                      aria-label="Zoom out"
                      onClick={() => onZoomChange(zoom <= 0 ? 25 : Math.max(6, Math.round(zoom / 1.25)))}
                    >
                      <MaterialIcon name="zoom_out" size={14} />
                    </button>
                    <span>{zoom <= 0 ? 'Fit' : zoom + '%'}</span>
                    <button
                      className="preview-control-button"
                      type="button"
                      title="Zoom in"
                      aria-label="Zoom in"
                      onClick={() => onZoomChange(zoom <= 0 ? 100 : Math.min(800, Math.round(zoom * 1.25)))}
                    >
                      <MaterialIcon name="zoom_in" size={14} />
                    </button>
                  </div>
                )}

                {section === 'Info' && (
                  <div className="ae-info-grid">
                    <span>R: —</span>
                    <span>G: —</span>
                    <span>B: —</span>
                    <span>A: —</span>
                    <span>X: —</span>
                    <span>Y: —</span>
                  </div>
                )}

                {section === 'Audio' && (
                  <div className="ae-audio-meter">
                    <AudioLines size={22} />
                    <div className="ae-audio-meter-track">
                      <span />
                    </div>
                    <span>0.0 dB</span>
                  </div>
                )}

                {section === 'Effects & Presets' && (
                  <div className="ae-effects-tree">
                    <div className="ae-effects-search">
                      <Search size={13} />
                      <input placeholder="Search Effects & Presets" />
                    </div>

                    {[
                      'Animation Presets',
                      '3D Channel',
                      'Audio',
                      'Blur & Sharpen',
                      'Color Correction',
                      'Distort',
                      'Generate',
                      'Keying',
                      'Perspective',
                      'Stylize',
                    ].map((item) => (
                      <button type="button" key={item}>
                        <ChevronDown size={12} />
                        {item}
                      </button>
                    ))}
                  </div>
                )}

                {section === 'Align' && (
                  <div className="ae-align-controls">
                    <button type="button" title="Align left">
                      <AlignCenter size={15} />
                    </button>
                    <button type="button" title="Align center">
                      <AlignCenter size={15} />
                    </button>
                    <button type="button" title="Align right">
                      <AlignCenter size={15} />
                    </button>
                    <span>Align Layers</span>
                  </div>
                )}

                {['Tracker', 'Wiggler', 'Libraries'].includes(section) && (
                  <div className="ae-placeholder-panel">
                    {section} panel
                  </div>
                )}

                {section === 'Properties' && (
                  selectedLayer ? (
                    <PropertiesPanel
                      selectedLayer={selectedLayer}
                      onChange={onChange}
                      onLiveChange={onLiveChange}
                      onBeginEdit={onBeginEdit}
                      onFlip={onFlip}
                    />
                  ) : (
                    <div className="ae-placeholder-panel">
                      Select a layer to edit its properties.
                    </div>
                  )
                )}
              </div>
            )}
          </section>
        );
      })}
    </aside>
  );
}