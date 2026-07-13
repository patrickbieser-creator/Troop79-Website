import { ImageResponse } from 'next/og';
import { IS_DEV_DB } from '@/lib/dev-db';

export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          borderRadius: '50%',
          background: IS_DEV_DB ? '#c0392b' : '#1e3a4a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 18,
          fontWeight: 700,
          fontFamily: 'Arial, sans-serif'
        }}
      >
        T
      </div>
    ),
    size
  );
}
