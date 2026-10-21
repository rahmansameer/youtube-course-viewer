import CoursePage from "@/components/CoursePage";

// Like the watch page, every course shares one static shell that reads its
// data in the browser.
export function generateStaticParams() {
  return [];
}

export default function Page() {
  return <CoursePage />;
}
