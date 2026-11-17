import { HEALTH_MAX_BYTES } from '@/lib/health-records';

/**
 * Makes a phone photo small enough to send (Plans/Health-Forms.md): decoded with its rotation applied, drawn to a
 * canvas no longer than 2400 px, saved as a JPEG. Redrawing also drops the photo's EXIF data, the GPS position
 * included. Safari decodes an iPhone's HEIC here, so iPhones are covered. A PDF is sent as it is.
 *
 * Returns null when the browser can't read the image at all (the caller says so in place).
 */
const LONG_EDGE = 2400;

export async function shrinkPhoto(file: File): Promise<File | null> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return null;
  }
  try {
    for (const [edge, quality] of [[LONG_EDGE, 0.85], [LONG_EDGE, 0.7], [1800, 0.7], [1400, 0.6]] as const) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= HEALTH_MAX_BYTES - 200_000) return new File([blob], 'page.jpg', { type: 'image/jpeg' });
    }
    return null;
  } finally {
    bitmap.close();
  }
}
