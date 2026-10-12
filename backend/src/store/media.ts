import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type ImageType = (typeof IMAGE_TYPES)[number];

const EXTENSION: Record<ImageType, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Detects the real image type from the file's first bytes, so a renamed file can't slip through. */
export function sniffImageType(data: Buffer): ImageType | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.length >= 8 && data.subarray(0, 8).equals(PNG_SIGNATURE)) return 'image/png';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const safe = (part: string) => part.replace(/[^a-zA-Z0-9_-]/g, '_');

/** Photos on local disk. Swap for object storage later; the service only uses these four methods. */
export class MediaStore {
  private readonly root: string;

  constructor(root: string) {
    this.root = root;
  }

  save(folder: string, name: string, type: ImageType, data: Buffer): string {
    const dir = folder.split('/').map(safe).join('/');
    mkdirSync(join(this.root, dir), { recursive: true });
    const file = `${dir}/${safe(name)}.${EXTENSION[type]}`;
    writeFileSync(join(this.root, file), data);
    return file;
  }

  read(file: string): Buffer | null {
    const path = join(this.root, file);
    return existsSync(path) ? readFileSync(path) : null;
  }

  remove(file: string): void {
    rmSync(join(this.root, file), { force: true });
  }
}
