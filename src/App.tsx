
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

import MaterialIcon from './features/workspace/components/MaterialIcon';
import ResolutionWarning from './components/common/ResolutionWarning';
import { MAX_FPS, MAX_RESOLUTION, MIN_FPS } from './config';
import { clampFps } from './utils/deviceProfile';
import Workspace from './features/workspace/Workspace';
import type { Project } from './features/project/project.types';

import './App.css';

type Template = {
  name: string;
  width: number;
  height: number;
  fps: number;
  tag: string;
  category: string;
  resolution: number;
  colorMode: string;
  bitDepth: string;
  background: string;
};

type Section = 'Home' | 'Templates' | 'Learn' | 'Settings' | 'Help';
type ViewMode = 'list' | 'grid';

const STORAGE_KEY = 'brx-editor-projects';
const TEMPLATE_STORAGE_KEY = 'brx-editor-saved-templates';

const templateCategories = [
  'Recent',
  'Saved',
  'Film & Video',
  'Mobile',
  'Photo',
  'Print',
  'Web',
  'Art & Illustration',
];

const templates: Template[] = [
  {
    name: 'YouTube Video',
    width: 1920,
    height: 1080,
    fps: 30,
    tag: '16:9',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Black',
  },
  {
    name: 'HDTV 1080p',
    width: 1920,
    height: 1080,
    fps: 30,
    tag: '1080p',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Black',
  },
  {
    name: 'HDTV 1080p 60 FPS',
    width: 1920,
    height: 1080,
    fps: 60,
    tag: '1080p 60',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Black',
  },
  {
    name: 'HDTV 720p',
    width: 1280,
    height: 720,
    fps: 30,
    tag: '720p',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Black',
  },
  {
    name: 'DCI 2K',
    width: 2048,
    height: 1080,
    fps: 24,
    tag: '2K',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '10 bit',
    background: 'Black',
  },
  {
    name: 'UHD 4K',
    width: 3840,
    height: 2160,
    fps: 30,
    tag: '4K UHD',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '10 bit',
    background: 'Black',
  },
  {
    name: 'DCI 4K',
    width: 4096,
    height: 2160,
    fps: 24,
    tag: '4K DCI',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '10 bit',
    background: 'Black',
  },
  {
    name: 'UHD 8K',
    width: 7680,
    height: 4320,
    fps: 30,
    tag: '8K UHD',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '10 bit',
    background: 'Black',
  },
  {
    name: 'DCI 8K',
    width: 8192,
    height: 4320,
    fps: 24,
    tag: '8K DCI',
    category: 'Film & Video',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '10 bit',
    background: 'Black',
  },
  {
    name: 'Instagram Reel',
    width: 1080,
    height: 1920,
    fps: 30,
    tag: '9:16',
    category: 'Mobile',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Black',
  },
  {
    name: 'Instagram Square',
    width: 1080,
    height: 1080,
    fps: 30,
    tag: '1:1',
    category: 'Mobile',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Black',
  },
  {
    name: 'Mobile Full HD',
    width: 1080,
    height: 2340,
    fps: 30,
    tag: 'Mobile',
    category: 'Mobile',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Black',
  },
  {
    name: 'HD Photo',
    width: 1920,
    height: 1080,
    fps: 30,
    tag: 'Photo',
    category: 'Photo',
    resolution: 300,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'White',
  },
  {
    name: 'Print A4',
    width: 2480,
    height: 3508,
    fps: 30,
    tag: 'A4',
    category: 'Print',
    resolution: 300,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'White',
  },
  {
    name: 'Web Full HD',
    width: 1920,
    height: 1080,
    fps: 30,
    tag: 'Web',
    category: 'Web',
    resolution: 72,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Transparent',
  },
  {
    name: 'Digital Artwork',
    width: 2000,
    height: 2000,
    fps: 30,
    tag: 'Artwork',
    category: 'Art & Illustration',
    resolution: 300,
    colorMode: 'RGB',
    bitDepth: '8 bit',
    background: 'Transparent',
  },
];

const menuItems = [
  'File',
  'Edit',
  'Image',
  'Layer',
  'Timeline',
  'View',
  'Window',
  'Help',
];

const initialWindowPosition = {
  x: 0,
  y: 0,
};

function readProjects(): Project[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? (JSON.parse(stored) as Project[]) : [];
  } catch {
    return [];
  }
}

function readSavedTemplates(): Template[] {
  try {
    return JSON.parse(
      localStorage.getItem(TEMPLATE_STORAGE_KEY) || '[]',
    ) as Template[];
  } catch {
    return [];
  }
}

