'use client';

import { Button } from '@/app/_components/button';

/** Prints the page; wreaths.module.css and globals.css reduce it to the delivery list(s). */
export function PrintDeliveryButton() {
  return (
    <Button variant="secondary" type="button" onClick={() => window.print()}>
      Print delivery list
    </Button>
  );
}
