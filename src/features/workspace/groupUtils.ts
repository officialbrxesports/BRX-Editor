import type { EditorLayerProperties } from '../project/project.types';

// Groups (Step 7B, Part 3B).
//
// A group is a "null"-type layer with isGroup = true. Its members point to it
// with groupId. A group's position, scale and rotation move its members
// (around the group's position), its opacity is multiplied into theirs, and a
// hidden group hides them. Link To (parentId) replaces the group's transform
// for a layer; group opacity and visibility still apply.

export type Frame = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number; // 1 = 100 %
  scaleY: number;
};

export function isGroupLayer(layer: EditorLayerProperties): boolean {
  return layer.isGroup === true;
}

/** Ids of every layer inside a group, including nested groups. */
export function getGroupDescendantIds(
  layers: EditorLayerProperties[],
  groupId: string,
): string[] {
  const result: string[] = [];
  const queue = [groupId];
  const seen = new Set<string>([groupId]);

  while (queue.length > 0) {
    const current = queue.shift() as string;

    for (const layer of layers) {
      if (layer.groupId === current && !seen.has(layer.id)) {
        seen.add(layer.id);
        result.push(layer.id);
        queue.push(layer.id);
      }
    }
  }

  return result;
}

/** The layer whose transform a layer inherits: Link To first, then its group. */
export function getTransformParent(
  layer: EditorLayerProperties,
  layers: EditorLayerProperties[],
): EditorLayerProperties | undefined {
  return (
    (layer.parentId
      ? layers.find((item) => item.id === layer.parentId)
      : undefined) ??
    (layer.groupId
      ? layers.find((item) => item.id === layer.groupId)
      : undefined)
  );
}

export function getWorldFrame(
  layer: EditorLayerProperties,
  layers: EditorLayerProperties[],
  width: number,
  height: number,
  visited = new Set<string>(),
): Frame {
  const local: Frame = {
    x: layer.x,
    y: layer.y,
    rotation: layer.rotation,
    scaleX: (layer.scaleX ?? 100) / 100,
    scaleY: (layer.scaleY ?? 100) / 100,
  };

  const parent = getTransformParent(layer, layers);

  if (!parent || visited.has(layer.id)) {
    return local;
  }

  visited.add(layer.id);

  const world = getWorldFrame(parent, layers, width, height, visited);
  const radians = (world.rotation * Math.PI) / 180;
  const offsetX = (local.x - width / 2) * world.scaleX;
  const offsetY = (local.y - height / 2) * world.scaleY;

  return {
    x: world.x + offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
    y: world.y + offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
    rotation: world.rotation + local.rotation,
    scaleX: world.scaleX * local.scaleX,
    scaleY: world.scaleY * local.scaleY,
  };
}

