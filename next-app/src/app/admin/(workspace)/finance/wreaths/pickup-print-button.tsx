'use client';

/**
 * Pickup list › Print scout pages (2026-11-21): marks the body so the print stylesheet keeps only the scout cards, one
 * per page, prints, then clears the mark. Component only: no constants exported from this client module.
 */
import { Button } from '../../../_components/button';

export function PrintScoutPagesButton() {
  return (
    <Button
      variant="secondary"
      size="sm"
      type="button"
      onClick={() => {
        const clear = () => {
          delete document.body.dataset.pickupPages;
          window.removeEventListener('afterprint', clear);
        };
        document.body.dataset.pickupPages = '';
        window.addEventListener('afterprint', clear);
        window.print();
      }}
    >
      Print scout pages
    </Button>
  );
}
