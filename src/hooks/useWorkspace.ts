import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import type {
  AnimatedPropertyName,
  EditorLayerProperties,
  EditorTool,
  Keyframe,
  KeyframeInterpolation,
  LayerAnimation,
  Project,
  WorkspaceProjectItem,
} from '../features/project/project.types';

import { evaluateProperty } from '../features/workspace/animation';

import {
  getCompositionDuration,
} from '../features/workspace/timeline-ae/timelineDuration';
import {
  MAX_FPS,
  MAX_RESOLUTION,
  MIN_FPS,
} from '../config';
import {
  detachFromDeleted,
  getGroupDescendantIds,
  isGroupLayer,
  syncGroupSpans,
} from '../features/workspace/groupUtils';

const DEFAULT_DURATION = 0;
const DEFAULT_LAYER_DURATION = 5;
const MAX_HISTORY = 50;
const STORAGE_PREFIX = 'brx-editor-workspace-';

const LOCK_SAFE_LAYER_FIELDS = new Set([
  'locked',
  'visible',
  'audioMuted',
  'solo',
]);

const PROPERTY_NAMES: AnimatedPropertyName[] = [
  'positionX',
  'positionY',
  'scaleX',
  'scaleY',
  'rotation',
  'opacity',
  'anchorX',
  'anchorY',
];

const DEFAULT_LABEL_COLOR: Record<
  EditorLayerProperties['type'],
  number
> = {
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

type UseWorkspaceOptions = {
  project?: Project;
};

export type Bookmark = { id: string; time: number };

function readBookmarks(key: string): Bookmark[] {
  try {
    const raw = localStorage.getItem(key);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Bookmark =>
            typeof item?.id === 'string' && Number.isFinite(item?.time),
        )
      : [];
  } catch {
    return [];
  }
}

type WorkspaceSnapshot = {
  bookmarks: Bookmark[];
  layers: EditorLayerProperties[];
  projectItems: WorkspaceProjectItem[];
  animations: LayerAnimation[];
  duration: number;
  backgroundColor: string;
  selectedLayerId: string | null;
};

type PersistedWorkspace = {
  version: 5;
  projectName: string;
  width: number;
  height: number;
  backgroundColor: string;
  fps: number;
  layers: EditorLayerProperties[];
  projectItems: WorkspaceProjectItem[];
  animations: LayerAnimation[];
  duration: number;
  currentTime: number;
  timelineZoom: number;
  previewZoom: number;
  selectedLayerId: string | null;
};

type LegacyClip = {
  id?: string;
  layerId?: string;
  name?: string;
  start?: number;
  duration?: number;
  sourceId?: string | null;
  mediaType?: EditorLayerProperties['type'];
};

type LegacyTrack = {
  type?: string;
  clips?: LegacyClip[];
  locked?: boolean;
  visible?: boolean;
};

type LegacyPersistedWorkspace =
  Partial<PersistedWorkspace> & {
    tracks?: LegacyTrack[];
    selectedClipId?: string | null;
    timelineMode?: string;
  };

function clamp(
  value: number,
  min: number,
  max: number,
): number {
  return Math.max(min, Math.min(max, value));
}

function reconcileTrackMattes(
  previousLayers: EditorLayerProperties[],
  nextLayers: EditorLayerProperties[],
): EditorLayerProperties[] {
  const updated = structuredClone(nextLayers);

  const previousById = new Map(
    previousLayers.map((layer) => [layer.id, layer]),
  );

  const nextIndex = new Map(
    updated.map((layer, index) => [layer.id, index]),
  );

  for (const layer of updated) {
    if (!layer.trackMatte || layer.trackMatte === 'none') {
      continue;
    }

    const index = nextIndex.get(layer.id) ?? 0;
    const nextMatte = index > 0
      ? updated[index - 1]
      : undefined;

    if (nextMatte?.id === layer.matteSourceId) {
      continue;
    }

    const previousMatte = layer.matteSourceId
      ? previousById.get(layer.matteSourceId)
      : undefined;

    if (previousMatte && layer.matteSourceWasVisible) {
      const restored = updated.find(
        (item) => item.id === previousMatte.id,
      );

      if (restored) {
        restored.visible = true;
      }
    }

    if (nextMatte) {
      layer.matteSourceWasVisible =
        nextMatte.visible !== false;

      layer.matteSourceId = nextMatte.id;
      nextMatte.visible = false;
    } else {
      layer.trackMatte = 'none';
      layer.matteSourceId = null;
      layer.matteSourceWasVisible = true;
    }
  }

  return updated;
}

function measureTextLayer(
  text: string,
  fontSize: number,
) {
  const context = document
    .createElement('canvas')
    .getContext('2d');

  if (!context) {
    throw new Error(
      'Canvas text measurement is unavailable',
    );
  }

  context.font =
    `700 ${fontSize}px "Segoe UI", Arial, sans-serif`;

  const metrics = context.measureText(text || ' ');

  const measuredHeight =
    (metrics.actualBoundingBoxAscent || fontSize) +
    (metrics.actualBoundingBoxDescent || fontSize * 0.2);

  return {
    width: Math.max(
      fontSize,
      metrics.width + fontSize * 0.2,
    ),

    height: Math.max(
      fontSize,
      measuredHeight + fontSize * 0.2,
    ),
  };
}

function createId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function makeSolidItemNamesUnique(
  items: WorkspaceProjectItem[],
): WorkspaceProjectItem[] {
  const usedNames = new Set(
    items
      .filter((item) => item.type !== 'solid')
      .map((item) => item.name),
  );

  let nextNumber = 1;

  return items.map((item) => {
    if (
      item.type !== 'solid' ||
      !usedNames.has(item.name)
    ) {
      usedNames.add(item.name);
      return item;
    }

    let name = `Solid ${nextNumber} Source`;

    while (usedNames.has(name)) {
      nextNumber += 1;
      name = `Solid ${nextNumber} Source`;
    }

    nextNumber += 1;
    usedNames.add(name);

    return {
      ...item,
      name,
    };
  });
}

/**
 * Creates an empty animation object for a layer.
 */
function createEmptyAnimation(
  layerId: string,
): LayerAnimation {
  const properties = {} as LayerAnimation['properties'];

  for (const name of PROPERTY_NAMES) {
    properties[name] = {
      name,
      keyframes: [],
    };
  }

  return {
    layerId,
    properties,
  };
}

function createInitialAnimations(
  layers: EditorLayerProperties[],
): LayerAnimation[] {
  return layers.map((layer) =>
    createEmptyAnimation(layer.id),
  );
}

function getLegacyClipType(
  clip: LegacyClip,
  trackType: string | undefined,
): EditorLayerProperties['type'] {
  if (clip.mediaType) return clip.mediaType;
  if (trackType === 'audio') return 'audio';
  if (trackType === 'text') return 'text';
  if (trackType === 'image') return 'image';

  return 'video';
}

