import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from 'react';

import type { EditorLayerProperties } from '../../project/project.types';

interface UsePreviewImagesOptions {
  layers: EditorLayerProperties[];
  mediaUrls: Record<string, string>;
}

interface PreviewImageSource {
  layerId: string;
  sourceId: string;
  url: string;
}

export function usePreviewImages({
  layers,
  mediaUrls,
}: UsePreviewImagesOptions) {
  const imagesRef = useRef(
    new Map<string, HTMLImageElement>(),
  );

  const sources = useMemo<PreviewImageSource[]>(() => {
    return layers.flatMap((layer) => {
      if (
        layer.type !== 'image' ||
        !layer.sourceId
      ) {
        return [];
      }

      const url = mediaUrls[layer.sourceId];

      if (!url) {
        return [];
      }

      return [{
        layerId: layer.id,
        sourceId: layer.sourceId,
        url,
      }];
    });
  }, [layers, mediaUrls]);

  useEffect(() => {
    const activeIds = new Set(
      sources.map((source) => source.layerId),
    );

    for (const [layerId, image] of imagesRef.current) {
      if (!activeIds.has(layerId)) {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
        imagesRef.current.delete(layerId);
      }
    }

    for (const source of sources) {
      const existing = imagesRef.current.get(
        source.layerId,
      );

      if (
        existing &&
        existing.dataset.sourceId === source.sourceId &&
        existing.src === source.url
      ) {
        continue;
      }

      if (existing) {
        existing.onload = null;
        existing.onerror = null;
        existing.removeAttribute('src');
      }

      const image = new Image();

      image.decoding = 'async';
      image.dataset.sourceId = source.sourceId;

      imagesRef.current.set(source.layerId, image);

      image.src = source.url;
    }
  }, [sources]);

  useEffect(() => {
    return () => {
      for (const image of imagesRef.current.values()) {
        image.onload = null;
        image.onerror = null;
        image.removeAttribute('src');
      }

      imagesRef.current.clear();
    };
  }, []);

  const getImageElement = useCallback(
    (layerId: string): HTMLImageElement | undefined => {
      return imagesRef.current.get(layerId);
    },
    [],
  );

  return {
    getImageElement,
    imageCount: imagesRef.current.size,
  };
}
