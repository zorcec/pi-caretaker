export function stubTelegramFetch(
  impl: (url: string) => unknown,
): {
  fetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;
} {
  return {
    fetch: async (url, init) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (init?.signal?.aborted) throw new DOMException("The operation was aborted", "AbortError");
      const result = impl(String(url));
      if (result instanceof Error) throw result;
      return new Response(JSON.stringify(result), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
}

export const telegramGetMe = {
  ok: true,
  result: { id: 1, is_bot: true, first_name: "Caretaker", username: "t" },
};
