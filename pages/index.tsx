import type { GetStaticProps, InferGetStaticPropsType } from "next";
import { logRender, readVersion, RENDER_DELAY_MS } from "../lib/cms";

type Props = { version: number; readAt: number; renderedAt: number };

export const getStaticProps: GetStaticProps<Props> = async () => {
  // Read the content from the "CMS" first...
  const version = readVersion();
  const readAt = Date.now();

  // ...then take a while to finish rendering.
  await new Promise((resolve) => setTimeout(resolve, RENDER_DELAY_MS));
  const renderedAt = Date.now();

  logRender({ version, readAt, renderedAt });
  console.log(
    `[getStaticProps] read version ${version}, finished after ${renderedAt - readAt}ms`,
  );

  return { props: { version, readAt, renderedAt }, revalidate: 5 };
};

export default function Home({
  version,
  readAt,
  renderedAt,
}: InferGetStaticPropsType<typeof getStaticProps>) {
  return (
    <main>
      <p>
        CMS version: <span id="version">{version}</span>
      </p>
      <p>
        Read at: <span id="read-at">{new Date(readAt).toISOString()}</span>
      </p>
      <p>
        Rendered at:{" "}
        <span id="rendered-at">{new Date(renderedAt).toISOString()}</span>
      </p>
    </main>
  );
}
