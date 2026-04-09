import dotenv from "dotenv";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

dotenv.config();

function getProvider(): "openai" | "anthropic" {
  const provider = (process.env.LLM_PROVIDER || "openai").toLowerCase();
  if (provider === "anthropic") {
    return "anthropic";
  }
  return "openai";
}

export async function generateText(prompt: string): Promise<string> {
  const provider = getProvider();
  if (provider === "anthropic") {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not configured.");
    }
    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
      model: process.env.ANTHROPIC_MODEL?.trim() || "claude-3-5-sonnet-latest",
      max_tokens: 900,
      messages: [{ role: "user", content: prompt }]
    });
    const text = response.content.find((block) => block.type === "text");
    return text?.text?.trim() || "";
  }

  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured.");
  }
  const baseURL = process.env.OPENAI_BASE_URL?.trim() || undefined;
  const client = new OpenAI({ apiKey, baseURL });
  const completion = await client.chat.completions.create({
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
    temperature: 0.2,
    messages: [{ role: "user", content: prompt }]
  });
  return completion.choices[0]?.message?.content?.trim() || "";
}

export function isLlmConfigured(): boolean {
  const provider = getProvider();
  if (provider === "anthropic") {
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}
