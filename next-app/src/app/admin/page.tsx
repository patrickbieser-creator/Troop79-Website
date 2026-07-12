import { redirect } from 'next/navigation';

/** /admin has no content of its own — land people on the workspace.
 *  (Reached via bookmarks, typed URLs, and login's ?next=/admin.) */
export default function AdminIndexPage() {
  redirect('/admin/advancement');
}
