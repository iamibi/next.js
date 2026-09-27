// An ISR route whose paths are all generated on demand: no path is prerendered
// at build time and `dynamicParams` keeps its default of `true`, so every
// distinct slug is rendered on its first request and then cached for an hour.
export const revalidate = 3600;

export function generateStaticParams() {
  return [];
}

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <p>{slug}</p>;
}
