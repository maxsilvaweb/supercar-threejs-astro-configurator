import type { APIRoute } from "astro";
import { SITE_ORIGIN } from "../lib/seo";

const robots = (sitemap: URL) => `User-agent: *
Allow: /

Sitemap: ${sitemap.href}
`;

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("sitemap-index.xml", site ?? SITE_ORIGIN);
  return new Response(robots(sitemap), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