function readWorkspaceStorage(
  projectId: string,
): PersistedWorkspace | null {
  try {
    const raw = localStorage.getItem(
      `${STORAGE_PREFIX}${projectId}`,
    );

    if (!raw) return null;

    const data = JSON.parse(
      raw,
    ) as LegacyPersistedWorkspace;

    if (
      !Array.isArray(data.layers) &&
      !Array.isArray(data.tracks)
    ) {
      return null;
    }

    const storedDuration =
      typeof data.duration === 'number' &&
      Number.isFinite(data.duration)
        ? Math.max(0, data.duration)
        : DEFAULT_DURATION;

    const width =
      typeof data.width === 'number' &&
      Number.isFinite(data.width)
        ? data.width
        : 1920;

    const height =
      typeof data.height === 'number' &&
      Number.isFinite(data.height)
        ? data.height
        : 1080;

    const fps =
      typeof data.fps === 'number' &&
      Number.isFinite(data.fps)
        ? data.fps
        : 30;

    const migratePercentAnchors =
      (data.version ?? 0) < 4;

    const migrateAnchor = (
      value: number | undefined,
      sourceSize: number,
    ) => {
      if (
        value === undefined ||
        !Number.isFinite(value)
      ) {
        return sourceSize / 2;
      }

      if (
        migratePercentAnchors &&
        value >= 0 &&
        value <= 100 &&
        sourceSize > 100
      ) {
        return (value / 100) * sourceSize;
      }

      return value;
    };

    const layers: EditorLayerProperties[] = (
      Array.isArray(data.layers) ? data.layers : []
    ).map((layer) => ({
      ...layer,

      scaleX: layer.scaleX ?? 100,
      scaleY: layer.scaleY ?? 100,
      z: layer.z ?? 0,
      scaleZ: layer.scaleZ ?? 100,

      orientationX: layer.orientationX ?? 0,
      orientationY: layer.orientationY ?? 0,
      orientationZ: layer.orientationZ ?? 0,

      rotationX: layer.rotationX ?? 0,
      rotationY: layer.rotationY ?? 0,

      anchorX: migrateAnchor(
        layer.anchorX,
        layer.width,
      ),

      anchorY: migrateAnchor(
        layer.anchorY,
        layer.height,
      ),

      labelColor:
        layer.labelColor ??
        DEFAULT_LABEL_COLOR[layer.type],

      visible: layer.visible ?? true,
      parentId: layer.parentId ?? null,

      startTime: layer.startTime ?? 0,
      inPoint: layer.inPoint ?? 0,

      outPoint:
        layer.outPoint ?? storedDuration,

      blendMode: layer.blendMode ?? 'normal',

      shy: layer.shy ?? false,
      collapseTransformations:
        layer.collapseTransformations ?? false,

      quality: layer.quality ?? 'best',
      effectsEnabled: layer.effectsEnabled ?? true,

      frameBlending: layer.frameBlending ?? false,
      motionBlur: layer.motionBlur ?? false,

      adjustmentLayer:
        layer.adjustmentLayer ??
        layer.type === 'adjustment',

      threeDLayer: layer.threeDLayer ?? false,

      preserveTransparency:
        layer.preserveTransparency ?? false,

      trackMatte: layer.trackMatte ?? 'none',

      matteSourceId:
        layer.matteSourceId ?? null,

      matteSourceWasVisible:
        layer.matteSourceWasVisible ?? true,

      stretch: layer.stretch ?? 100,

      comments: layer.comments ?? '',
      effects: layer.effects ?? [],
      masks: layer.masks ?? [],
      expression: layer.expression ?? null,

      text:
        layer.text ??
        (layer.type === 'text'
          ? layer.name
          : undefined),
    }));

    const migratedLayers: EditorLayerProperties[] = [];

    const existingLayers = new Map(
      layers.map((layer) => [layer.id, layer]),
    );

    for (const track of data.tracks ?? []) {
      for (const clip of track.clips ?? []) {
        const start = Number.isFinite(clip.start)
          ? Math.max(0, clip.start ?? 0)
          : 0;

        const clipDuration = Number.isFinite(
          clip.duration,
        )
          ? Math.max(0, clip.duration ?? 0)
          : Math.max(0, storedDuration - start);

        if (clipDuration <= 0) continue;

        const id =
          clip.layerId ??
          `layer-${clip.id ?? createId('clip')}`;

        const type = getLegacyClipType(
          clip,
          track.type,
        );

        const existing = existingLayers.get(id);

        const name =
          clip.name?.trim() || 'Imported Layer';

        const layer: EditorLayerProperties = {
          ...(existing ?? {
            id,
            name,
            type,

            x: width / 2,
            y: height / 2,

            width,
            height,

            rotation: 0,
            opacity: 100,

            scaleX: 100,
            scaleY: 100,

            z: 0,
            scaleZ: 100,

            orientationX: 0,
            orientationY: 0,
            orientationZ: 0,

            rotationX: 0,
            rotationY: 0,

            anchorX: width / 2,
            anchorY: height / 2,

            text: type === 'text'
              ? 'Text'
              : undefined,
          }),

          id,
          name,
          type,

          startTime: start,
          inPoint: 0,
          outPoint: clipDuration,

          sourceId:
            clip.sourceId ??
            existing?.sourceId ??
            null,

          visible:
            track.visible ??
            existing?.visible ??
            true,

          locked:
            track.locked ??
            existing?.locked ??
            false,
        };

        migratedLayers.push(layer);
      }
    }

    const migratedIds = new Set(
      migratedLayers.map((layer) => layer.id),
    );

    const allLayers = [
      ...migratedLayers,
      ...layers.filter(
        (layer) => !migratedIds.has(layer.id),
      ),
    ];

    /**
     * Important:
     * Composition duration is now calculated from layers.
     * Old stored duration is not retained when clips are gone.
     */
    const compositionDuration =
      getCompositionDuration(allLayers);

    const derivedItems = allLayers.flatMap(
      (layer): WorkspaceProjectItem[] => {
        if (layer.type === 'solid') {
          return [
            {
              id:
                layer.sourceId ??
                `solid-${layer.id}`,

              name: `${layer.name} Source`,
              type: 'solid',
            },
          ];
        }

        if (
          layer.type === 'video' ||
          layer.type === 'audio' ||
          layer.type === 'image' ||
          layer.type === 'footage'
        ) {
          const mediaType =
            layer.type === 'footage'
              ? 'image'
              : layer.type;

          return [
            {
              id:
                layer.sourceId ??
                `footage-${layer.id}`,

              name: layer.name,
              type: 'footage',
              mediaType,
            },
          ];
        }

        return [];
      },
    );

    const savedAnimations = Array.isArray(
      data.animations,
    )
      ? data.animations
      : [];

    const animations = [
      ...savedAnimations,

      ...allLayers
        .filter(
          (layer) =>
            !savedAnimations.some(
              (animation) =>
                animation.layerId === layer.id,
            ),
        )
        .map((layer) =>
          createEmptyAnimation(layer.id),
        ),
    ];

    const projectName =
      data.projectName ?? 'Untitled Project';

    const projectItems = makeSolidItemNamesUnique(
      Array.isArray(data.projectItems)
        ? data.projectItems
        : [
            {
              id: `composition-${projectId}`,
              name: projectName,
              type: 'composition' as const,
            },
            ...derivedItems,
          ],
    );

    return {
      version: 5,

      projectName,
      width,
      height,

      backgroundColor:
        (data.version ?? 0) < 5
          ? '#000000'
          : data.backgroundColor ?? '#000000',

      fps,

      layers: allLayers,
      projectItems,
      animations,

      duration: compositionDuration,

      currentTime: clamp(
        data.currentTime ?? 0,
        0,
        compositionDuration,
      ),

      timelineZoom: data.timelineZoom ?? 100,
      previewZoom: data.previewZoom ?? 0,

      selectedLayerId:
        data.selectedLayerId ??
        allLayers[0]?.id ??
        null,
    };
  } catch {
    return null;
  }
}

