
export type Project = {
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  updatedAt: string;
};

export type LayerType =
  | 'footage'
  | 'solid'
  | 'video'
  | 'audio'
  | 'text'
  | 'image'
  | 'shape'
  | 'null'
  | 'camera'
  | 'light'
  | 'adjustment'
  | 'precomp';

export type BlendMode =
  | 'normal'
  | 'dissolve'
  | 'darken'
  | 'multiply'
  | 'color-burn'
  | 'linear-burn'
  | 'lighten'
  | 'screen'
  | 'color-dodge'
  | 'linear-dodge'
  | 'overlay'
  | 'soft-light'
  | 'hard-light'
  | 'vivid-light'
  | 'linear-light'
  | 'pin-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

export type TrackMatteMode =
  | 'none'
  | 'alpha'
  | 'alpha-inverted'
  | 'luma'
  | 'luma-inverted';

export type EditorLayerProperties = {
  id: string;
  name: string;
  type: LayerType;

  x: number;
  y: number;

  width: number;
  height: number;

  rotation: number;
  opacity: number;

  scaleX?: number;
  scaleY?: number;
  z?: number;
  scaleZ?: number;
  orientationX?: number;
  orientationY?: number;
  orientationZ?: number;
  rotationX?: number;
  rotationY?: number;

  anchorX?: number;
  anchorY?: number;
  labelColor?: number;

  locked?: boolean;
  visible?: boolean;

  parentId?: string | null;

  // Timeline conversion properties
  inPoint?: number;
  outPoint?: number;
  startTime?: number;
  sourceId?: string | null;

  // Motion properties
  blendMode?: BlendMode;
  effects?: LayerEffect[];
  masks?: LayerMask[];
  expression?: string | null;
  text?: string;
  sourceDurationFrames?: number;
  solo?: boolean;
  audioMuted?: boolean;
  shy?: boolean;
  collapseTransformations?: boolean;
  quality?: 'draft' | 'best';
  effectsEnabled?: boolean;
  frameBlending?: boolean;
  motionBlur?: boolean;
  adjustmentLayer?: boolean;
  applyTo?: 'all-below' | 'layer-below';
  borderMode?: 'clamp' | 'extend' | 'mirror';
  /** A group is a "null" layer with isGroup = true. */
  isGroup?: boolean;
  /** The group this layer belongs to (null = none). */
  groupId?: string | null;
  threeDLayer?: boolean;
  preserveTransparency?: boolean;
  trackMatte?: TrackMatteMode;
  matteSourceId?: string | null;
  matteSourceWasVisible?: boolean;
  stretch?: number;
  comments?: string;
};

export type WorkspaceMediaType = 'image' | 'video' | 'audio';

export type WorkspaceProjectItem = {
  id: string;
  name: string;
  type:
    | 'footage-image'
    | 'footage-video'
    | 'footage-audio'
    | 'footage'
    | 'solid'
    | 'composition'
    | 'folder';
  mediaType?: WorkspaceMediaType;
  size?: number;
  duration?: number;
  frameRate?: number;
  width?: number;
  height?: number;
  thumbnail?: string;
  missing?: boolean;
};

export type EditorTool =
  | 'select'
  | 'hand'
  | 'text'
  | 'shape'
  | 'image'
  | 'video'
  | 'pen'
  | 'anchor';

export type AnimatedPropertyName =
  | 'positionX'
  | 'positionY'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'anchorX'
  | 'anchorY';

export type KeyframeInterpolation =
  | 'linear'
  | 'hold'
  | 'ease-in'
  | 'ease-out'
  | 'ease-in-out';

export type Keyframe = {
  id: string;
  time: number;
  value: number;
  interpolation: KeyframeInterpolation;
};

export type AnimatedProperty = {
  name: AnimatedPropertyName;
  keyframes: Keyframe[];
};

export type LayerAnimation = {
  layerId: string;
  properties: Record<AnimatedPropertyName, AnimatedProperty>;
};

export type MotionLayer = {
  id: string;
  name: string;
  type: LayerType;

  expanded: boolean;
  visible: boolean;
  locked: boolean;

  parentId: string | null;
  animation: LayerAnimation;
};

export type GraphPoint = {
  keyframeId: string;
  time: number;
  value: number;
};

export type GraphEditorState = {
  enabled: boolean;
  selectedProperty: AnimatedPropertyName | null;
  zoom: number;
};

export type LayerEffect = {
  id: string;
  name: string;
  enabled: boolean;
  properties: Record<string, number | boolean>;
};

export type LayerMask = {
  id: string;
  name: string;
  enabled: boolean;
  opacity: number;
};

export type TimelineSettings = {
  zoom: number;
  height: number;
  snapEnabled: boolean;
  showWaveforms: boolean;
  showKeyframes: boolean;
};

export type EditorSnapshot = {
  layers: EditorLayerProperties[];
  projectItems: WorkspaceProjectItem[];
  duration: number;
  animations?: LayerAnimation[];
};
