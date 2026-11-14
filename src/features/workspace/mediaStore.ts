import type {
  WorkspaceMediaType,
  WorkspaceProjectItem,
} from '../project/project.types';

type StoredMedia = { mediaId: string; blob: Blob };

const DATABASE_NAME = 'brx-media';
const STORE_NAME = 'media';

function openMediaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    try {
      if (!('indexedDB' in window)) {
        reject(new Error('IndexedDB is unavailable in this browser'));
        return;
      }
      const request = indexedDB.open(DATABASE_NAME, 1);
      request.onupgradeneeded = () => {
        try {
          const database = request.result;
          if (!database.objectStoreNames.contains(STORE_NAME)) {
            database.createObjectStore(STORE_NAME, { keyPath: 'mediaId' });
          }
        } catch (error) {
          reject(error);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('Unable to open media database'));
      request.onblocked = () => reject(new Error('Media database upgrade is blocked'));
    } catch (error) {
      reject(error);
    }
  });
}

async function mediaRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  let database: IDBDatabase | null = null;
  try {
    database = await openMediaDatabase();
    return await new Promise<T>((resolve, reject) => {
      try {
        const transaction = database!.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('Media storage request failed'));
        transaction.onerror = () => reject(transaction.error ?? new Error('Media storage transaction failed'));
        transaction.onabort = () => reject(transaction.error ?? new Error('Media storage transaction aborted'));
      } catch (error) {
        reject(error);
      }
    });
  } catch (error) {
    throw new Error('Media storage failed', { cause: error });
  } finally {
    try {
      database?.close();
    } catch (error) {
      console.error('Unable to close media database', error);
    }
  }
}

export async function storeMediaBlob(mediaId: string, blob: Blob) {
  const storedBlob = new Blob([await blob.arrayBuffer()], { type: blob.type });
  await mediaRequest('readwrite', (store) =>
    store.put({ mediaId, blob: storedBlob } satisfies StoredMedia),
  );
}

export async function loadMediaBlob(mediaId: string) {
  const record = await mediaRequest<StoredMedia | undefined>('readonly', (store) =>
    store.get(mediaId),
  );
  return record?.blob ?? null;
}

export async function deleteMediaBlob(mediaId: string) {
  await mediaRequest('readwrite', (store) => store.delete(mediaId));
}

const extensions: Record<string, WorkspaceMediaType> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio',
};

function getMediaType(file: File): WorkspaceMediaType | null {
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? extensions[extension] ?? null : null;
}

function captureThumbnail(source: CanvasImageSource, width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = 90;
  canvas.height = 50;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Unable to create media thumbnail');
  const scale = Math.min(90 / width, 50 / height);
  const drawWidth = width * scale;
  const drawHeight = height * scale;
  context.drawImage(source, (90 - drawWidth) / 2, (50 - drawHeight) / 2, drawWidth, drawHeight);
  return canvas.toDataURL('image/jpeg', 0.78);
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Image decoder failed'));
    image.src = url;
  });
}

function loadTimedMedia(url: string, audioOnly: boolean) {
  return new Promise<HTMLVideoElement | HTMLAudioElement>((resolve, reject) => {
    const media = audioOnly ? new Audio() : document.createElement('video');
    media.preload = 'auto';
    const timeout = window.setTimeout(() => reject(new Error('Media decoding timed out')), 15000);
    media.onloadedmetadata = () => {
      if (audioOnly) {
        window.clearTimeout(timeout);
        resolve(media);
      } else if (media instanceof HTMLVideoElement && media.videoWidth > 0) {
        const complete = () => {
          window.clearTimeout(timeout);
          resolve(media);
        };
        if (media.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) complete();
        else media.onloadeddata = complete;
      }
    };
    media.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error('Media decoder failed'));
    };
    if (media instanceof HTMLVideoElement) media.muted = true;
    media.src = url;
    media.load();
  });
}

export async function prepareMediaFile(file: File, frameRate: number): Promise<WorkspaceProjectItem> {
  const mediaType = getMediaType(file);
  if (!mediaType) throw new Error(`Unsupported file type: ${file.name}`);
  const id = `media-${crypto.randomUUID()}`;
  const objectUrl = URL.createObjectURL(file);
  try {
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;
    let thumbnail: string | undefined;
    if (mediaType === 'image') {
      const image = await loadImage(objectUrl);
      width = image.naturalWidth;
      height = image.naturalHeight;
      thumbnail = captureThumbnail(image, width, height);
    } else {
      const media = await loadTimedMedia(objectUrl, mediaType === 'audio');
      duration = Number.isFinite(media.duration) ? media.duration : 0;
      if (media instanceof HTMLVideoElement) {
        width = media.videoWidth;
        height = media.videoHeight;
        try {
          thumbnail = captureThumbnail(media, width, height);
        } catch {
          thumbnail = undefined;
        }
      }
    }
    await storeMediaBlob(id, file);
    return {
      id,
      name: file.name,
      type: `footage-${mediaType}`,
      mediaType,
      size: file.size,
      duration,
      frameRate: mediaType === 'video' ? frameRate : undefined,
      width,
      height,
      thumbnail,
    };
  } catch (error) {
    throw new Error(`Cannot decode ${file.name} in this browser`, { cause: error });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
