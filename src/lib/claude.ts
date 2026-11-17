// The one place that calls Claude. Server side only: the key (ANTHROPIC_API_KEY) is read
// when a call is made. Every answer is checked against a zod schema before anything uses it.
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const readerModel = () => process.env.MODEL_READER ?? "claude-sonnet-5-5";
export const writerModel = () => process.env.MODEL_WRITER ?? "claude-sonnet-5-5";
export const CLAUDE_TIMEOUT_MS = 20_000;

const USD_PER_INPUT_TOKEN = 2 / 1_000_000;
const USD_PER_OUTPUT_TOKEN = 10 / 1_000_000; // thinking tokens count as output

export const costOf = (inputTokens: number, outputTokens: number) =>
  inputTokens * USD_PER_INPUT_TOKEN + outputTokens * USD_PER_OUTPUT_TOKEN;

export type ClaudeCall<T> = {
  parsed: T | null; // null when the answer was missing, refused, cut off or did not match the schema
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
};

export type AskClaude = <T>(args: { schema: z.ZodType<T>; system: string; user: string; model: string }) => Promise<ClaudeCall<T>>;

export const askClaudeForReal: AskClaude = async ({ schema, system, user, model }) => {
  const client = new Anthropic({ maxRetries: 0, timeout: CLAUDE_TIMEOUT_MS }); // reads ANTHROPIC_API_KEY
  const response = await client.messages.parse({
    model,
    max_tokens: 3000,
    system,
    messages: [{ role: "user", content: user }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    output_config: { effort: "low", format: zodOutputFormat(schema as any) },
  });
  const parsed = response.stop_reason === "refusal" || response.stop_reason === "max_tokens" ? null : response.parsed_output;
  return {
    parsed: (parsed ?? null) as ReturnType<typeof schema.parse> | null,
    stopReason: response.stop_reason,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
};
