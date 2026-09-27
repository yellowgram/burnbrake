import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parseUsageText, settleUsage } from "../src/upstream.ts";

describe("usage parser", () => {
  it("accepts input_tokens and output_tokens", () => {
    const usage = parseUsageText(
      "application/json",
      JSON.stringify({ usage: { input_tokens: 3, output_tokens: 5 } }),
    );
    assert.deepEqual(usage, { prompt_tokens: 3, completion_tokens: 5 });
  });

  it("prefers prompt_tokens and completion_tokens when both names are present, including zero", () => {
    const usage = parseUsageText(
      "application/json",
      JSON.stringify({
        usage: { prompt_tokens: 0, input_tokens: 9, completion_tokens: 0, output_tokens: 4 },
      }),
    );
    assert.deepEqual(usage, { prompt_tokens: 0, completion_tokens: 0 });
  });

  it("parses JSON usage when the body also contains a data: line", () => {
    const body =
      '{"usage":{"prompt_tokens":11,"completion_tokens":7}}\ndata: {"usage":{"prompt_tokens":1,"completion_tokens":1}}';
    const usage = parseUsageText("application/json; charset=utf-8", body);
    assert.deepEqual(usage, { prompt_tokens: 11, completion_tokens: 7 });
  });

  it("still reads usage from an event stream", () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"ok"}}]}',
      "",
      'data: {"usage":{"input_tokens":2,"output_tokens":6}}',
      "",
      "data: [DONE]",
      "",
    ].join("\n");
    const usage = parseUsageText("text/event-stream", body);
    assert.deepEqual(usage, { prompt_tokens: 2, completion_tokens: 6 });
    assert.deepEqual(settleUsage("text/event-stream", body), usage);
  });

  it("does not settle an event stream that never finished", () => {
    const body = 'data: {"usage":{"prompt_tokens":1,"completion_tokens":1}}\n\n';
    assert.deepEqual(parseUsageText("text/event-stream", body), { prompt_tokens: 1, completion_tokens: 1 });
    assert.equal(settleUsage("text/event-stream", body), null);
  });
});
