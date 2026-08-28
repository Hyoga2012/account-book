const GEMINI_MODELS = [
  "gemini-3.7-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
] as const;

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

function getApiKey(): string {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return apiKey;
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

function isRetryableError(message: string): boolean {
  return (
    message.includes("429") ||
    message.includes("RESOURCE_EXHAUSTED") ||
    message.includes("quota") ||
    message.includes("Quota exceeded") ||
    message.includes("high demand") ||
    message.includes("503") ||
    message.includes("UNAVAILABLE")
  );
}

async function callGeminiWithModel(
  model: string,
  prompt: string,
  options?: { json?: boolean },
): Promise<string> {
  const apiKey = getApiKey();

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        ...(options?.json
          ? { generationConfig: { responseMimeType: "application/json" } }
          : {}),
      }),
      signal: AbortSignal.timeout(50_000),
    },
  );

  const data = (await response.json()) as GeminiResponse;

  if (!response.ok) {
    const message =
      data.error?.message ?? `Gemini API 오류 (${response.status})`;
    throw new Error(message);
  }

  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    throw new Error("Gemini API가 빈 응답을 반환했습니다.");
  }

  return text;
}

export async function callGemini(
  prompt: string,
  options?: { json?: boolean },
): Promise<string> {
  let lastError: Error | null = null;

  for (const model of GEMINI_MODELS) {
    try {
      return await callGeminiWithModel(model, prompt, options);
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      lastError = error;

      if (!isRetryableError(error.message)) {
        throw error;
      }
    }
  }

  throw lastError ?? new Error("Gemini API 호출에 실패했습니다.");
}

export function parseGeminiJson<T>(text: string): T {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith("{")
    ? trimmed
    : trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  return JSON.parse(jsonText) as T;
}

export function getGeminiErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "AI 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }

  const message = error.message;

  if (message.includes("is not configured")) {
    return "서버 환경 변수가 설정되지 않았습니다. Vercel에서 GEMINI_API_KEY를 Production에 등록한 뒤 재배포해 주세요.";
  }

  if (
    message.includes("UNAUTHENTICATED") ||
    message.includes("API key not valid") ||
    message.includes("ACCESS_TOKEN_TYPE_UNSUPPORTED") ||
    message.includes("401")
  ) {
    return "Gemini API 키가 유효하지 않습니다. Google AI Studio에서 새 API 키를 발급하고 Vercel 환경 변수를 업데이트해 주세요.";
  }

  if (isRetryableError(message)) {
    return "AI 요청 한도를 초과했거나 서버가 바쁩니다. 잠시 후 다시 시도해 주세요.";
  }

  if (
    message.includes("timeout") ||
    message.includes("Timeout") ||
    message.includes("AbortError")
  ) {
    return "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.";
  }

  if (message.includes("Unexpected token") || message.includes("JSON")) {
    return "AI 응답 형식 오류가 발생했습니다. 다시 시도해 주세요.";
  }

  return "AI 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.";
}
