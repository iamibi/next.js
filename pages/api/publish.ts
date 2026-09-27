import type { NextApiRequest, NextApiResponse } from "next";
import { publish } from "../../lib/cms";

// Simulates publishing new content in the CMS.
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).end();
  }
  const version = publish();
  res.json({ version, publishedAt: Date.now() });
}
