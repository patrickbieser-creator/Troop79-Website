import { PageSkeleton } from '../_components/page-skeleton';

// Section-level boundary (see ../loading.tsx): content area only, the section bar stays visible.
export default function Loading() {
  return <PageSkeleton />;
}
