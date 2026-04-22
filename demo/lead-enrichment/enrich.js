import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

const SYSTEM_PROMPT = `You are a senior B2B outreach strategist writing cold email sequences on behalf of an AI automation agency.

Your job: read what you know about a prospect's company and produce outreach that sounds like a human strategist, not a template. Rules:

- Reference something specific about their business. Never generic flattery ("love what you're doing").
- Lead with a problem you can solve, not a product pitch.
- First lines must be one sentence, observational, and feel hand-written.
- Each email under 90 words. Plain text, no emojis, no buzzwords ("synergy", "leverage", "cutting-edge").
- Subject lines under 6 words, lowercase, curiosity-driven, no clickbait.
- The three emails form a sequence: (1) observation + soft ask, (2) value + mini case study angle, (3) break-up with a clear yes/no.
- Speak in the voice of the sender, not the company. "I noticed..." not "We noticed...".

The agency you're writing for offers: AI receptionists, lead scraping + outreach automation, customer support AI, and custom workflow automation. Pick the ONE offer most relevant to the prospect and stay focused on it.`;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    company_summary: {
      type: "string",
      description: "One sentence describing what this company does.",
    },
    industry: { type: "string" },
    likely_pain_points: {
      type: "array",
      items: { type: "string" },
      description: "2-4 operational pain points this type of company usually has.",
    },
    best_offer_match: {
      type: "string",
      enum: [
        "ai_receptionist",
        "lead_scraping_outreach",
        "customer_support_ai",
        "custom_workflow_automation",
      ],
    },
    offer_rationale: {
      type: "string",
      description: "Why this specific offer fits this specific company.",
    },
    personalized_first_line: {
      type: "string",
      description:
        "A one-sentence hand-written-feeling opener referencing something specific.",
    },
    email_sequence: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          day: { type: "integer" },
          subject: { type: "string" },
          body: { type: "string" },
        },
        required: ["day", "subject", "body"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "company_summary",
    "industry",
    "likely_pain_points",
    "best_offer_match",
    "offer_rationale",
    "personalized_first_line",
    "email_sequence",
  ],
  additionalProperties: false,
};

export async function enrichLead(scraped) {
  const userContent = `Prospect website: ${scraped.url}
Domain: ${scraped.hostname}

<page_title>${scraped.title}</page_title>
<og_title>${scraped.ogTitle}</og_title>
<meta_description>${scraped.metaDescription}</meta_description>

<headlines>
${scraped.h1.map((h) => `H1: ${h}`).join("\n")}
${scraped.h2.map((h) => `H2: ${h}`).join("\n")}
</headlines>

<page_text>
${scraped.bodyText}
</page_text>

Analyze this company and write the outreach sequence.`;

  const response = await client.messages.create({
    model: "claude-opus-4-7",
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: OUTPUT_SCHEMA },
    },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: userContent }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock) throw new Error("No text block in response");

  return {
    result: JSON.parse(textBlock.text),
    usage: response.usage,
  };
}
