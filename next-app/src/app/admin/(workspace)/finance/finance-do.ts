/**
 * /admin/finance?do=<action> opens one of the Actions ▾ dialogs on arrival (Plans/Completed/Admin-Portal-Nav.md phase 2: the
 * menus and search link straight to a task). A plain module so the server page and the client workspace share it.
 */
export const FINANCE_DO = ['record', 'transfer', 'reconcile', 'kinds'] as const;
export type FinanceModal = (typeof FINANCE_DO)[number];

/** The dialog a ?do= value opens, or null: unknown values, and anyone without finance.manage, get the plain ledger. */
export function financeModalFromParam(raw: string | string[] | undefined, canManage: boolean): FinanceModal | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  if (!canManage || !v) return null;
  return (FINANCE_DO as readonly string[]).includes(v) ? (v as FinanceModal) : null;
}
