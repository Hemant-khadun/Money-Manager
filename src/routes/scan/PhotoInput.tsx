import { debugLog } from '../../lib/debug-log';

/**
 * The hidden file input inside a photo button (a <label>): opens the camera, or the phone's
 * photos. `onPhotos` must use the files straight away: they are cleared right after, so the same
 * photo can be chosen again.
 */
export function PhotoInput({ camera = false, multiple = false, onPhotos }: { camera?: boolean; multiple?: boolean; onPhotos: (files: FileList | null) => void }) {
  return (
    <input
      type="file"
      accept="image/*"
      multiple={multiple}
      capture={camera ? 'environment' : undefined}
      className="sr-only"
      onClick={() => debugLog('app', `Opened the ${camera ? 'camera' : 'photo picker'}`)}
      onChange={(e) => {
        onPhotos(e.target.files);
        e.target.value = '';
      }}
    />
  );
}
