import { PageSkeleton } from './_components/page-skeleton';

// Shown inside the workspace layout's <main> while a page streams in; the section bar stays put.
export default function Loading() {
  return <PageSkeleton />;
}
