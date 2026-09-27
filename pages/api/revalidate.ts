import type { NextApiRequest, NextApiResponse } from "next";

// The CMS webhook: on-demand revalidation of the ISR page after a publish.
export default async function handler(
  _req: NextApiRequest,
  res: NextApiResponse,
) {
  try {
    await res.revalidate("/");
    return res.json({ revalidated: true });
  } catch (err) {
    return res.status(500).json({ revalidated: false, error: String(err) });
  }
}
