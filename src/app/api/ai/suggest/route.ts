// src/app/api/ai/suggest/route.ts
// POST /api/ai/suggest
//
// AI-powered writing suggestions using Vercel AI SDK + Google Gemini.
// Given the current document text and cursor context, returns
// inline suggestions the user can accept or reject.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { streamText } from "ai";
import { google } from "@ai-sdk/google";
import { requireAuth } from "@/lib/auth";
import { applyRateLimit, RATE_LIMITS } from "@/lib/rate-limit";

const SuggestSchema = z.object({
  // Text immediately before the cursor (for context)
  contextBefore: z.string().max(2000),
  // Text immediately after the cursor
  contextAfter: z.string().max(500),
  // Optional: what kind of help the user wants
  mode: z
    .enum(["continue", "rephrase", "expand", "summarize_selection", "fix_grammar"])
    .default("continue"),
  // The selected text (for rephrase/summarize_selection modes)
  selection: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest) {
  const user = await requireAuth().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const rateLimitResponse = applyRateLimit(req, user.id, RATE_LIMITS.AI);
  if (rateLimitResponse) return rateLimitResponse;

  const body = await req.json().catch(() => ({}));
  const parsed = SuggestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues },
      { status: 422 }
    );
  }

  const { contextBefore, contextAfter, mode, selection } = parsed.data;

  const systemPrompt = `You are a writing assistant embedded in a collaborative document editor.
Your suggestions should be:
- Concise and directly usable (the user will insert your output as-is)
- Coherent with the existing text style and tone  
- Never include meta-commentary like "Here's a suggestion:" — output ONLY the text
- Never repeat what's already written before the cursor`;

  const userPrompt = buildPrompt(mode, contextBefore, contextAfter, selection);

  try {
    const result = await streamText({
      model: google("gemini-2.0-flash-exp"),
      system: systemPrompt,
      prompt: userPrompt,
      maxTokens: 300,
      temperature: 0.7,
    });

    return result.toTextStreamResponse();
  } catch (err) {
    console.error("[AI/suggest] Error", err);
    return NextResponse.json(
      { error: "AI service unavailable" },
      { status: 503 }
    );
  }
}

function buildPrompt(
  mode: string,
  before: string,
  after: string,
  selection?: string
): string {
  const context = `[DOCUMENT CONTEXT]\n...${before}[CURSOR]${after}...`;

  switch (mode) {
    case "continue":
      return `${context}\n\nContinue writing naturally from the [CURSOR] position. Output only the new text to insert.`;

    case "rephrase":
      return `Rephrase the following text to improve clarity and flow, keeping the same meaning:\n\n"${selection}"\n\nOutput only the rephrased text.`;

    case "expand":
      return `${context}\n\nExpand the paragraph around the [CURSOR] with 1-2 additional sentences that add depth and detail. Output only the new sentences.`;

    case "summarize_selection":
      return `Summarize the following text in 1-2 concise sentences:\n\n"${selection}"\n\nOutput only the summary.`;

    case "fix_grammar":
      return `Fix any grammar, spelling, and punctuation issues in the following text. Preserve the original meaning and style:\n\n"${selection}"\n\nOutput only the corrected text.`;

    default:
      return `${context}\n\nContinue from the [CURSOR].`;
  }
}
