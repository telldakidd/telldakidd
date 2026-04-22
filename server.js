import "dotenv/config";
import express from "express";
import rateLimit from "express-rate-limit";
import Anthropic from "@anthropic-ai/sdk";
import { scrapeCompany } from "./demo/lead-enrichment/scraper.js";
import { enrichLead } from "./demo/lead-enrichment/enrich.js";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "16kb" }));
app.use(express.static(".", { extensions: ["html"] }));

const enrichLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Slow down — demo is limited to 5 runs per 10 minutes per IP.",
  },
});

app.post("/api/enrich", enrichLimiter, async (req, res) => {
  const { url } = req.body ?? {};
  if (typeof url !== "string" || url.length < 3 || url.length > 200) {
    return res.status(400).json({ error: "Provide a valid company URL." });
  }

  try {
    const scraped = await scrapeCompany(url);
    const { result, usage } = await enrichLead(scraped);
    res.json({
      hostname: scraped.hostname,
      url: scraped.url,
      pageTitle: scraped.title,
      ...result,
      usage: {
        input_tokens: usage.input_tokens,
        output_tokens: usage.output_tokens,
      },
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError) {
      console.error(`Anthropic ${err.status}: ${err.message}`);
      return res.status(502).json({ error: "AI service error. Try again in a moment." });
    }
    if (err.name === "TimeoutError" || err.message?.includes("timeout")) {
      return res.status(504).json({ error: "That site took too long to respond." });
    }
    if (err.message?.startsWith("Fetch failed")) {
      return res.status(400).json({ error: "Couldn't reach that site. Check the URL?" });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

app.listen(PORT, () => {
  console.log(`NexusAI site running on http://localhost:${PORT}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("  ⚠  ANTHROPIC_API_KEY not set — /api/enrich will fail.");
  }
});
