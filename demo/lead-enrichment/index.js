import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { writeFileSync, mkdirSync } from "node:fs";
import { scrapeCompany } from "./scraper.js";
import { enrichLead } from "./enrich.js";

const OFFER_LABELS = {
  ai_receptionist: "AI Receptionist",
  lead_scraping_outreach: "Lead Scraping + Outreach",
  customer_support_ai: "Customer Support AI",
  custom_workflow_automation: "Custom Workflow Automation",
};

function line(char = "─", n = 64) {
  return char.repeat(n);
}

function renderReport(scraped, { result, usage }) {
  const parts = [];
  parts.push(line("═"));
  parts.push(`  LEAD REPORT  ·  ${scraped.hostname}`);
  parts.push(line("═"));
  parts.push("");
  parts.push(`URL          ${scraped.url}`);
  parts.push(`Industry     ${result.industry}`);
  parts.push(`Summary      ${result.company_summary}`);
  parts.push("");
  parts.push("LIKELY PAIN POINTS");
  parts.push(line());
  for (const p of result.likely_pain_points) parts.push(`  • ${p}`);
  parts.push("");
  parts.push("RECOMMENDED OFFER");
  parts.push(line());
  parts.push(`  ${OFFER_LABELS[result.best_offer_match] ?? result.best_offer_match}`);
  parts.push(`  ${result.offer_rationale}`);
  parts.push("");
  parts.push("PERSONALIZED FIRST LINE");
  parts.push(line());
  parts.push(`  ${result.personalized_first_line}`);
  parts.push("");
  parts.push("EMAIL SEQUENCE");
  parts.push(line());
  for (const email of result.email_sequence) {
    parts.push("");
    parts.push(`  Day ${email.day}  ·  Subject: ${email.subject}`);
    parts.push("");
    for (const ln of email.body.split("\n")) parts.push(`    ${ln}`);
  }
  parts.push("");
  parts.push(line());
  parts.push(
    `Tokens: in=${usage.input_tokens}  out=${usage.output_tokens}` +
      (usage.cache_read_input_tokens
        ? `  cache_read=${usage.cache_read_input_tokens}`
        : "") +
      (usage.cache_creation_input_tokens
        ? `  cache_write=${usage.cache_creation_input_tokens}`
        : ""),
  );
  parts.push(line());
  return parts.join("\n");
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage: node index.js <company-url-or-domain>");
    console.error("Example: node index.js stripe.com");
    process.exit(1);
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.");
    process.exit(1);
  }

  console.error(`[1/2] Scraping ${target}...`);
  const scraped = await scrapeCompany(target);
  console.error(`      → ${scraped.hostname}  (${scraped.title || "no title"})`);

  console.error(`[2/2] Generating outreach with Claude...`);
  const enriched = await enrichLead(scraped);

  console.log(renderReport(scraped, enriched));

  mkdirSync("output", { recursive: true });
  const jsonPath = `output/${scraped.hostname}.json`;
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { source: scraped, ...enriched.result, usage: enriched.usage },
      null,
      2,
    ),
  );
  console.error(`\n  Saved raw JSON → ${jsonPath}`);
}

try {
  await main();
} catch (err) {
  if (err instanceof Anthropic.APIError) {
    console.error(`Anthropic API error (${err.status}): ${err.message}`);
  } else {
    console.error(err.message || err);
  }
  process.exit(1);
}