function saveProjects(projects: Project[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
}

function formatDate(date: string) {
  const parsedDate = new Date(date);

  if (Number.isNaN(parsedDate.getTime())) {
    return 'Unknown date';
  }

  return parsedDate.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function App() {
  const [projects, setProjects] = useState<Project[]>(readProjects);
  const [savedTemplates, setSavedTemplates] =
    useState<Template[]>(readSavedTemplates);

  const [section, setSection] = useState<Section>('Home');
  const [search, setSearch] = useState('');
  const [sortNewest, setSortNewest] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState('Film & Video');
  const [selectedPreset, setSelectedPreset] =
    useState<string | null>('YouTube Video');

  const [projectName, setProjectName] = useState('Untitled Project');
  const [width, setWidth] = useState(1920);
  const [height, setHeight] = useState(1080);
  const [fps, setFps] = useState(30);
  const [resolution, setResolution] = useState(72);
  const [colorMode, setColorMode] = useState('RGB');
  const [bitDepth, setBitDepth] = useState('8 bit');
  const [background, setBackground] = useState('Black');
  const [artboards, setArtboards] = useState(false);
  const [orientation, setOrientation] = useState<'landscape' | 'portrait'>(
    'landscape',
  );

  const [activeProject, setActiveProject] = useState<Project | null>(null);
  const [notice, setNotice] = useState('');
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);

  const [windowPosition, setWindowPosition] = useState(
    initialWindowPosition,
  );

  const dragData = useRef<{
    pointerX: number;
    pointerY: number;
    startX: number;
    startY: number;
  } | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  const allTemplates = useMemo(
    () => [...templates, ...savedTemplates],
    [savedTemplates],
  );

  const visibleTemplates = useMemo(() => {
    if (selectedCategory === 'Saved') {
      return savedTemplates;
    }

    if (selectedCategory === 'Recent') {
      return templates.slice(0, 5);
    }

    return allTemplates.filter(
      (template) => template.category === selectedCategory,
    );
  }, [selectedCategory, savedTemplates, allTemplates]);

  const visibleProjects = useMemo(() => {
    return projects
      .filter((project) =>
        project.name.toLowerCase().includes(search.toLowerCase()),
      )
      .sort((a, b) =>
        sortNewest
          ? new Date(b.updatedAt).getTime() -
            new Date(a.updatedAt).getTime()
          : a.name.localeCompare(b.name),
      );
  }, [projects, search, sortNewest]);

  function updateProjects(nextProjects: Project[]) {
    setProjects(nextProjects);
    saveProjects(nextProjects);
  }

  const openNewProject = useCallback((template?: Template) => {
    const selected = template ?? templates[0];

    setProjectName('Untitled Project');
    setWidth(selected.width);
    setHeight(selected.height);
    setFps(clampFps(selected.fps));
    setResolution(selected.resolution);
    setColorMode(selected.colorMode);
    setBitDepth(selected.bitDepth);
    setBackground(selected.background);
    setOrientation(
      selected.width >= selected.height ? 'landscape' : 'portrait',
    );

    setSelectedPreset(selected.name);
    setSelectedCategory(selected.category);
    setWindowPosition(initialWindowPosition);
    setModalOpen(true);
  }, []);

  function openHelp() {
    setSection('Help');
    setNotice('');
  }

  useEffect(() => {
    if (activeProject) return;

    function handleKeyboardShortcuts(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const modifier = event.ctrlKey || event.metaKey;

      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target?.isContentEditable === true;

      if (event.key === 'Escape') {
        if (modalOpen) {
          setModalOpen(false);
        }

        setOpenProjectMenu(null);
        return;
      }

      if (!modifier || isTyping) return;

      if (key === 'n') {
        event.preventDefault();
        openNewProject();
      }

      if (key === 'o') {
        event.preventDefault();
        fileInput.current?.click();
      }
    }

    window.addEventListener('keydown', handleKeyboardShortcuts);

    return () => {
      window.removeEventListener('keydown', handleKeyboardShortcuts);
    };
  }, [activeProject, modalOpen, openNewProject]);

  function handleDragStart(event: ReactPointerEvent<HTMLDivElement>) {
    if (
      (event.target as HTMLElement).closest('button, input, select')
    ) {
      return;
    }

    dragData.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: windowPosition.x,
      startY: windowPosition.y,
    };

    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function handleDragMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!dragData.current) return;

    const deltaX = event.clientX - dragData.current.pointerX;
    const deltaY = event.clientY - dragData.current.pointerY;

    setWindowPosition({
      x: dragData.current.startX + deltaX,
      y: dragData.current.startY + deltaY,
    });
  }

  function handleDragEnd() {
    dragData.current = null;
  }

  function selectTemplate(template: Template) {
    setSelectedPreset(template.name);
    setProjectName('Untitled Project');
    setWidth(template.width);
    setHeight(template.height);
    setFps(clampFps(template.fps));
    setResolution(template.resolution);
    setColorMode(template.colorMode);
    setBitDepth(template.bitDepth);
    setBackground(template.background);
    setOrientation(
      template.width >= template.height ? 'landscape' : 'portrait',
    );
  }

  function updateWidth(value: number) {
    const nextWidth = Math.max(1, Math.min(MAX_RESOLUTION, Math.round(value)));
    setWidth(nextWidth);
    setOrientation(nextWidth >= height ? 'landscape' : 'portrait');
    setSelectedPreset(null);
  }

  function updateHeight(value: number) {
    const nextHeight = Math.max(1, Math.min(MAX_RESOLUTION, Math.round(value)));
    setHeight(nextHeight);
    setOrientation(width >= nextHeight ? 'landscape' : 'portrait');
    setSelectedPreset(null);
  }

  function changeOrientation(value: 'landscape' | 'portrait') {
    setOrientation(value);

    if (value === 'landscape' && width < height) {
      setWidth(height);
      setHeight(width);
    }

    if (value === 'portrait' && width > height) {
      setWidth(height);
      setHeight(width);
    }

    setSelectedPreset(null);
  }

  function createProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const project: Project = {
      id: crypto.randomUUID(),
      name: projectName.trim() || 'Untitled Project',
      width,
      height,
      fps,
      updatedAt: new Date().toISOString(),
    };

    updateProjects([project, ...projects]);
    setModalOpen(false);
    setActiveProject(project);
  }

  function saveCurrentTemplate() {
    const name = window.prompt('Enter preset name:');

    if (!name?.trim()) return;

    const newTemplate: Template = {
      name: name.trim(),
      width,
      height,
      fps,
      tag: 'Custom',
      category: 'Film & Video',
      resolution,
      colorMode,
      bitDepth,
      background,
    };

    const updated = [
      newTemplate,
      ...savedTemplates.filter((item) => item.name !== newTemplate.name),
    ];

    setSavedTemplates(updated);
    localStorage.setItem(TEMPLATE_STORAGE_KEY, JSON.stringify(updated));
    setSelectedCategory('Saved');
    setSelectedPreset(newTemplate.name);
    setNotice('Preset saved successfully.');
  }

  function openProjectFile(file?: File) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result)) as Partial<Project>;

        if (
          typeof parsed.name !== 'string' ||
          typeof parsed.width !== 'number' ||
          typeof parsed.height !== 'number' ||
          typeof parsed.fps !== 'number'
        ) {
          throw new Error('Invalid project file');
        }

        const project: Project = {
          id: typeof parsed.id === 'string' ? parsed.id : crypto.randomUUID(),
          name: parsed.name,
          width: parsed.width,
          height: parsed.height,
          fps: parsed.fps,
          updatedAt: new Date().toISOString(),
        };

        updateProjects([
          project,
          ...projects.filter((item) => item.id !== project.id),
        ]);

        setActiveProject(project);
        setNotice('');
      } catch {
        setNotice('This file is not a valid BRX project JSON file.');
      }
    };

    reader.readAsText(file);

    if (fileInput.current) {
      fileInput.current.value = '';
    }
  }

  function exportProject(project: Project) {
    const blob = new Blob([JSON.stringify(project, null, 2)], {
      type: 'application/json',
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `${
      project.name.replace(/[^a-z0-9-_ ]/gi, '').trim() || 'BRX-Project'
    }.brxproj`;

    link.click();
    URL.revokeObjectURL(url);
  }

  function renameProject(project: Project) {
    const nextName = window.prompt('Enter new project name:', project.name);

    if (nextName === null) return;

    const name = nextName.trim();

    if (!name) {
      setNotice('Project name cannot be empty.');
      return;
    }

    updateProjects(
      projects.map((item) =>
        item.id === project.id
          ? { ...item, name, updatedAt: new Date().toISOString() }
          : item,
      ),
    );

    setOpenProjectMenu(null);
    setNotice('Project renamed successfully.');
  }

  function duplicateProject(project: Project) {
    const copy: Project = {
      ...project,
      id: crypto.randomUUID(),
      name: `${project.name} Copy`,
      updatedAt: new Date().toISOString(),
    };

    updateProjects([copy, ...projects]);
    setOpenProjectMenu(null);
    setNotice('Project duplicated successfully.');
  }

  function deleteProject(project: Project) {
    const confirmed = window.confirm(
      `Delete "${project.name}"? This will remove it from your recent projects.`,
    );

    if (!confirmed) return;

    updateProjects(projects.filter((item) => item.id !== project.id));
    setOpenProjectMenu(null);
    setNotice('Project removed from recent projects.');
  }

  function launchProject(project: Project) {
    const updated = {
      ...project,
      updatedAt: new Date().toISOString(),
    };

    updateProjects([
      updated,
      ...projects.filter((item) => item.id !== project.id),
    ]);

    setActiveProject(updated);
  }

  function handleMenuClick(item: string) {
    if (item === 'File') {
      openNewProject();
      return;
    }

    if (item === 'Help') {
      openHelp();
      return;
    }

    if (item === 'View') {
      setViewMode((current) => (current === 'list' ? 'grid' : 'list'));
      return;
    }

    setNotice(`${item} menu options will be added in a future update.`);
  }

  if (activeProject) {
    return (
      <Workspace
        project={activeProject}
        projectName={activeProject.name}
        onBack={() => setActiveProject(null)}
        onSave={() => {
          const updatedProject = {
            ...activeProject,
            updatedAt: new Date().toISOString(),
          };

          updateProjects([
            updatedProject,
            ...projects.filter((item) => item.id !== activeProject.id),
          ]);

          setActiveProject(updatedProject);
        }}
        onExport={() => exportProject(activeProject)}
      />
    );
  }

  return (
    <div className="app-shell">
      <header className="app-menu-bar">
        <div className="app-menu-brand">
          <img
            src="/brx-logo.png"
            alt="BRX Logo"
            className="app-menu-logo"
          />
        </div>

        <nav className="app-menu-items" aria-label="Application menu">
          {menuItems.map((item) => (
            <button
              type="button"
              key={item}
              className="app-menu-item"
              onClick={() => handleMenuClick(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="app-menu-right">
          <span>BRX Editor</span>
        </div>
      </header>

      <aside className="sidebar">
        <div className="sidebar-brand">
          <img
            src="/brx-logo.png"
            alt="BRX Logo"
            className="sidebar-logo"
          />
        </div>

        <div className="sidebar-project-actions">
          <button
            type="button"
            className="sidebar-new-button"
            onClick={() => openNewProject()}
          >
            <MaterialIcon name="add" size={17} />
            New Project
          </button>

          <button
            type="button"
            className="sidebar-open-button"
            onClick={() => fileInput.current?.click()}
          >
            <MaterialIcon name="folder_open" size={17} />
            Open
          </button>
        </div>

        <div className="sidebar-divider" />

        <div className="sidebar-label">WORKSPACE</div>

        <nav className="side-nav">
          <button
            type="button"
            className={section === 'Home' ? 'nav-item active' : 'nav-item'}
            onClick={() => setSection('Home')}
          >
            <MaterialIcon name="home" size={18} />
            <span>Home</span>
          </button>

          <button
            type="button"
            className={
              section === 'Templates' ? 'nav-item active' : 'nav-item'
            }
            onClick={() => setSection('Templates')}
          >
            <MaterialIcon name="grid_view" size={18} />
            <span>Templates</span>
          </button>

          <button
            type="button"
            className={section === 'Learn' ? 'nav-item active' : 'nav-item'}
            onClick={() => setSection('Learn')}
          >
            <MaterialIcon name="school" size={18} />
            <span>Learn</span>
          </button>
        </nav>

        <div className="sidebar-label second-label">PREFERENCES</div>

        <nav className="side-nav">
          <button
            type="button"
            className={
              section === 'Settings' ? 'nav-item active' : 'nav-item'
            }
            onClick={() => setSection('Settings')}
          >
            <MaterialIcon name="settings" size={18} />
            <span>Settings</span>
          </button>

          <button
            type="button"
            className={section === 'Help' ? 'nav-item active' : 'nav-item'}
            onClick={openHelp}
          >
            <MaterialIcon name="help_outline" size={18} />
            <span>Help Center</span>
          </button>
        </nav>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            <span>BRX Editor</span>
            <span className="crumb-slash">/</span>
            <span>{section}</span>
          </div>

          <div className="topbar-right">
            <span className="status-pill">
              <span />
              All changes saved
            </span>

            <button type="button" className="avatar" title="BRX Editor">
              B
            </button>
          </div>
        </header>

        <div className="page-content">
          {section === 'Home' && (
            <section className="home-page">
              <div className="home-heading">
                <div>
                  <div className="eyebrow">BRX CREATIVE WORKSPACE</div>
                  <h1>Home</h1>
                  <p className="subtitle">
                    Create something new or continue your recent work.
                  </p>
                </div>
              </div>

              <div className="home-actions">
                <button
                  type="button"
                  className="home-action-button"
                  onClick={() => openNewProject()}
                >
                  <MaterialIcon name="add" size={19} />
                  <span>New Project</span>
                </button>

                <button
                  type="button"
                  className="home-action-button"
                  onClick={() => fileInput.current?.click()}
                >
                  <MaterialIcon name="folder_open" size={19} />
                  <span>Open Project</span>
                </button>

                <input
                  ref={fileInput}
                  type="file"
                  accept=".brxproj,.json,application/json"
                  hidden
                  onChange={(event) =>
                    openProjectFile(event.target.files?.[0])
                  }
                />
              </div>

              <section className="projects-section">
                <div className="section-heading">
                  <div>
                    <h2>Recent Projects</h2>
                    <p>Your latest BRX projects.</p>
                  </div>

                  <div className="project-tools">
                    <label className="search-box">
                      <MaterialIcon name="search" size={16} />
                      <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Filter recent files"
                      />
                    </label>

                    <button
                      type="button"
                      className="sort-button"
                      onClick={() => setSortNewest(!sortNewest)}
                      title="Change sorting"
                    >
                      <MaterialIcon name="sort" size={16} />
                      {sortNewest ? 'Recent' : 'A–Z'}
                    </button>

                    <div className="view-switcher">
                      <button
                        type="button"
                        className={viewMode === 'list' ? 'selected' : ''}
                        onClick={() => setViewMode('list')}
                        title="List view"
                      >
                        <MaterialIcon name="view_list" size={19} />
                      </button>

                      <button
                        type="button"
                        className={viewMode === 'grid' ? 'selected' : ''}
                        onClick={() => setViewMode('grid')}
                        title="Grid view"
                      >
                        <MaterialIcon name="grid_view" size={19} />
                      </button>
                    </div>
                  </div>
                </div>

                {visibleProjects.length === 0 ? (
                  <div className="empty-state">
                    <MaterialIcon name="folder_open" size={32} />
                    <h3>
                      {search ? 'No matching projects' : 'No recent projects'}
                    </h3>
                    <p>
                      {search
                        ? 'Try another search term.'
                        : 'Create a new project to get started.'}
                    </p>

                    {!search && (
                      <button
                        type="button"
                        className="empty-create-button"
                        onClick={() => openNewProject()}
                      >
                        <MaterialIcon name="add" size={16} />
                        New Project
                      </button>
                    )}
                  </div>
                ) : (
                  <div
                    className={
                      viewMode === 'list' ? 'project-list' : 'project-grid'
                    }
                  >
                    {viewMode === 'list' && (
                      <div className="project-list-heading">
                        <span>NAME</span>
                        <span>RECENT</span>
                        <span>SIZE</span>
                        <span>TYPE</span>
                        <span />
                      </div>
                    )}

                    {visibleProjects.map((project) => (
                      <article
                        className={
                          viewMode === 'list'
                            ? 'project-list-row'
                            : 'project-card'
                        }
                        key={project.id}
                      >
                        <button
                          type="button"
                          className="project-open"
                          onClick={() => launchProject(project)}
                        >
                          <div className="project-thumbnail">
                            <MaterialIcon name="movie" size={25} />
                          </div>

                          <div className="project-info">
                            <strong>{project.name}</strong>
                            <span>
                              {project.width} × {project.height}
                            </span>
                          </div>

                          {viewMode === 'list' && (
                            <>
                              <span className="project-recent">
                                {formatDate(project.updatedAt)}
                              </span>
                              <span className="project-size">
                                {project.width} × {project.height}
                              </span>
                              <span className="project-type">BRX Project</span>
                            </>
                          )}
                        </button>

                        <div className="project-menu-wrapper">
                          <button
                            type="button"
                            className="project-menu"
                            title="Project options"
                            aria-label={`Options for ${project.name}`}
                            aria-expanded={openProjectMenu === project.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              setOpenProjectMenu(
                                openProjectMenu === project.id
                                  ? null
                                  : project.id,
                              );
                            }}
                          >
                            <MaterialIcon name="more_horiz" size={19} />
                          </button>

                          {openProjectMenu === project.id && (
                            <div
                              className="project-dropdown"
                              onClick={(event) => event.stopPropagation()}
                            >
                              <button
                                type="button"
                                onClick={() => renameProject(project)}
                              >
                                <MaterialIcon name="edit" size={15} />
                                Rename
                              </button>

                              <button
                                type="button"
                                onClick={() => duplicateProject(project)}
                              >
                                <MaterialIcon name="content_copy" size={15} />
                                Duplicate
                              </button>

                              <button
                                type="button"
                                onClick={() => {
                                  exportProject(project);
                                  setOpenProjectMenu(null);
                                }}
                              >
                                <MaterialIcon name="download" size={15} />
                                Export
                              </button>

                              <div className="project-dropdown-divider" />

                              <button
                                type="button"
                                className="delete-action"
                                onClick={() => deleteProject(project)}
                              >
                                <MaterialIcon name="delete_outline" size={15} />
                                Delete
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
            </section>
          )}

          {section === 'Templates' && (
            <section className="subpage">
              <div className="eyebrow">BRX PRESETS</div>
              <h1>My Presets</h1>
              <p className="subtitle">
                Your saved custom video and composition presets.
              </p>

              {savedTemplates.length === 0 ? (
                <div className="empty-state">
                  <MaterialIcon name="bookmark_border" size={34} />
                  <h3>No saved presets yet</h3>
                  <p>
                    Create a project and use Save as Preset to add your own
                    presets here.
                  </p>
                  <button
                    type="button"
                    className="empty-create-button"
                    onClick={() => openNewProject()}
                  >
                    <MaterialIcon name="add" size={16} />
                    New Project
                  </button>
                </div>
              ) : (
                <div className="template-grid all-templates">
                  {savedTemplates.map((template, index) => (
                    <button
                      type="button"
                      className="template-card"
                      key={`${template.name}-${index}`}
                      onClick={() => openNewProject(template)}
                    >
                      <div className={`template-preview preview-${index % 3}`}>
                        <div className="preview-frame">
                          <span>{template.tag}</span>
                        </div>
                      </div>

                      <div className="template-details">
                        <strong>{template.name}</strong>
                        <span>
                          {template.width} × {template.height} · {template.fps}{' '}
                          FPS
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </section>
          )}

          {section === 'Learn' && (
            <section className="subpage">
              <div className="eyebrow">LEARNING CENTER</div>
              <h1>Learn BRX Editor</h1>
              <p className="subtitle">
                Learn the basics of editing and creating with BRX.
              </p>

              {[
                ['menu_book', 'Getting Started', 'Learn about projects, compositions, layers, and the editing workflow.'],
                ['auto_awesome', 'Motion Graphics', 'Explore animation principles, keyframes, and effects.'],
                ['movie', 'Video Editing', 'Understand the timeline, media, and editing tools.'],
              ].map(([icon, title, description]) => (
                <div className="learn-card" key={title}>
                  <MaterialIcon name={icon} size={25} />
                  <div>
                    <h3>{title}</h3>
                    <p>{description}</p>
                  </div>
                  <span className="coming-soon">COMING SOON</span>
                </div>
              ))}
            </section>
          )}

          {section === 'Settings' && (
            <section className="subpage">
              <div className="eyebrow">PREFERENCES</div>
              <h1>Settings</h1>
              <p className="subtitle">
                Application information and preferences.
              </p>

              <div className="settings-card">
                <div className="settings-row">
                  <div>
                    <strong>Application</strong>
                    <span>BRX Editor</span>
                  </div>
                  <img
                    src="/brx-logo.png"
                    alt="BRX Editor"
                    className="settings-logo"
                  />
                </div>

                <div className="settings-row">
                  <div>
                    <strong>Project Storage</strong>
                    <span>This browser's local storage</span>
                  </div>
                </div>

                <div className="settings-row">
                  <div>
                    <strong>Project Format</strong>
                    <span>.brxproj — JSON-based project format</span>
                  </div>
                </div>

                <div className="settings-row">
                  <div>
                    <strong>Application Version</strong>
                    <span>Early Development</span>
                  </div>
                </div>
              </div>
            </section>
          )}

          {section === 'Help' && (
            <section className="subpage">
              <div className="eyebrow">SUPPORT</div>
              <h1>Help Center</h1>
              <p className="subtitle">
                Help and information for using BRX Editor.
              </p>

              <div className="learn-card">
                <MaterialIcon name="help_outline" size={25} />
                <div>
                  <h3>Getting Help</h3>
                  <p>
                    BRX Editor help documentation is currently being prepared.
                  </p>
                </div>
                <span className="coming-soon">COMING SOON</span>
              </div>

              <div className="learn-card">
                <MaterialIcon name="info_outline" size={25} />
                <div>
                  <h3>About BRX Editor</h3>
                  <p>
                    BRX Editor is an independent creative editing application.
                  </p>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>

      {notice && (
        <div className="toast" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice('')}
            aria-label="Close notification"
          >
            <MaterialIcon name="close" size={16} />
          </button>
        </div>
      )}

      {modalOpen && (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setModalOpen(false);
            }
          }}
        >
          <form
            className="brx-new-project-window"
            onSubmit={createProject}
            style={{
              position: 'fixed',
              left: `calc(50% + ${windowPosition.x}px)`,
              top: `calc(50% + ${windowPosition.y}px)`,
              transform: 'translate(-50%, -50%)',
              width: 'min(1080px, 94vw)',
              height: 'min(720px, 88vh)',
              minWidth: '650px',
              minHeight: '480px',
              maxWidth: '96vw',
              maxHeight: '94vh',
              resize: 'both',
              overflow: 'auto',
              display: 'flex',
              flexDirection: 'column',
              background: '#252525',
              color: '#eeeeee',
              border: '1px solid #484848',
              borderRadius: '9px',
              boxShadow: '0 24px 90px rgba(0,0,0,.65)',
              zIndex: 1001,
            }}
          >
            <div
              className="brx-window-titlebar"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              style={{
                minHeight: '58px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0 20px',
                borderBottom: '1px solid #414141',
                cursor: 'grab',
                touchAction: 'none',
                userSelect: 'none',
              }}
            >
              <div>
                <div
                  style={{
                    fontSize: '11px',
                    color: '#aaa',
                    letterSpacing: '1px',
                  }}
                >
                  BRX EDITOR
                </div>
                <strong style={{ fontSize: '16px' }}>New Project</strong>
              </div>

              <div style={{ display: 'flex', gap: '8px' }}>
                <button
                  type="button"
                  className="icon-button"
                  title="Reset window position"
                  onClick={() => setWindowPosition(initialWindowPosition)}
                >
                  <MaterialIcon name="center_focus_strong" size={17} />
                </button>

                <button
                  type="button"
                  className="icon-button"
                  aria-label="Close"
                  onClick={() => setModalOpen(false)}
                >
                  <MaterialIcon name="close" size={19} />
                </button>
              </div>
            </div>

            <div
              className="brx-new-project-body"
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr) minmax(300px, 360px)',
                flex: 1,
                minHeight: 0,
              }}
            >
              <section
                className="brx-preset-browser-panel"
                style={{
                  minWidth: 0,
                  overflowY: 'auto',
                  padding: '20px',
                  borderRight: '1px solid #414141',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    color: '#aaa',
                    marginBottom: '13px',
                    letterSpacing: '.5px',
                  }}
                >
                  PRESET CATEGORIES
                </div>

                <div
                  className="brx-preset-categories"
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '7px',
                    marginBottom: '20px',
                  }}
                >
                  {templateCategories.map((category) => (
                    <button
                      type="button"
                      key={category}
                      onClick={() => setSelectedCategory(category)}
                      style={{
                        border: '1px solid',
                        borderColor:
                          selectedCategory === category ? '#2585e8' : '#484848',
                        background:
                          selectedCategory === category ? '#174b7c' : '#303030',
                        color: '#eee',
                        borderRadius: '5px',
                        padding: '8px 11px',
                        fontSize: '12px',
                        cursor: 'pointer',
                      }}
                    >
                      {category}
                    </button>
                  ))}
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #444',
                    paddingBottom: '12px',
                    marginBottom: '15px',
                    fontSize: '12px',
                    color: '#aaa',
                  }}
                >
                  <span>{selectedCategory.toUpperCase()} PRESETS</span>
                  <span>{visibleTemplates.length} presets</span>
                </div>

                <div
                  className="brx-preset-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns:
                      'repeat(auto-fill, minmax(145px, 1fr))',
                    gap: '12px',
                  }}
                >
                  {visibleTemplates.map((template) => {
                    const isSelected = selectedPreset === template.name;

                    return (
                      <button
                        type="button"
                        key={`${template.name}-${template.width}-${template.height}`}
                        onClick={() => selectTemplate(template)}
                        style={{
                          textAlign: 'left',
                          padding: '12px',
                          background: isSelected ? '#263e53' : '#303030',
                          border: `1px solid ${isSelected ? '#2585e8' : '#484848'}`,
                          borderRadius: '6px',
                          color: '#eee',
                          cursor: 'pointer',
                        }}
                      >
                        <div
                          style={{
                            height: '75px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            background: '#202020',
                            borderRadius: '4px',
                            marginBottom: '10px',
                          }}
                        >
                          <div
                            style={{
                              width:
                                template.width >= template.height
                                  ? '72px'
                                  : '38px',
                              maxWidth: '80%',
                              height:
                                template.width >= template.height
                                  ? '42px'
                                  : '58px',
                              border: '1px solid #888',
                              background: '#383838',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '10px',
                              color: '#bbb',
                            }}
                          >
                            {template.tag}
                          </div>
                        </div>

                        <strong
                          style={{
                            display: 'block',
                            fontSize: '12px',
                            marginBottom: '5px',
                          }}
                        >
                          {template.name}
                        </strong>

                        <span style={{ fontSize: '11px', color: '#aaa' }}>
                          {template.width} × {template.height}
                        </span>

                        <span
                          style={{
                            display: 'block',
                            fontSize: '11px',
                            color: '#aaa',
                            marginTop: '3px',
                          }}
                        >
                          {template.fps} FPS
                        </span>
                      </button>
                    );
                  })}

                  {visibleTemplates.length === 0 && (
                    <div
                      style={{
                        gridColumn: '1 / -1',
                        padding: '35px 10px',
                        textAlign: 'center',
                        color: '#999',
                        fontSize: '13px',
                      }}
                    >
                      No presets in this category yet.
                    </div>
                  )}
                </div>
              </section>

              <section
                className="brx-project-settings-panel"
                style={{
                  minWidth: 0,
                  overflowY: 'auto',
                  padding: '20px',
                  background: '#292929',
                }}
              >
                <div
                  style={{
                    fontSize: '12px',
                    color: '#aaa',
                    letterSpacing: '.5px',
                    marginBottom: '18px',
                  }}
                >
                  PROJECT SETTINGS
                </div>

                <label className="brx-setting-field">
                  <span>Project Name</span>
                  <input
                    autoFocus
                    value={projectName}
                    onChange={(event) => setProjectName(event.target.value)}
                    placeholder="Untitled Project"
                  />
                </label>

                <div className="brx-setting-row">
                  <label className="brx-setting-field">
                    <span>Width</span>
                    <input
                      type="number"
                      min="1"
                      max={MAX_RESOLUTION}
                      value={width}
                      onChange={(event) =>
                        updateWidth(Number(event.target.value))
                      }
                    />
                  </label>

                  <label className="brx-setting-field">
                    <span>Height</span>
                    <input
                      type="number"
                      min="1"
                      max={MAX_RESOLUTION}
                      value={height}
                      onChange={(event) =>
                        updateHeight(Number(event.target.value))
                      }
                    />
                  </label>
                </div>

                <ResolutionWarning width={width} height={height} fps={fps} />

                <div className="brx-setting-field">
                  <span>Orientation</span>
                  <div className="brx-orientation-options">
                    <button
                      type="button"
                      className={
                        orientation === 'portrait' ? 'active' : ''
                      }
                      onClick={() => changeOrientation('portrait')}
                      title="Portrait"
                    >
                      <MaterialIcon name="stay_current_portrait" size={21} />
                    </button>

                    <button
                      type="button"
                      className={
                        orientation === 'landscape' ? 'active' : ''
                      }
                      onClick={() => changeOrientation('landscape')}
                      title="Landscape"
                    >
                      <MaterialIcon name="stay_current_landscape" size={21} />
                    </button>

                    <label className="brx-artboards-toggle">
                      <input
                        type="checkbox"
                        checked={artboards}
                        onChange={(event) =>
                          setArtboards(event.target.checked)
                        }
                      />
                      Artboards
                    </label>
                  </div>
                </div>

                <label className="brx-setting-field">
                  <span>Frame Rate</span>
                  <select
                    value={fps}
                    onChange={(event) => setFps(Number(event.target.value))}
                  >
                    {[12, 15, 23.976, 24, 25, 29.97, 30, 50, 59.94, 60, 120]
                      .filter((value) => value >= MIN_FPS && value <= MAX_FPS)
                      .map((value) => (
                        <option key={value} value={value}>
                          {value} FPS
                        </option>
                      ))}
                  </select>
                </label>

                <label className="brx-setting-field">
                  <span>Resolution</span>
                  <select
                    value={resolution}
                    onChange={(event) =>
                      setResolution(Number(event.target.value))
                    }
                  >
                    <option value={72}>72 Pixels/Inch</option>
                    <option value={150}>150 Pixels/Inch</option>
                    <option value={300}>300 Pixels/Inch</option>
                    <option value={600}>600 Pixels/Inch</option>
                  </select>
                </label>

                <div className="brx-setting-row">
                  <label className="brx-setting-field">
                    <span>Color Mode</span>
                    <select
                      value={colorMode}
                      onChange={(event) => setColorMode(event.target.value)}
                    >
                      <option value="RGB">RGB Color</option>
                      <option value="Grayscale">Grayscale</option>
                    </select>
                  </label>

                  <label className="brx-setting-field">
                    <span>Bit Depth</span>
                    <select
                      value={bitDepth}
                      onChange={(event) => setBitDepth(event.target.value)}
                    >
                      <option value="8 bit">8 bit</option>
                      <option value="10 bit">10 bit</option>
                      <option value="16 bit">16 bit</option>
                    </select>
                  </label>
                </div>

                <label className="brx-setting-field">
                  <span>Background</span>
                  <select
                    value={background}
                    onChange={(event) => setBackground(event.target.value)}
                  >
                    <option value="Black">Black</option>
                    <option value="White">White</option>
                    <option value="Transparent">Transparent</option>
                  </select>
                </label>

                <div
                  style={{
                    marginTop: '18px',
                    padding: '12px',
                    background: '#202020',
                    borderRadius: '5px',
                    fontSize: '11px',
                    color: '#aaa',
                    lineHeight: 1.7,
                  }}
                >
                  <strong style={{ color: '#eee' }}>Composition Preview</strong>
                  <div>
                    {width} × {height} px
                  </div>
                  <div>
                    {fps} FPS · {colorMode} · {bitDepth}
                  </div>
                  <div>{background} Background</div>
                </div>
              </section>
            </div>

            <footer
              className="brx-new-project-footer"
              style={{
                minHeight: '64px',
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '10px',
                padding: '10px 20px',
                borderTop: '1px solid #414141',
                background: '#252525',
              }}
            >
              <button
                type="button"
                className="save-template-button"
                onClick={saveCurrentTemplate}
              >
                <MaterialIcon name="bookmark_add" size={17} />
                Save as Preset
              </button>

              <div style={{ display: 'flex', gap: '9px' }}>
                <button
                  type="button"
                  className="back-preset-button"
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-button create-button"
                >
                  Create Project
                  <MaterialIcon name="add" size={17} />
                </button>
              </div>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

export default App;
