// A stored picture (the company logo, a person's photo) as something an <img> can show. A sample workspace keeps a small
// picture in the record itself; a live workspace keeps a path in private storage and reads it through a short-lived address.
import { useEffect, useState } from 'react';
import { gateway } from '@/platform/gateway';

export const isInline = (v: string | undefined): v is string => !!v && v.startsWith('data:');

/** The address to put in `src`, or an empty string while it is being fetched or when there is no picture. */
export function useStoredImage(value: string | undefined): string {
  const inline = isInline(value) ? value : '';
  const [src, setSrc] = useState(inline);
  useEffect(() => {
    if (inline || !value) { setSrc(inline); return; }
    let on = true;
    gateway().files.url({ name: 'image', size: 0, mime: 'image/png', path: value }).then((r) => { if (on) setSrc(r.ok ? r.data : ''); }, () => { if (on) setSrc(''); });
    return () => { on = false; };
  }, [value, inline]);
  return src;
}
/** Stores a small picture: as it is in a sample workspace, as a private file in a live one. Returns what to keep in the record, or null when storing failed. */
export async function storeImage(dataUrl: string, live: boolean, folder: string): Promise<string | null> {
  if (!live) return dataUrl;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const up = await gateway().files.upload(new File([blob], 'image.png', { type: 'image/png' }), { folder });
    return up.ok && up.data.path ? up.data.path : null;
  } catch { return null; }
}
