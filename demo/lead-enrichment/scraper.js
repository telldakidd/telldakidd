import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (compatible; LeadEnrichmentDemo/0.1; +https://example.com/bot)";

function normalizeUrl(input) {
  const trimmed = input.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export async function scrapeCompany(inputUrl) {
  const url = normalizeUrl(inputUrl);

  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html,*/*" },
    redirect: "follow",
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    throw new Error(`Fetch failed: ${res.status} ${res.statusText} for ${url}`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  $("script, style, noscript, svg, iframe").remove();

  const title = $("title").first().text().trim();
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";
  const ogTitle = $('meta[property="og:title"]').attr("content")?.trim() || "";
  const h1 = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 5);
  const h2 = $("h2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean)
    .slice(0, 10);

  const bodyText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 4000);

  const hostname = new URL(res.url).hostname.replace(/^www\./, "");

  return {
    url: res.url,
    hostname,
    title,
    ogTitle,
    metaDescription,
    h1,
    h2,
    bodyText,
  };
}