/** The local transform that gives `world` inside `parent` (null = top level). */
export function worldToLocal(
  world: Frame,
  parent: Frame | null,
  width: number,
  height: number,
): Frame {
  if (!parent) {
    return world;
  }

  const radians = (parent.rotation * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const parentScaleX = Math.abs(parent.scaleX) < 0.0001 ? 1 : parent.scaleX;
  const parentScaleY = Math.abs(parent.scaleY) < 0.0001 ? 1 : parent.scaleY;
  const dx = world.x - parent.x;
  const dy = world.y - parent.y;

  return {
    x: (dx * cos + dy * sin) / parentScaleX + width / 2,
    y: (-dx * sin + dy * cos) / parentScaleY + height / 2,
    rotation: world.rotation - parent.rotation,
    scaleX: world.scaleX / parentScaleX,
    scaleY: world.scaleY / parentScaleY,
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Called when layers are removed (delete or ungroup): layers that lost their
 * Link To target or their group are detached and keep their place on screen.
 */
export function detachFromDeleted(
  layer: EditorLayerProperties,
  deleted: Set<string>,
  layers: EditorLayerProperties[],
  width: number,
  height: number,
): EditorLayerProperties {
  const lostParent = Boolean(layer.parentId && deleted.has(layer.parentId));
  const lostGroup = Boolean(layer.groupId && deleted.has(layer.groupId));

  if (!lostParent && !lostGroup) {
    return layer;
  }

  const next: EditorLayerProperties = { ...layer };

  if (lostGroup) {
    // The layer joins the group the deleted group belonged to (if any).
    const lostGroupLayer = layers.find((item) => item.id === layer.groupId);
    const outer = lostGroupLayer?.groupId ?? null;
    next.groupId = outer && !deleted.has(outer) ? outer : null;
  }

  if (lostParent) {
    next.parentId = null;
  }

  const remaining = layers.filter((item) => !deleted.has(item.id));

  // A layer that is still linked keeps its transform: the group never
  // applied to it.
  if (!lostParent && next.parentId) {
    return next;
  }

  const world = getWorldFrame(layer, layers, width, height);
  const newParent = getTransformParent(next, remaining);
  const parentFrame = newParent
    ? getWorldFrame(newParent, remaining, width, height)
    : null;
  const local = worldToLocal(world, parentFrame, width, height);

  return {
    ...next,
    x: round(local.x),
    y: round(local.y),
    rotation: round(local.rotation),
    scaleX: round(local.scaleX * 100),
    scaleY: round(local.scaleY * 100),
  };
}

function getLayerStartTime(layer: EditorLayerProperties): number {
  return layer.startTime ?? 0;
}

function getLayerEndTime(layer: EditorLayerProperties): number | null {
  if (layer.outPoint === undefined || layer.outPoint === null) {
    return null;
  }

  const span =
    Math.max(0, layer.outPoint - (layer.inPoint ?? 0)) *
    (Math.max(0.01, layer.stretch ?? 100) / 100);

  return getLayerStartTime(layer) + span;
}

/** A group's lane always covers its members. */
export function syncGroupSpans(
  layers: EditorLayerProperties[],
): EditorLayerProperties[] {
  if (!layers.some(isGroupLayer)) {
    return layers;
  }

  let changed = false;

  const next = layers.map((layer) => {
    if (!isGroupLayer(layer)) {
      return layer;
    }

    let start = Number.POSITIVE_INFINITY;
    let end = Number.NEGATIVE_INFINITY;

    for (const memberId of getGroupDescendantIds(layers, layer.id)) {
      const member = layers.find((item) => item.id === memberId);

      if (!member || isGroupLayer(member)) {
        continue;
      }

      const memberEnd = getLayerEndTime(member);

      if (memberEnd === null) {
        continue;
      }

      start = Math.min(start, getLayerStartTime(member));
      end = Math.max(end, memberEnd);
    }

    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return layer;
    }

    const stretch = layer.stretch ?? 100;

    if (
      Math.abs(getLayerStartTime(layer) - start) < 1e-6 &&
      (layer.inPoint ?? 0) === 0 &&
      stretch === 100 &&
      Math.abs((layer.outPoint ?? -1) - (end - start)) < 1e-6
    ) {
      return layer;
    }

    changed = true;

    return {
      ...layer,
      startTime: start,
      inPoint: 0,
      outPoint: end - start,
      stretch: 100,
    };
  });

  return changed ? next : layers;
}

/**
 * For drawing: group opacity is multiplied into its members, and a hidden
 * group hides them. Returns the same array when nothing is grouped.
 */
export function applyGroupInheritance(
  layers: EditorLayerProperties[],
): EditorLayerProperties[] {
  if (!layers.some((layer) => layer.groupId)) {
    return layers;
  }

  const byId = new Map(layers.map((layer) => [layer.id, layer]));

  return layers.map((layer) => {
    if (!layer.groupId) {
      return layer;
    }

    let opacity = 1;
    let visible = true;
    let cursor: string | null | undefined = layer.groupId;
    let guard = 0;

    while (cursor && guard < layers.length) {
      const group = byId.get(cursor);

      if (!group) {
        break;
      }

      opacity *= Math.max(0, group.opacity ?? 100) / 100;

      if (group.visible === false) {
        visible = false;
      }

      cursor = group.groupId;
      guard += 1;
    }

    if (opacity === 1 && visible) {
      return layer;
    }

    return {
      ...layer,
      opacity: layer.opacity * opacity,
      visible: visible ? layer.visible : false,
    };
  });
}
