import { Suspense } from "react";

import CoursePage from "@/components/CoursePage";
import { WatchFallback } from "@/components/WatchPage";

// One static page for every course (/course?list=ID&v=LESSON), like the
// watch page: built once, served from the CDN and prefetched by <Link>.
export default function Page() {
  return (
    <Suspense fallback={<WatchFallback />}>
      <CoursePage />
    </Suspense>
  );
}
