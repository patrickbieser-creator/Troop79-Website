'use client';

/** A Print button for a server-rendered page (the outing's shopping list). */
import { Button } from '@/app/_components/button';

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button variant="secondary" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
