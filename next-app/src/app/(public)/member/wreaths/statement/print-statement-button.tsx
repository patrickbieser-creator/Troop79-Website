'use client';

import { Button } from '@/app/_components/button';

/** Prints the statement; wreath-statement.module.css reduces the page to the one scout's account. */
export function PrintStatementButton() {
  return (
    <Button variant="secondary" type="button" onClick={() => window.print()}>
      Print statement
    </Button>
  );
}