export function useWorkspace({
  project,
}: UseWorkspaceOptions = {}) {
  const [restoredState] = useState(() =>
    readWorkspaceStorage(project?.id ?? 'default'),
  );

  const [projectName, setProjectName] = useState(
    restoredState?.projectName ??
      project?.name ??
      'Untitled Project',
  );

  const [width, setWidth] = useState(
    restoredState?.width ??
      project?.width ??
      1920,
  );

  const [height, setHeight] = useState(
    restoredState?.height ??
      project?.height ??
      1080,
  );

  const [backgroundColor, setBackgroundColor] =
    useState(
      restoredState?.backgroundColor ?? '#000000',
    );

  const [fps, setFps] = useState(
    restoredState?.fps ??
      project?.fps ??
      30,
  );

  const [projectItems, setProjectItems] = useState<
    WorkspaceProjectItem[]
  >(
    restoredState?.projectItems ?? [
      {
        id: `composition-${project?.id ?? 'default'}`,

        name:
          restoredState?.projectName ??
          project?.name ??
          'Untitled Project',

        type: 'composition',
      },
    ],
  );

  const [activeTool, setActiveTool] =
    useState<EditorTool>('select');

  const [layers, setLayers] = useState<
    EditorLayerProperties[]
  >(restoredState?.layers ?? []);

  const [selectedLayerId, setSelectedLayerId] =
    useState<string | null>(
      restoredState?.selectedLayerId ??
        restoredState?.layers?.[0]?.id ??
        null,
    );

  const selectedLayer =
    layers.find(
      (layer) => layer.id === selectedLayerId,
    ) ?? null;

  const [animations, setAnimations] = useState<
    LayerAnimation[]
  >(
    restoredState?.animations ??
      createInitialAnimations(
        restoredState?.layers ?? [],
      ),
  );

  const [duration, setDuration] = useState(
    restoredState?.duration ?? DEFAULT_DURATION,
  );

  const [currentTime, setCurrentTime] = useState(
    restoredState?.currentTime ?? 0,
  );

  const [timelineZoom, setTimelineZoom] = useState(
    restoredState?.timelineZoom ?? 100,
  );

  const [previewZoom, setPreviewZoom] = useState(
    restoredState?.previewZoom ?? 0,
  );

  const [isPlaying, setIsPlaying] = useState(false);

  const [saveStatus, setSaveStatus] = useState(
    'All changes saved',
  );

  const layersRef = useRef(layers);
  const projectItemsRef = useRef(projectItems);
  const animationsRef = useRef(animations);

  const durationRef = useRef(duration);

  const widthRef = useRef(width);
  const heightRef = useRef(height);

  const backgroundColorRef = useRef(backgroundColor);

  const currentTimeRef = useRef(currentTime);

  const selectedLayerIdRef = useRef(selectedLayerId);

  layersRef.current = layers;
  projectItemsRef.current = projectItems;
  animationsRef.current = animations;

  durationRef.current = duration;

  widthRef.current = width;
  heightRef.current = height;

  backgroundColorRef.current = backgroundColor;

  currentTimeRef.current = currentTime;

  selectedLayerIdRef.current = selectedLayerId;

  const pastRef = useRef<WorkspaceSnapshot[]>([]);
  const futureRef = useRef<WorkspaceSnapshot[]>([]);

  const [historyVersion, setHistoryVersion] =
    useState(0);

  /**
   * Central layer update function.
   *
   * Every layer change recalculates composition duration.
   * This fixes stale duration after move, trim, stretch,
   * duplicate, split and delete.
   */
  const commitLayers = useCallback(
    (inputLayers: EditorLayerProperties[]) => {
      // A group's lane always covers its members.
      const nextLayers = syncGroupSpans(inputLayers);

      const nextDuration =
        getCompositionDuration(nextLayers);

      layersRef.current = nextLayers;
      durationRef.current = nextDuration;

      setLayers(nextLayers);
      setDuration(nextDuration);

      setCurrentTime((time) =>
        clamp(time, 0, nextDuration),
      );

      if (nextDuration <= 0) {
        setIsPlaying(false);
      }
    },
    [],
  );

  const bookmarksKey = `${STORAGE_PREFIX}${project?.id ?? 'default'}:bookmarks`;
  const [bookmarks, setBookmarks] = useState<Bookmark[]>(() =>
    readBookmarks(bookmarksKey),
  );
  const bookmarksRef = useRef<Bookmark[]>(bookmarks);

  useEffect(() => {
    try {
      localStorage.setItem(bookmarksKey, JSON.stringify(bookmarks));
    } catch {
      // Bookmarks are a convenience: failing to save them is not fatal.
    }
  }, [bookmarksKey, bookmarks]);

  const createSnapshot = useCallback(
    (): WorkspaceSnapshot => ({
      bookmarks: structuredClone(bookmarksRef.current),

      layers: structuredClone(layersRef.current),

      projectItems: structuredClone(
        projectItemsRef.current,
      ),

      animations: structuredClone(
        animationsRef.current,
      ),

      duration: durationRef.current,

      backgroundColor:
        backgroundColorRef.current,

      selectedLayerId:
        selectedLayerIdRef.current,
    }),
    [],
  );

  const pushHistory = useCallback(() => {
    pastRef.current = [
      ...pastRef.current,
      createSnapshot(),
    ].slice(-MAX_HISTORY);

    futureRef.current = [];

    setHistoryVersion((value) => value + 1);
  }, [createSnapshot]);

  /**
   * Timeline layer updates.
   */
  const updateLayers = useCallback(
    (
      updates: Record<
        string,
        Partial<EditorLayerProperties>
      >,

      order?: string[],

      options?: {
        keyframeProperties?: AnimatedPropertyName[];
        time?: number;
      },
    ) => {
      const current = layersRef.current;

      const byId = new Map(
        current.map((layer) => [
          layer.id,
          layer,
        ]),
      );

      for (const [
        layerId,
        layerUpdates,
      ] of Object.entries(updates)) {
        const layer = byId.get(layerId);

        if (
          layer &&
          (
            !layer.locked ||
            Object.keys(layerUpdates).every(
              (key) =>
                LOCK_SAFE_LAYER_FIELDS.has(key),
            )
          )
        ) {
          byId.set(layerId, {
            ...layer,
            ...layerUpdates,
            id: layer.id,
            type: layer.type,
          });
        }
      }

      // Moving a group's lane moves its members by the same amount.
      for (const [layerId, layerUpdates] of Object.entries(updates)) {
        const before = byId.get(layerId);

        if (
          !before ||
          !isGroupLayer(before) ||
          typeof layerUpdates.startTime !== 'number'
        ) {
          continue;
        }

        const delta =
          layerUpdates.startTime - (current.find((item) => item.id === layerId)?.startTime ?? 0);

        if (Math.abs(delta) < 1e-9) {
          continue;
        }

        for (const memberId of getGroupDescendantIds(current, layerId)) {
          const member = byId.get(memberId);

          // Members the drag already moves itself are left alone.
          if (!member || member.locked || updates[memberId]) {
            continue;
          }

          byId.set(memberId, {
            ...member,
            startTime: (member.startTime ?? 0) + delta,
          });
        }
      }

      const reordered = order
        ? order.flatMap((layerId) => {
            const layer = byId.get(layerId);
            return layer ? [layer] : [];
          })
        : current.map(
            (layer) =>
              byId.get(layer.id) ?? layer,
          );

      const updated = order
        ? reconcileTrackMattes(
            current,
            reordered,
          )
        : reordered;

      commitLayers(updated);

      if (options?.keyframeProperties?.length) {
        const time = clamp(
          options.time ?? currentTimeRef.current,
          0,
          durationRef.current,
        );

        const byLayer = new Map(
          animationsRef.current.map(
            (animation) => [
              animation.layerId,
              animation,
            ],
          ),
        );

        for (const [
          layerId,
          layerUpdates,
        ] of Object.entries(updates)) {
          const layer = updated.find(
            (item) => item.id === layerId,
          );

          if (!layer || layer.locked) continue;

          const animation =
            byLayer.get(layerId) ??
            createEmptyAnimation(layerId);

          const properties = {
            ...animation.properties,
          };

          const layerField: Partial<
            Record<
              AnimatedPropertyName,
              keyof EditorLayerProperties
            >
          > = {
            positionX: 'x',
            positionY: 'y',
            scaleX: 'scaleX',
            scaleY: 'scaleY',
            rotation: 'rotation',
            opacity: 'opacity',
            anchorX: 'anchorX',
            anchorY: 'anchorY',
          };

          for (
            const propertyName of
            options.keyframeProperties
          ) {
            const field = layerField[propertyName];

            const value = field
              ? layerUpdates[field]
              : undefined;

            if (typeof value !== 'number') {
              continue;
            }

            const currentProperty =
              properties[propertyName];

            const existing =
              currentProperty.keyframes.find(
                (keyframe) =>
                  Math.abs(keyframe.time - time) <
                  0.0001,
              );

            const keyframe: Keyframe = existing
              ? {
                  ...existing,
                  value,
                }
              : {
                  id: createId('keyframe'),
                  time,
                  value,
                  interpolation: 'linear',
                };

            properties[propertyName] = {
              ...currentProperty,

              keyframes: [
                ...currentProperty.keyframes.filter(
                  (item) =>
                    item.id !== existing?.id,
                ),

                keyframe,
              ].sort(
                (a, b) => a.time - b.time,
              ),
            };
          }

          byLayer.set(layerId, {
            ...animation,
            properties,
          });
        }

        const updatedAnimations = [
          ...byLayer.values(),
        ];

        animationsRef.current =
          updatedAnimations;

        setAnimations(updatedAnimations);
      }

      setSaveStatus('Unsaved changes');
    },
    [commitLayers],
  );

  const restoreSnapshot = useCallback(
    (snapshot: WorkspaceSnapshot) => {
      const restoredLayers =
        structuredClone(snapshot.layers);

      const restoredProjectItems =
        structuredClone(snapshot.projectItems);

      const restoredAnimations =
        structuredClone(snapshot.animations);

      layersRef.current = restoredLayers;

      projectItemsRef.current =
        restoredProjectItems;

      animationsRef.current =
        restoredAnimations;

      durationRef.current = snapshot.duration;

      backgroundColorRef.current =
        snapshot.backgroundColor;

      selectedLayerIdRef.current =
        snapshot.selectedLayerId;

      setLayers(restoredLayers);

      setProjectItems(restoredProjectItems);

      setAnimations(restoredAnimations);

      const restoredBookmarks = structuredClone(snapshot.bookmarks ?? []);

      bookmarksRef.current = restoredBookmarks;
      setBookmarks(restoredBookmarks);

      setDuration(snapshot.duration);

      setBackgroundColor(
        snapshot.backgroundColor,
      );

      setSelectedLayerId(
        snapshot.selectedLayerId,
      );

      setCurrentTime((time) =>
        clamp(time, 0, snapshot.duration),
      );

      if (snapshot.duration <= 0) {
        setIsPlaying(false);
      }

      setSaveStatus('Unsaved changes');
    },
    [],
  );

  const beginLayerEdit = useCallback(() => {
    const snapshot = createSnapshot();

    pastRef.current = [
      ...pastRef.current,
      snapshot,
    ].slice(-MAX_HISTORY);

    futureRef.current = [];

    setHistoryVersion((value) => value + 1);

    let active = true;

    return () => {
      if (!active) return;

      active = false;

      if (
        pastRef.current[
          pastRef.current.length - 1
        ] === snapshot
      ) {
        pastRef.current =
          pastRef.current.slice(0, -1);
      }

      restoreSnapshot(snapshot);

      setHistoryVersion((value) => value + 1);
    };
  }, [createSnapshot, restoreSnapshot]);

  const undo = useCallback(() => {
    const previous = pastRef.current.pop();

    if (!previous) return;

    futureRef.current = [
      ...futureRef.current,
      createSnapshot(),
    ].slice(-MAX_HISTORY);

    restoreSnapshot(previous);

    setHistoryVersion((value) => value + 1);
  }, [createSnapshot, restoreSnapshot]);

  const redo = useCallback(() => {
    const next = futureRef.current.pop();

    if (!next) return;

    pastRef.current = [
      ...pastRef.current,
      createSnapshot(),
    ].slice(-MAX_HISTORY);

    restoreSnapshot(next);

    setHistoryVersion((value) => value + 1);
  }, [createSnapshot, restoreSnapshot]);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  void historyVersion;

  // AUTOSAVE

  useEffect(() => {
    const storageKey =
      `${STORAGE_PREFIX}${project?.id ?? 'default'}`;

    setSaveStatus('Saving...');

    const timeout = window.setTimeout(() => {
      try {
        const data: PersistedWorkspace = {
          version: 5,

          projectName,
          width,
          height,
          backgroundColor,
          fps,

          layers,
          projectItems,
          animations,

          duration,
          currentTime: currentTimeRef.current,

          timelineZoom,
          previewZoom,

          selectedLayerId,
        };

        localStorage.setItem(
          storageKey,
          JSON.stringify(data),
        );

        setSaveStatus('All changes saved');
      } catch {
        setSaveStatus('Auto save failed');
      }
    }, 700);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    project?.id,
    projectName,
    width,
    height,
    backgroundColor,
    fps,
    layers,
    projectItems,
    animations,
    duration,
    timelineZoom,
    previewZoom,
    selectedLayerId,
  ]);

  // PLAYBACK

  useEffect(() => {
    if (!isPlaying || duration <= 0) {
      return;
    }

    const startedAt = performance.now();

    const startTime = currentTimeRef.current;

    const safeFps = Math.max(1, fps);

    let lastFrame = -1;
    let animationFrame = 0;

    // React state (timeline, panels) updates at ~15 Hz while playing.
    // The exact time always lives in currentTimeRef (used by the canvas).
    const UI_TIME_INTERVAL_MS = 66;
    let lastStateUpdate = 0;

    const updateTime = (now: number) => {
      const elapsedFrames = Math.floor(
        ((now - startedAt) / 1000) * safeFps,
      );

      if (elapsedFrames !== lastFrame) {
        lastFrame = elapsedFrames;

        const next = Math.min(
          startTime + elapsedFrames / safeFps,
          duration,
        );

        currentTimeRef.current = next;

        const finished = next >= duration;

        if (finished || now - lastStateUpdate >= UI_TIME_INTERVAL_MS) {
          lastStateUpdate = now;
          setCurrentTime(next);
        }

        if (finished) {
          setIsPlaying(false);
          return;
        }
      }

      animationFrame =
        window.requestAnimationFrame(updateTime);
    };

    animationFrame =
      window.requestAnimationFrame(updateTime);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      setCurrentTime(currentTimeRef.current);
    };
  }, [isPlaying, fps, duration]);

  const togglePlayback = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      return;
    }

    if (durationRef.current <= 0) {
      return;
    }

    if (
      currentTimeRef.current >=
      durationRef.current
    ) {
      currentTimeRef.current = 0;
      setCurrentTime(0);
    }

    setIsPlaying(true);
  }, [isPlaying]);

  const stopPlayback = useCallback(() => {
    setIsPlaying(false);
  }, []);

  const seekTimeline = useCallback(
    (time: number) => {
      if (!Number.isFinite(time)) return;

      const next = clamp(
        time,
        0,
        durationRef.current,
      );

      currentTimeRef.current = next;

      setCurrentTime(next);
    },
    [],
  );

  // PROJECT SETTINGS

  const updateProjectName = useCallback(
    (name: string) => {
      setProjectName(name);

      setProjectItems((current) => {
        const updated = current.map((item) =>
          item.type === 'composition'
            ? {
                ...item,
                name,
              }
            : item,
        );

        projectItemsRef.current = updated;

        return updated;
      });

      setSaveStatus('Unsaved changes');
    },
    [],
  );

  const updateProjectSettings = useCallback(
    (settings: {
      width?: number;
      height?: number;
      fps?: number;
    }) => {
      if (
        settings.width !== undefined &&
        settings.width > 0
      ) {
        const next = Math.min(
          settings.width,
          MAX_RESOLUTION,
        );

        widthRef.current = next;
        setWidth(next);
      }

      if (
        settings.height !== undefined &&
        settings.height > 0
      ) {
        const next = Math.min(
          settings.height,
          MAX_RESOLUTION,
        );

        heightRef.current = next;
        setHeight(next);
      }

      if (
        settings.fps !== undefined &&
        settings.fps > 0
      ) {
        setFps(
          clamp(settings.fps, MIN_FPS, MAX_FPS),
        );
      }

      setSaveStatus('Unsaved changes');
    },
    [],
  );

  // TOOLS

  const selectTool = useCallback(
    (tool: EditorTool) => {
      setActiveTool(tool);
    },
    [],
  );

  // LAYERS

  const addLayer = useCallback(
    (
      type: EditorLayerProperties['type'],

      source?: {
        name?: string;
        sourceId?: string;
        width?: number;
        height?: number;
        duration?: number;
        sourceDurationFrames?: number;
      },

      recordHistory = true,
    ) => {
      const typeNames: Record<
        EditorLayerProperties['type'],
        string
      > = {
        footage: 'Footage',
        video: 'Video',
        image: 'Image',
        audio: 'Audio',
        solid: 'Solid',
        text: 'Text',
        shape: 'Shape',
        null: 'Null',
        camera: 'Camera',
        light: 'Light',
        adjustment: 'Adjustment',
        precomp: 'Pre-comp',
      };

      let number =
        layersRef.current.filter(
          (layer) => layer.type === type,
        ).length + 1;

      let name =
        source?.name ??
        `${typeNames[type]} ${number}`;

      if (type === 'solid') {
        const existingNames = new Set(
          projectItemsRef.current.map(
            (item) => item.name,
          ),
        );

        while (
          existingNames.has(`${name} Source`)
        ) {
          number += 1;
          name = `${typeNames[type]} ${number}`;
        }
      }

      const textFontSize = Math.max(
        48,
        heightRef.current * 0.05,
      );

      const textSize =
        type === 'text'
          ? measureTextLayer(
              'Text',
              textFontSize,
            )
          : null;

      const layerWidth =
        type === 'solid' ||
        type === 'adjustment'
          ? widthRef.current
          : type === 'text'
            ? textSize?.width ?? textFontSize
            : type === 'null'
              ? 100
              : source?.width ?? 500;

      const layerHeight =
        type === 'solid' ||
        type === 'adjustment'
          ? heightRef.current
          : type === 'text'
            ? textSize?.height ?? textFontSize
            : type === 'null'
              ? 100
              : source?.height ?? 300;

      const sourceId =
        type === 'solid'
          ? createId('solid-source')
          : source?.sourceId ?? null;

      const sourceDuration =
        typeof source?.duration === 'number' &&
        Number.isFinite(source.duration) &&
        source.duration > 0
          ? source.duration
          : null;

      /**
       * Media layers use their actual duration.
       * New visual layers receive a 5-second default
       * so they are visible in an empty composition.
       */
      const layerDuration =
        sourceDuration ??
        Math.max(
          DEFAULT_LAYER_DURATION,
          durationRef.current -
            currentTimeRef.current,
        );

      const layer: EditorLayerProperties = {
        id: createId('layer'),

        name,
        type,

        x: widthRef.current / 2,
        y: heightRef.current / 2,

        width: layerWidth,
        height: layerHeight,

        rotation: 0,
        opacity: 100,

        scaleX: 100,
        scaleY: 100,

        anchorX: layerWidth / 2,
        anchorY: layerHeight / 2,

        labelColor: DEFAULT_LABEL_COLOR[type],

        locked: false,
        visible: true,

        parentId: null,

        inPoint: 0,
        outPoint: layerDuration,

        startTime: currentTimeRef.current,

        sourceId,

        sourceDurationFrames:
          source?.sourceDurationFrames,

        blendMode: 'normal',

        shy: false,
        collapseTransformations: false,

        quality: 'best',

        effectsEnabled: true,

        frameBlending: false,
        motionBlur: false,

        adjustmentLayer:
          type === 'adjustment',

        threeDLayer: false,

        preserveTransparency: false,

        trackMatte: 'none',

        matteSourceId: null,
        matteSourceWasVisible: true,

        stretch: 100,

        comments: '',

        effects: [],
        masks: [],

        expression: null,
      };

      if (recordHistory) {
        pushHistory();
      }

      const current = layersRef.current;

      const selectedIndex = current.findIndex(
        (existing) =>
          existing.id === selectedLayerIdRef.current,
      );

      const insertIndex =
        selectedIndex < 0
          ? 0
          : selectedIndex;

      const updated = [...current];

      updated.splice(
        insertIndex,
        0,
        layer,
      );

      commitLayers(updated);

      const updatedAnimations = [
        ...animationsRef.current,
        createEmptyAnimation(layer.id),
      ];

      animationsRef.current = updatedAnimations;
      setAnimations(updatedAnimations);

      if (type === 'solid' && sourceId) {
        const projectItem: WorkspaceProjectItem = {
          id: sourceId,
          name: `${name} Source`,
          type: 'solid',
        };

        const updatedItems = [
          ...projectItemsRef.current,
          projectItem,
        ];

        projectItemsRef.current = updatedItems;
        setProjectItems(updatedItems);
      }

      selectedLayerIdRef.current = layer.id;
      setSelectedLayerId(layer.id);

      setSaveStatus('Unsaved changes');

      return layer;
    },
    [pushHistory, commitLayers],
  );

  const updateCompositionBackground = useCallback(
    (color: string) => {
      if (
        !/^#[0-9a-f]{6}$/i.test(color) ||
        color === backgroundColorRef.current
      ) {
        return;
      }

      pushHistory();

      backgroundColorRef.current = color;

      setBackgroundColor(color);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  const importFootage = useCallback(
    (
      item: WorkspaceProjectItem,
      recordHistory = true,
    ) => {
      if (
        projectItemsRef.current.some(
          (existing) => existing.id === item.id,
        )
      ) {
        return;
      }

      if (recordHistory) {
        pushHistory();
      }

      const updatedItems = [
        ...projectItemsRef.current,
        item,
      ];

      projectItemsRef.current = updatedItems;

      setProjectItems(updatedItems);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  const addMediaLayer = useCallback(
    (
      item: WorkspaceProjectItem,
      recordHistory = true,
    ) => {
      if (!item.mediaType) {
        return null;
      }

      const type: EditorLayerProperties['type'] =
        item.mediaType;

      const sourceDurationFrames =
        item.duration === undefined ||
        item.duration <= 0
          ? undefined
          : Math.max(
              1,
              Math.round(item.duration * fps),
            );

      const durationSeconds =
        item.mediaType === 'image'
          ? DEFAULT_LAYER_DURATION
          : sourceDurationFrames === undefined
            ? item.duration
            : sourceDurationFrames / fps;

      return addLayer(
        type,
        {
          name: item.name,

          sourceId: item.id,

          width: item.width,
          height: item.height,

          duration: durationSeconds,

          sourceDurationFrames,
        },
        recordHistory,
      );
    },
    [addLayer, fps],
  );

  const fitSelectedLayer = useCallback(
    (
      mode: 'comp' | 'width' | 'height' = 'comp',
    ) => {
      const layer = layersRef.current.find(
        (item) =>
          item.id === selectedLayerIdRef.current,
      );

      if (!layer || layer.locked) return;

      const widthScale =
        (widthRef.current /
          Math.max(1, layer.width)) *
        100;

      const heightScale =
        (heightRef.current /
          Math.max(1, layer.height)) *
        100;

      const scale =
        mode === 'width'
          ? widthScale
          : mode === 'height'
            ? heightScale
            : Math.min(
                widthScale,
                heightScale,
              );

      if (
        Math.abs(
          (layer.scaleX ?? 100) - scale,
        ) < 0.001 &&
        Math.abs(
          (layer.scaleY ?? 100) - scale,
        ) < 0.001
      ) {
        return;
      }

      pushHistory();

      const updated = layersRef.current.map(
        (item) =>
          item.id === layer.id
            ? {
                ...item,
                scaleX: scale,
                scaleY: scale,
              }
            : item,
      );

      commitLayers(updated);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  const deleteUnusedProjectItem = useCallback(
    (itemId: string) => {
      if (
        !projectItemsRef.current.some(
          (item) => item.id === itemId,
        )
      ) {
        return;
      }

      pushHistory();

      const updated =
        projectItemsRef.current.filter(
          (item) => item.id !== itemId,
        );

      projectItemsRef.current = updated;

      setProjectItems(updated);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  const selectLayer = useCallback(
    (layerId: string | null) => {
      selectedLayerIdRef.current = layerId;
      setSelectedLayerId(layerId);
    },
    [],
  );

  const updateSelectedLayer = useCallback(
    (
      updates: Partial<EditorLayerProperties>,
    ) => {
      const layerId = selectedLayerIdRef.current;

      if (!layerId) return;

      const target = layersRef.current.find(
        (layer) => layer.id === layerId,
      );

      if (
        !target ||
        (
          target.locked &&
          Object.keys(updates).some(
            (key) =>
              !LOCK_SAFE_LAYER_FIELDS.has(key),
          )
        )
      ) {
        return;
      }

      pushHistory();

      const updated = layersRef.current.map(
        (layer) =>
          layer.id === layerId
            ? {
                ...layer,
                ...updates,
                id: layer.id,
                type: layer.type,
              }
            : layer,
      );

      commitLayers(updated);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  const updateLayer = useCallback(
    (
      layerId: string,
      updates: Partial<EditorLayerProperties>,
    ) => {
      const target = layersRef.current.find(
        (layer) => layer.id === layerId,
      );

      if (
        !target ||
        (
          target.locked &&
          Object.keys(updates).some(
            (key) =>
              !LOCK_SAFE_LAYER_FIELDS.has(key),
          )
        )
      ) {
        return;
      }

      const nextUpdates =
        target.type === 'text' &&
        updates.text !== undefined
          ? {
              ...updates,

              ...measureTextLayer(
                updates.text,
                Math.max(
                  48,
                  heightRef.current * 0.05,
                ),
              ),

              anchorX: undefined,
              anchorY: undefined,
            }
          : updates;

      const positionedUpdates =
        target.type === 'text' &&
        updates.text !== undefined
          ? {
              ...nextUpdates,

              anchorX:
                (nextUpdates.width ?? target.width) /
                2,

              anchorY:
                (nextUpdates.height ?? target.height) /
                2,
            }
          : nextUpdates;

      pushHistory();

      const updated = layersRef.current.map(
        (layer) =>
          layer.id === layerId
            ? {
                ...layer,
                ...positionedUpdates,
                id: layer.id,
                type: layer.type,
              }
            : layer,
      );

      commitLayers(updated);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  const toggleSoloLayer = useCallback(
    (layerId: string) => {
      const target = layersRef.current.find(
        (layer) => layer.id === layerId,
      );

      if (!target) return;

      const solo = !target.solo;

      pushHistory();

      const updated = layersRef.current.map(
        (layer) => ({
          ...layer,
          solo:
            solo &&
            layer.id === layerId,
        }),
      );

      commitLayers(updated);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  const deleteLayer = useCallback(() => {
    const layerId = selectedLayerIdRef.current;

    if (!layerId) return;

    const target = layersRef.current.find(
      (layer) => layer.id === layerId,
    );

    if (!target || target.locked) return;

    pushHistory();

    const remaining = layersRef.current.filter(
      (layer) => layer.id !== layerId,
    );

    const deletedSet = new Set([layerId]);

    const detached = remaining.map((layer) =>
      detachFromDeleted(
        layer,
        deletedSet,
        layersRef.current,
        widthRef.current,
        heightRef.current,
      ),
    );

    const updatedLayers = reconcileTrackMattes(
      layersRef.current,
      detached,
    );

    const updatedAnimations =
      animationsRef.current.filter(
        (animation) =>
          animation.layerId !== layerId,
      );

    commitLayers(updatedLayers);

    animationsRef.current = updatedAnimations;
    setAnimations(updatedAnimations);

    selectedLayerIdRef.current = null;
    setSelectedLayerId(null);

    setSaveStatus('Unsaved changes');
  }, [pushHistory, commitLayers]);

  const deleteLayers = useCallback(
    (layerIds: string[]) => {
      const ids = new Set(layerIds);

      const deletedIds = new Set(
        layersRef.current
          .filter(
            (layer) =>
              ids.has(layer.id) &&
              !layer.locked,
          )
          .map((layer) => layer.id),
      );

      if (deletedIds.size === 0) return;

      pushHistory();

      const remainingLayers =
        layersRef.current.filter(
          (layer) =>
            !deletedIds.has(layer.id),
        );

      const detachedLayers = remainingLayers.map((layer) =>
        detachFromDeleted(
          layer,
          deletedIds,
          layersRef.current,
          widthRef.current,
          heightRef.current,
        ),
      );

      const updatedLayers = reconcileTrackMattes(
        layersRef.current,
        detachedLayers,
      );

      const updatedAnimations =
        animationsRef.current.filter(
          (animation) =>
            !deletedIds.has(animation.layerId),
        );

      commitLayers(updatedLayers);

      animationsRef.current = updatedAnimations;
      setAnimations(updatedAnimations);

      if (
        selectedLayerIdRef.current &&
        deletedIds.has(
          selectedLayerIdRef.current,
        )
      ) {
        selectedLayerIdRef.current = null;
        setSelectedLayerId(null);
      }

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  /**
   * Group layers: a new group layer is created above the topmost member and
   * the members join it. One undo step.
   */
  const groupLayers = useCallback(
    (layerIds: string[]) => {
      const current = layersRef.current;
      const wanted = new Set(layerIds);

      // A member whose group is also selected stays inside that group.
      const hasSelectedGroup = (layer: EditorLayerProperties) => {
        let cursor = layer.groupId;
        let guard = 0;

        while (cursor && guard < current.length) {
          if (wanted.has(cursor)) return true;
          const groupId: string | null | undefined = cursor;
          cursor = current.find((item) => item.id === groupId)?.groupId;
          guard += 1;
        }

        return false;
      };

      const members = current.filter(
        (layer) =>
          wanted.has(layer.id) &&
          !layer.locked &&
          !hasSelectedGroup(layer),
      );

      if (members.length === 0) return;

      pushHistory();

      const memberIds = new Set(members.map((layer) => layer.id));
      const outerGroups = new Set(members.map((layer) => layer.groupId ?? ''));

      const group: EditorLayerProperties = {
        ...structuredClone(members[0]),
        id: createId('layer'),
        name: `Group ${current.filter(isGroupLayer).length + 1}`,
        type: 'null',
        isGroup: true,
        groupId: outerGroups.size === 1 ? members[0].groupId ?? null : null,
        parentId: null,
        x: widthRef.current / 2,
        y: heightRef.current / 2,
        width: 100,
        height: 100,
        anchorX: 50,
        anchorY: 50,
        rotation: 0,
        opacity: 100,
        scaleX: 100,
        scaleY: 100,
        sourceId: null,
        sourceDurationFrames: undefined,
        labelColor: DEFAULT_LABEL_COLOR.null,
        blendMode: 'normal',
        trackMatte: 'none',
        matteSourceId: null,
        adjustmentLayer: false,
        threeDLayer: false,
        preserveTransparency: false,
        locked: false,
        visible: true,
        comments: '',
        effects: [],
        masks: [],
        expression: null,
      };

      const updated = current.map((layer) =>
        memberIds.has(layer.id) ? { ...layer, groupId: group.id } : layer,
      );

      updated.splice(
        current.findIndex((layer) => layer.id === members[0].id),
        0,
        group,
      );

      commitLayers(updated);

      const updatedAnimations = [
        ...animationsRef.current,
        createEmptyAnimation(group.id),
      ];

      animationsRef.current = updatedAnimations;
      setAnimations(updatedAnimations);

      selectedLayerIdRef.current = group.id;
      setSelectedLayerId(group.id);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  /**
   * Ungroup: the group layer is removed and its members keep their place on
   * screen. (Deleting a group does the same.)
   */
  const ungroupLayers = useCallback(
    (layerIds: string[]) => {
      const groupIds = layersRef.current
        .filter((layer) => layerIds.includes(layer.id) && isGroupLayer(layer))
        .map((layer) => layer.id);

      if (groupIds.length > 0) {
        deleteLayers(groupIds);
      }
    },
    [deleteLayers],
  );

  const duplicateLayers = useCallback(
    (layerIds: string[]) => {
      const selected = layersRef.current.filter(
        (layer) =>
          layerIds.includes(layer.id) &&
          !layer.locked,
      );

      if (!selected.length) return;

      pushHistory();

      const duplicates = selected.map(
        (layer) => ({
          ...structuredClone(layer),

          id: createId('layer'),

          name: `${layer.name} copy`,

          x: layer.x + 10,
          y: layer.y + 10,
        }),
      );

      const duplicateAnimations = duplicates.map(
        (duplicate, index) => {
          const source = animationsRef.current.find(
            (animation) =>
              animation.layerId ===
              selected[index].id,
          );

          return source
            ? {
                ...structuredClone(source),
                layerId: duplicate.id,
              }
            : createEmptyAnimation(
                duplicate.id,
              );
        },
      );

      const updatedLayers = [
        ...layersRef.current,
        ...duplicates,
      ];

      const updatedAnimations = [
        ...animationsRef.current,
        ...duplicateAnimations,
      ];

      commitLayers(updatedLayers);

      animationsRef.current = updatedAnimations;
      setAnimations(updatedAnimations);

      selectedLayerIdRef.current =
        duplicates[0].id;

      setSelectedLayerId(duplicates[0].id);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  const splitLayers = useCallback(
    (
      layerIds: string[],
      time: number,
    ) => {
      const splits = layersRef.current.flatMap(
        (layer) => {
          if (
            !layerIds.includes(layer.id) ||
            layer.locked
          ) {
            return [];
          }

          const start = layer.startTime ?? 0;
          const inPoint = layer.inPoint ?? 0;
          const outPoint =
            layer.outPoint ?? durationRef.current;

          const stretch =
            typeof layer.stretch === 'number' &&
            layer.stretch > 0
              ? layer.stretch / 100
              : 1;

          const splitSourceTime =
            inPoint + (time - start) / stretch;

          if (
            time <= start ||
            splitSourceTime >= outPoint ||
            splitSourceTime <= inPoint
          ) {
            return [];
          }

          return [
            {
              layer,
              splitSourceTime,
            },
          ];
        },
      );

      if (!splits.length) return;

      pushHistory();

      const updatedLayers = [
        ...layersRef.current,
      ];

      const duplicateAnimations: LayerAnimation[] = [];

      for (const {
        layer,
        splitSourceTime,
      } of splits) {
        const duplicate = {
          ...structuredClone(layer),

          id: createId('layer'),

          name: `${layer.name} (2)`,

          startTime: time,

          inPoint: splitSourceTime,
        };

        const originalIndex =
          updatedLayers.findIndex(
            (item) => item.id === layer.id,
          );

        updatedLayers[originalIndex] = {
          ...layer,
          outPoint: splitSourceTime,
        };

        updatedLayers.splice(
          originalIndex + 1,
          0,
          duplicate,
        );

        const animation =
          animationsRef.current.find(
            (item) =>
              item.layerId === layer.id,
          );

        if (animation) {
          duplicateAnimations.push({
            ...structuredClone(animation),
            layerId: duplicate.id,
          });
        } else {
          duplicateAnimations.push(
            createEmptyAnimation(duplicate.id),
          );
        }
      }

      const updatedAnimations = [
        ...animationsRef.current,
        ...duplicateAnimations,
      ];

      commitLayers(updatedLayers);

      animationsRef.current = updatedAnimations;
      setAnimations(updatedAnimations);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  // MOTION ANIMATION

  const getLayerAnimation = useCallback(
    (layerId: string) =>
      animationsRef.current.find(
        (animation) =>
          animation.layerId === layerId,
      ) ?? createEmptyAnimation(layerId),
    [],
  );

  const addKeyframe = useCallback(
    (
      layerId: string,

      propertyName: AnimatedPropertyName,

      value: number,

      time = currentTime,

      interpolation: KeyframeInterpolation =
        'linear',

      recordHistory = true,
    ) => {
      if (
        !Number.isFinite(value) ||
        !Number.isFinite(time)
      ) {
        return;
      }

      const layer = layersRef.current.find(
        (item) => item.id === layerId,
      );

      if (!layer || layer.locked) return;

      const safeTime = clamp(
        time,
        0,
        durationRef.current,
      );

      if (recordHistory) {
        pushHistory();
      }

      const current = animationsRef.current;

      const existing = current.find(
        (animation) =>
          animation.layerId === layerId,
      );

      const animation =
        existing ??
        createEmptyAnimation(layerId);

      const property =
        animation.properties[propertyName];

      const keyframe: Keyframe = {
        id: createId('keyframe'),

        time: safeTime,

        value,

        interpolation,
      };

      const keyframes = [
        ...property.keyframes.filter(
          (item) =>
            Math.abs(item.time - safeTime) >
            0.0001,
        ),

        keyframe,
      ].sort(
        (a, b) => a.time - b.time,
      );

      const updatedAnimation: LayerAnimation = {
        ...animation,

        properties: {
          ...animation.properties,

          [propertyName]: {
            ...property,
            keyframes,
          },
        },
      };

      const updated = existing
        ? current.map((item) =>
            item.layerId === layerId
              ? updatedAnimation
              : item,
          )
        : [
            ...current,
            updatedAnimation,
          ];

      animationsRef.current = updated;
      setAnimations(updated);

      setSaveStatus('Unsaved changes');
    },
    [currentTime, pushHistory],
  );

  const updateKeyframe = useCallback(
    (
      layerId: string,

      propertyName: AnimatedPropertyName,

      keyframeId: string,

      updates: Partial<
        Pick<
          Keyframe,
          'time' | 'value' | 'interpolation'
        >
      >,

      recordHistory = true,
    ) => {
      if (recordHistory) {
        pushHistory();
      }

      const updated = animationsRef.current.map(
        (animation) => {
          if (animation.layerId !== layerId) {
            return animation;
          }

          const property =
            animation.properties[propertyName];

          return {
            ...animation,

            properties: {
              ...animation.properties,

              [propertyName]: {
                ...property,

                keyframes: property.keyframes
                  .map((keyframe) =>
                    keyframe.id === keyframeId
                      ? {
                          ...keyframe,
                          ...updates,

                          time:
                            updates.time !== undefined
                              ? clamp(
                                  updates.time,
                                  0,
                                  durationRef.current,
                                )
                              : keyframe.time,
                        }
                      : keyframe,
                  )
                  .sort(
                    (a, b) => a.time - b.time,
                  ),
              },
            },
          };
        },
      );

      animationsRef.current = updated;
      setAnimations(updated);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  const deleteKeyframe = useCallback(
    (
      layerId: string,

      propertyName: AnimatedPropertyName,

      keyframeId: string,

      recordHistory = true,
    ) => {
      if (recordHistory) {
        pushHistory();
      }

      const updated = animationsRef.current.map(
        (animation) =>
          animation.layerId !== layerId
            ? animation
            : {
                ...animation,

                properties: {
                  ...animation.properties,

                  [propertyName]: {
                    ...animation.properties[
                      propertyName
                    ],

                    keyframes:
                      animation.properties[
                        propertyName
                      ].keyframes.filter(
                        (keyframe) =>
                          keyframe.id !== keyframeId,
                      ),
                  },
                },
              },
      );

      animationsRef.current = updated;
      setAnimations(updated);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  /**
   * Mirror layers. Horizontal = left-right (Scale X * -1),
   * vertical = top-bottom (Scale Y * -1). Only the chosen axis
   * changes, and every keyframe of that scale is flipped too.
   * One undo step.
   */
  const flipLayers = useCallback(
    (layerIds: string[], axis: 'horizontal' | 'vertical') => {
      const wanted = new Set(layerIds);
      const targetIds = new Set(
        layersRef.current
          .filter((layer) => wanted.has(layer.id) && !layer.locked)
          .map((layer) => layer.id),
      );

      if (targetIds.size === 0) return;

      pushHistory();

      commitLayers(
        layersRef.current.map((layer) => {
          if (!targetIds.has(layer.id)) return layer;
          return axis === 'horizontal'
            ? { ...layer, scaleX: -(layer.scaleX ?? 100) }
            : { ...layer, scaleY: -(layer.scaleY ?? 100) };
        }),
      );

      const propertyName: AnimatedPropertyName =
        axis === 'horizontal' ? 'scaleX' : 'scaleY';

      const nextAnimations = animationsRef.current.map(
        (animation) => {
          if (!targetIds.has(animation.layerId)) return animation;

          const property = animation.properties[propertyName];
          if (!property || property.keyframes.length === 0) {
            return animation;
          }

          const properties = { ...animation.properties };
          properties[propertyName] = {
            ...property,
            keyframes: property.keyframes.map((keyframe) => ({
              ...keyframe,
              value: -keyframe.value,
            })),
          };

          return { ...animation, properties };
        },
      );

      animationsRef.current = nextAnimations;
      setAnimations(nextAnimations);

      setSaveStatus('Unsaved changes');
    },
    [pushHistory, commitLayers],
  );

  // ---- Right-click menu actions (Part 5A) ----
  const clipboardRef = useRef<{
    layers: EditorLayerProperties[];
    animations: LayerAnimation[];
  } | null>(null);
  const [clipboardCount, setClipboardCount] = useState(0);
  const effectsClipboardRef = useRef<EditorLayerProperties['effects'] | null>(null);
  const [hasEffectsClipboard, setHasEffectsClipboard] = useState(false);

  // Removes every keyframe of the given properties on the given layers.
  const clearKeyframes = useCallback(
    (layerIds: Set<string>, names: AnimatedPropertyName[]) => {
      const next = animationsRef.current.map((animation) => {
        if (!layerIds.has(animation.layerId)) return animation;

        const properties = { ...animation.properties };

        for (const name of names) {
          const property = properties[name];

          if (property && property.keyframes.length > 0) {
            properties[name] = { ...property, keyframes: [] };
          }
        }

        return { ...animation, properties };
      });

      animationsRef.current = next;
      setAnimations(next);
    },
    [],
  );

  const copyLayers = useCallback((layerIds: string[]) => {
    const copied = layersRef.current.filter((layer) =>
      layerIds.includes(layer.id),
    );

    if (copied.length === 0) return 0;

    clipboardRef.current = {
      layers: structuredClone(copied),
      animations: structuredClone(
        animationsRef.current.filter((animation) =>
          layerIds.includes(animation.layerId),
        ),
      ),
    };

    setClipboardCount(copied.length);

    return copied.length;
  }, []);

  const cutLayers = useCallback(
    (layerIds: string[]) => {
      if (copyLayers(layerIds) > 0) {
        deleteLayers(layerIds);
      }
    },
    [copyLayers, deleteLayers],
  );

  // Pastes the copied layers at the playhead, on top of the strip. A layer
  // keeps its Link To / group when the target still exists (or was copied too).
  const pasteLayers = useCallback(() => {
    const clip = clipboardRef.current;

    if (!clip || clip.layers.length === 0) return;

    pushHistory();

    const idMap = new Map(
      clip.layers.map((layer) => [layer.id, createId('layer')]),
    );

    const keepLink = (id: string | null | undefined): string | null => {
      if (!id) return null;
      if (idMap.has(id)) return idMap.get(id) ?? null;

      return layersRef.current.some((item) => item.id === id) ? id : null;
    };

    const shift =
      currentTimeRef.current -
      Math.min(...clip.layers.map((layer) => layer.startTime ?? 0));

    const pasted = clip.layers.map((layer) => ({
      ...structuredClone(layer),
      id: idMap.get(layer.id) as string,
      startTime: Math.max(0, (layer.startTime ?? 0) + shift),
      parentId: keepLink(layer.parentId),
      groupId: keepLink(layer.groupId),
      locked: false,
    }));

    const pastedAnimations = pasted.map((layer, index) => {
      const original = clip.layers[index];
      const source = clip.animations.find(
        (animation) => animation.layerId === original.id,
      );

      if (!source) return createEmptyAnimation(layer.id);

      const delta = layer.startTime - (original.startTime ?? 0);
      const copy = structuredClone(source);

      copy.layerId = layer.id;

      for (const name of Object.keys(copy.properties) as AnimatedPropertyName[]) {
        copy.properties[name] = {
          ...copy.properties[name],
          keyframes: copy.properties[name].keyframes.map((keyframe) => ({
            ...keyframe,
            time: Math.max(0, keyframe.time + delta),
          })),
        };
      }

      return copy;
    });

    commitLayers([...pasted, ...layersRef.current]);

    const updatedAnimations = [...animationsRef.current, ...pastedAnimations];

    animationsRef.current = updatedAnimations;
    setAnimations(updatedAnimations);

    selectedLayerIdRef.current = pasted[0].id;
    setSelectedLayerId(pasted[0].id);

    setSaveStatus('Unsaved changes');
  }, [pushHistory, commitLayers]);

  const copyEffects = useCallback((layerId: string) => {
    const layer = layersRef.current.find((item) => item.id === layerId);

    if (!layer) return;

    effectsClipboardRef.current = structuredClone(layer.effects ?? []);
    setHasEffectsClipboard(true);
  }, []);

  const pasteEffects = useCallback(
    (layerIds: string[]) => {
      const effects = effectsClipboardRef.current;

      if (!effects) return;

      const targets = new Set(
        layersRef.current
          .filter((layer) => layerIds.includes(layer.id) && !layer.locked)
          .map((layer) => layer.id),
      );

      if (targets.size === 0) return;

      pushHistory();

      commitLayers(
        layersRef.current.map((layer) =>
          targets.has(layer.id)
            ? { ...layer, effects: structuredClone(effects) }
            : layer,
        ),
      );
    },
    [pushHistory, commitLayers],
  );

  // Bring to Front / Send to Back / Move Up / Move Down (strip order, top = 0).
  const moveLayerOrder = useCallback(
    (layerIds: string[], mode: 'front' | 'back' | 'up' | 'down') => {
      const chosen = new Set(layerIds);
      const current = layersRef.current;
      const movable = (layer: EditorLayerProperties) =>
        chosen.has(layer.id) && !layer.locked;
      let next = [...current];

      if (mode === 'front') {
        next = [
          ...current.filter(movable),
          ...current.filter((layer) => !movable(layer)),
        ];
      } else if (mode === 'back') {
        next = [
          ...current.filter((layer) => !movable(layer)),
          ...current.filter(movable),
        ];
      } else if (mode === 'up') {
        for (let index = 1; index < next.length; index += 1) {
          if (movable(next[index]) && !chosen.has(next[index - 1].id) && !next[index - 1].locked) {
            [next[index], next[index - 1]] = [next[index - 1], next[index]];
          }
        }
      } else {
        for (let index = next.length - 2; index >= 0; index -= 1) {
          if (movable(next[index]) && !chosen.has(next[index + 1].id) && !next[index + 1].locked) {
            [next[index], next[index + 1]] = [next[index + 1], next[index]];
          }
        }
      }

      if (next.every((layer, index) => layer.id === current[index].id)) return;

      pushHistory();
      commitLayers(next);
    },
    [pushHistory, commitLayers],
  );

  // Back to the default transform. Transform keyframes are removed too,
  // otherwise they would win over the reset values.
  const resetTransform = useCallback(
    (layerIds: string[]) => {
      const targets = new Set(
        layersRef.current
          .filter((layer) => layerIds.includes(layer.id) && !layer.locked)
          .map((layer) => layer.id),
      );

      if (targets.size === 0) return;

      pushHistory();

      commitLayers(
        layersRef.current.map((layer) =>
          targets.has(layer.id)
            ? {
                ...layer,
                x: widthRef.current / 2,
                y: heightRef.current / 2,
                rotation: 0,
                opacity: 100,
                scaleX: 100,
                scaleY: 100,
                anchorX: layer.width / 2,
                anchorY: layer.height / 2,
                z: 0,
                scaleZ: 100,
                orientationX: 0,
                orientationY: 0,
                orientationZ: 0,
                rotationX: 0,
                rotationY: 0,
              }
            : layer,
        ),
      );

      clearKeyframes(targets, [
        'positionX',
        'positionY',
        'scaleX',
        'scaleY',
        'rotation',
        'opacity',
        'anchorX',
        'anchorY',
      ]);
    },
    [pushHistory, commitLayers, clearKeyframes],
  );

  // Fit (whole layer inside the canvas) or Fill (canvas fully covered).
  // The layer's centre goes to the canvas centre, flips are kept.
  const fitLayersToCanvas = useCallback(
    (layerIds: string[], mode: 'fit' | 'fill') => {
      const targets = new Set(
        layersRef.current
          .filter((layer) => layerIds.includes(layer.id) && !layer.locked)
          .map((layer) => layer.id),
      );

      if (targets.size === 0) return;

      pushHistory();

      const canvasWidth = widthRef.current;
      const canvasHeight = heightRef.current;

      commitLayers(
        layersRef.current.map((layer) => {
          if (!targets.has(layer.id)) return layer;

          const widthScale = canvasWidth / Math.max(1, layer.width);
          const heightScale = canvasHeight / Math.max(1, layer.height);
          const scale =
            mode === 'fit'
              ? Math.min(widthScale, heightScale)
              : Math.max(widthScale, heightScale);

          const scaleX = (layer.scaleX ?? 100) < 0 ? -scale * 100 : scale * 100;
          const scaleY = (layer.scaleY ?? 100) < 0 ? -scale * 100 : scale * 100;
          const anchorX = layer.anchorX ?? layer.width / 2;
          const anchorY = layer.anchorY ?? layer.height / 2;
          const offsetX = (layer.width / 2 - anchorX) * (scaleX / 100);
          const offsetY = (layer.height / 2 - anchorY) * (scaleY / 100);
          const radians = (layer.rotation * Math.PI) / 180;

          return {
            ...layer,
            scaleX,
            scaleY,
            x: canvasWidth / 2 - (offsetX * Math.cos(radians) - offsetY * Math.sin(radians)),
            y: canvasHeight / 2 - (offsetX * Math.sin(radians) + offsetY * Math.cos(radians)),
          };
        }),
      );

      clearKeyframes(targets, ['positionX', 'positionY', 'scaleX', 'scaleY']);
    },
    [pushHistory, commitLayers, clearKeyframes],
  );

  // Align in time: Left = same start, Right = same end, Sequential = one
  // after another (in order of their start time).
  const alignLayers = useCallback(
    (layerIds: string[], mode: 'left' | 'sequential' | 'right') => {
      const chosen = layersRef.current.filter(
        (layer) =>
          layerIds.includes(layer.id) && !layer.locked && !isGroupLayer(layer),
      );

      if (chosen.length < 2) return;

      const span = (layer: EditorLayerProperties) =>
        Math.max(0, (layer.outPoint ?? 0) - (layer.inPoint ?? 0)) *
        (Math.max(0.01, layer.stretch ?? 100) / 100);

      const startOf = (layer: EditorLayerProperties) => layer.startTime ?? 0;
      const placement = new Map<string, number>();

      if (mode === 'left') {
        const start = Math.min(...chosen.map(startOf));

        chosen.forEach((layer) => placement.set(layer.id, start));
      } else if (mode === 'right') {
        const end = Math.max(...chosen.map((layer) => startOf(layer) + span(layer)));

        chosen.forEach((layer) =>
          placement.set(layer.id, Math.max(0, end - span(layer))),
        );
      } else {
        let cursor = Math.min(...chosen.map(startOf));

        [...chosen]
          .sort((a, b) => startOf(a) - startOf(b))
          .forEach((layer) => {
            placement.set(layer.id, cursor);
            cursor += span(layer);
          });
      }

      beginLayerEdit();
      updateLayers(
        Object.fromEntries(
          [...placement].map(([id, startTime]) => [id, { startTime }]),
        ),
      );
    },
    [beginLayerEdit, updateLayers],
  );

  // One keyframe per property at the playhead, holding the current value.
  const addKeyframesAtPlayhead = useCallback(
    (
      layerIds: string[],
      kinds: Array<'position' | 'scale' | 'rotation' | 'opacity'>,
    ) => {
      const time = currentTimeRef.current;
      const targets = layersRef.current.filter(
        (layer) => layerIds.includes(layer.id) && !layer.locked,
      );

      if (targets.length === 0) return;

      pushHistory();

      const namesByKind: Record<(typeof kinds)[number], AnimatedPropertyName[]> = {
        position: ['positionX', 'positionY'],
        scale: ['scaleX', 'scaleY'],
        rotation: ['rotation'],
        opacity: ['opacity'],
      };

      for (const layer of targets) {
        const animation = animationsRef.current.find(
          (item) => item.layerId === layer.id,
        );

        const fallbacks: Partial<Record<AnimatedPropertyName, number>> = {
          positionX: layer.x,
          positionY: layer.y,
          scaleX: layer.scaleX ?? 100,
          scaleY: layer.scaleY ?? 100,
          rotation: layer.rotation,
          opacity: layer.opacity,
        };

        for (const kind of kinds) {
          for (const name of namesByKind[kind]) {
            const value = evaluateProperty(
              animation?.properties[name]?.keyframes ?? [],
              time,
              fallbacks[name] ?? 0,
            );

            addKeyframe(layer.id, name, value, time, 'linear', false);
          }
        }
      }
    },
    [pushHistory, addKeyframe],
  );

  // ---- Bookmarks (markers on the ruler) ----
  const addBookmark = useCallback(
    (time?: number) => {
      const at = Math.max(
        0,
        Math.min(durationRef.current, time ?? currentTimeRef.current),
      );

      if (bookmarksRef.current.some((item) => Math.abs(item.time - at) < 0.0005)) {
        return;
      }

      pushHistory();

      const next = [
        ...bookmarksRef.current,
        { id: createId('bookmark'), time: at },
      ].sort((a, b) => a.time - b.time);

      bookmarksRef.current = next;
      setBookmarks(next);
      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  const removeBookmark = useCallback(
    (bookmarkId: string) => {
      if (!bookmarksRef.current.some((item) => item.id === bookmarkId)) return;

      pushHistory();

      const next = bookmarksRef.current.filter((item) => item.id !== bookmarkId);

      bookmarksRef.current = next;
      setBookmarks(next);
      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  const clearBookmarks = useCallback(() => {
    if (bookmarksRef.current.length === 0) return;

    pushHistory();

    bookmarksRef.current = [];
    setBookmarks([]);
    setSaveStatus('Unsaved changes');
  }, [pushHistory]);

  // The M key: a bookmark at the playhead, or removes the one that is there.
  const toggleBookmark = useCallback(() => {
    const time = currentTimeRef.current;
    const existing = bookmarksRef.current.find(
      (item) => Math.abs(item.time - time) < 0.02,
    );

    if (existing) {
      removeBookmark(existing.id);
    } else {
      addBookmark(time);
    }
  }, [addBookmark, removeBookmark]);

  const getAnimatedLayer = useCallback(
    (
      layer: EditorLayerProperties,
      time = currentTime,
    ) => {
      const animation = animations.find(
        (item) => item.layerId === layer.id,
      );

      if (!animation) return layer;

      const value = (
        propertyName: AnimatedPropertyName,
        fallback: number,
      ) =>
        evaluateProperty(
          animation.properties[propertyName]
            ?.keyframes ?? [],
          time,
          fallback,
        );

      return {
        ...layer,

        x: value('positionX', layer.x),
        y: value('positionY', layer.y),

        scaleX: value(
          'scaleX',
          layer.scaleX ?? 100,
        ),

        scaleY: value(
          'scaleY',
          layer.scaleY ?? 100,
        ),

        rotation: value(
          'rotation',
          layer.rotation,
        ),

        opacity: value(
          'opacity',
          layer.opacity,
        ),

        anchorX: value(
          'anchorX',
          layer.anchorX ?? layer.width / 2,
        ),

        anchorY: value(
          'anchorY',
          layer.anchorY ?? layer.height / 2,
        ),
      };
    },
    [animations, currentTime],
  );

  const getCurrentTime = useCallback(
    () => currentTimeRef.current,
    [],
  );

  // ZOOM AND DURATION

  const updateTimelineZoom = useCallback(
    (zoom: number) => {
      if (Number.isFinite(zoom)) {
        setTimelineZoom(
          clamp(zoom, 25, 400),
        );
      }
    },
    [],
  );

  const updatePreviewZoom = useCallback(
    (zoom: number) => {
      if (Number.isFinite(zoom)) {
        setPreviewZoom(
          zoom <= 0 ? 0 : clamp(zoom, 25, 400),
        );
      }
    },
    [],
  );

  /**
   * Manual duration update.
   *
   * A composition with no layers remains at zero.
   * A manual duration cannot be shorter than its clips.
   */
  const updateDuration = useCallback(
    (seconds: number) => {
      if (
        !Number.isFinite(seconds) ||
        seconds <= 0 ||
        layersRef.current.length === 0
      ) {
        return;
      }

      const requiredDuration =
        getCompositionDuration(
          layersRef.current,
        );

      const nextDuration = Math.max(
        seconds,
        requiredDuration,
      );

      if (
        nextDuration === durationRef.current
      ) {
        return;
      }

      pushHistory();

      durationRef.current = nextDuration;

      setDuration(nextDuration);

      setCurrentTime((time) =>
        Math.min(time, nextDuration),
      );

      setSaveStatus('Unsaved changes');
    },
    [pushHistory],
  );

  const markSaved = useCallback(() => {
    setSaveStatus('All changes saved');
  }, []);

  const markUnsaved = useCallback(() => {
    setSaveStatus('Unsaved changes');
  }, []);

  return {
    projectName,
    setProjectName: updateProjectName,

    width,
    height,

    backgroundColor,
    updateCompositionBackground,

    fps,
    updateProjectSettings,

    activeTool,
    selectTool,

    duration,

    layers,
    selectedLayer,
    selectedLayerId,
    selectLayer,

    addLayer,
    importFootage,
    addMediaLayer,

    fitSelectedLayer,
    deleteUnusedProjectItem,

    beginLayerEdit,
    updateLayers,
    updateSelectedLayer,
    updateLayer,

    toggleSoloLayer,

    deleteLayer,
    deleteLayers,
    duplicateLayers,
    splitLayers,
    flipLayers,
    groupLayers,
    ungroupLayers,
    copyLayers,
    cutLayers,
    pasteLayers,
    clipboardCount,
    copyEffects,
    pasteEffects,
    hasEffectsClipboard,
    moveLayerOrder,
    resetTransform,
    fitLayersToCanvas,
    alignLayers,
    addKeyframesAtPlayhead,
    bookmarks,
    addBookmark,
    removeBookmark,
    clearBookmarks,
    toggleBookmark,

    projectItems,

    animations,
    getLayerAnimation,
    addKeyframe,
    updateKeyframe,
    deleteKeyframe,
    getAnimatedLayer,

    currentTime,
    getCurrentTime,
    seekTimeline,

    updateDuration,

    timelineZoom,
    updateTimelineZoom,

    previewZoom,
    updatePreviewZoom,

    isPlaying,
    togglePlayback,
    stopPlayback,

    undo,
    redo,
    canUndo,
    canRedo,

    saveStatus,
    markSaved,
    markUnsaved,
  };
}