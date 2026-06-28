// src/app/api/ai/summarize/route.ts
// POST /api/ai/summarize
//
// Generates a structured document summary: TL;DR, key points, and tags.
// Useful for document dashboards and search indexing.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateObject } from "ai";
import { google } from "@ai-sdk/google";
import { z as zod } from "zod";
import { requireAuth } from "@/lib/auth";
import { getDocumentForUser } from "@/lib/prisma";
import { applyRateLimit, RATE_LIMITS } from "@/lib/rate-limit";
import type { DocumentContent } from "@/types/document";

const SummarizeRequestSchema = z.object({
  documentId: z.string().cuid(),
});

// Structured output schema for the AI response
const SummarySchema = zod.object({
  tldr: zod.string().describe("One-sentence summary of the document"),
  keyPoints: zod
    .array(zod.string())
    .min(1)
    .max(5)
    .describe("3-5 key takeaways from the document"),
  tags: zod
    .array(zod.string())
    .min(1)
    .max(8)
    .describe("Relevant topic tags, lowercase, no spaces"),
  estimatedReadTime: zod
    .number()
    .describe("Estimated read time in minutes"),
});

export async function POST(req: NextRequest) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rateLimitResponse = applyRateLimit(req, user.id, RATE_LIMITS.AI);
  if (rateLimitResponse) return rateLimitResponse;

  const body = await req.json().catch(() => ({}));
  const parsed = SummarizeRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }

  const { documentId } = parsed.data;

  // Verify access
  const access = await getDocumentForUser(documentId, user.id);
  if (!access) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const content = access.doc.content as unknown as DocumentContent;
  const text = content.text ?? "";

  if (text.trim().length < 50) {
    return NextResponse.json(
      { error: "Document is too short to summarize" },
      { status: 400 }
    );
  }

  // Truncate to first 4000 chars to stay within token budget
  const truncatedText = text.slice(0, 4000);

  try {
    const { object: summary } = await generateObject({
      model: google("gemini-2.0-flash-exp"),
      schema: SummarySchema,
      prompt: `Analyze this document and provide a structured summary:\n\n${truncatedText}`,
    });

    return NextResponse.json({ summary });
  } catch (err) {
    console.error("[AI/summarize] Error", err);
    return NextResponse.json(
      { error: "AI service unavailable" },
      { status: 503 }
    );
  }
}
