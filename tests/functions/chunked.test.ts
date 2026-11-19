import { assertEquals } from "jsr:@std/assert@1";
import { selectInChunks } from "../../supabase/functions/_shared/chunked.ts";

Deno.test("selectInChunks splits 2,500 values into 25 calls and returns every row", async () => {
  const values = Array.from({ length: 2_500 }, (_, index) => index);
  const chunks: number[][] = [];

  const result = await selectInChunks(values, (chunk) => {
    chunks.push(chunk);
    return Promise.resolve({
      data: chunk.map((id) => ({ id })),
      error: null,
    });
  });

  assertEquals(chunks.length, 25);
  assertEquals(chunks.every((chunk) => chunk.length <= 100), true);
  assertEquals(result, {
    data: values.map((id) => ({ id })),
    error: null,
  });
});

Deno.test("selectInChunks sends duplicate values only once", async () => {
  const sent: number[] = [];

  const result = await selectInChunks([3, 1, 3, 2, 1], (chunk) => {
    sent.push(...chunk);
    return Promise.resolve({ data: chunk, error: null });
  }, { size: 2 });

  assertEquals(sent.sort(), [1, 2, 3]);
  assertEquals(result, { data: [3, 1, 2], error: null });
});

Deno.test("selectInChunks runs no more than four calls concurrently", async () => {
  let inFlight = 0;
  let maximumInFlight = 0;

  const result = await selectInChunks(
    Array.from({ length: 20 }, (_, index) => index),
    async (chunk) => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      return { data: chunk, error: null };
    },
    { size: 1 },
  );

  assertEquals(maximumInFlight, 4);
  assertEquals(result.data?.length, 20);
});

Deno.test("selectInChunks returns an error from chunk 7 with null data", async () => {
  const expectedError = { message: "chunk 7 failed" };
  let calls = 0;

  const result = await selectInChunks(
    Array.from({ length: 1_000 }, (_, index) => index),
    (chunk) => {
      calls += 1;
      return Promise.resolve(
        calls === 7
          ? { data: null, error: expectedError }
          : { data: chunk, error: null },
      );
    },
  );

  assertEquals(result, { data: null, error: expectedError });
});

Deno.test("selectInChunks makes no call for an empty list", async () => {
  let calls = 0;

  const result = await selectInChunks<number, number, Error>([], (_chunk) => {
    calls += 1;
    return Promise.resolve({ data: [], error: null });
  });

  assertEquals(calls, 0);
  assertEquals(result, { data: [], error: null });
});
