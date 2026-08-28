import { NextRequest, NextResponse } from "next/server";
import { validateChatEnv } from "@/lib/env";
import {
  GEMINI_MODEL,
  getGenAI,
  parseGeminiJson,
  withTimeout,
} from "@/lib/gemini";
import {
  createServerSupabaseClient,
  Expense,
} from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const GEMINI_TIMEOUT_MS = 50_000;

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type MessageIntent = "expense" | "question";

type ExpenseExtraction = {
  date: string | null;
  amount: number | null;
  description: string | null;
  needs_clarification: boolean;
  clarification_message: string | null;
};

function getTodayString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDateKorean(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${parseInt(month, 10)}월 ${parseInt(day, 10)}일`;
}

function formatConversation(
  history: ChatMessage[],
  currentMessage: string,
): string {
  const lines = history.map(
    (m) => `${m.role === "user" ? "사용자" : "AI"}: ${m.content}`,
  );
  lines.push(`사용자: ${currentMessage}`);
  return lines.join("\n");
}

function detectIntent(message: string, history: ChatMessage[]): MessageIntent {
  const lastAssistant = history.filter((m) => m.role === "assistant").at(-1);

  const isExpenseFollowUp =
    lastAssistant &&
    (lastAssistant.content.includes("언제 지출") ||
      lastAssistant.content.includes("얼마를 지출") ||
      lastAssistant.content.includes("저장해 드릴게요") ||
      lastAssistant.content.includes("알려주시면 저장"));

  if (isExpenseFollowUp) {
    return "expense";
  }

  const isQuestion =
    /[?？]/.test(message) ||
    /(얼마|뭐|몇|어떻게|무엇|어느|알려줘|총\s*지출|가장\s*많이|뭐\s*샀|지난주|이번\s*달|식비)/.test(
      message,
    );

  if (isQuestion && !/(썼|지출|결제|샀|탔|먹었)/.test(message)) {
    return "question";
  }

  return "expense";
}

async function generateGeminiText(prompt: string): Promise<string> {
  const model = getGenAI().getGenerativeModel({ model: GEMINI_MODEL });

  const result = await withTimeout(
    model.generateContent(prompt),
    GEMINI_TIMEOUT_MS,
    "Gemini API 응답 시간이 초과되었습니다.",
  );

  return result.response.text();
}

async function generateGeminiJson<T>(prompt: string): Promise<T> {
  const model = getGenAI().getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const result = await withTimeout(
    model.generateContent(prompt),
    GEMINI_TIMEOUT_MS,
    "Gemini API 응답 시간이 초과되었습니다.",
  );

  return parseGeminiJson<T>(result.response.text());
}

async function extractExpense(
  message: string,
  history: ChatMessage[] = [],
): Promise<ExpenseExtraction> {
  const today = getTodayString();
  const conversation = formatConversation(history, message);

  const parsed = await generateGeminiJson<ExpenseExtraction>(
    `한국어 가계부 지출 분석기. 오늘: ${today} (기본값으로 사용 금지)
대화 전체 맥락을 보고 지출 정보를 추출하세요.

JSON만 응답:
{"date":"YYYY-MM-DD|null","amount":정수|null,"description":"내용|null","needs_clarification":true|false,"clarification_message":"질문|null"}

규칙:
- 이전 대화의 금액/내용/날짜를 유지하고 새 메시지로 보완
- date는 명시적 날짜 언급 시에만 (오늘/어제/8월25일 등), 없으면 null
- 부족한 정보만 자연스럽게 질문

대화:
${conversation}`,
  );

  return {
    date: parsed.date ?? null,
    amount: parsed.amount ?? null,
    description: parsed.description ?? null,
    needs_clarification: Boolean(parsed.needs_clarification),
    clarification_message: parsed.clarification_message ?? null,
  };
}

async function answerQuestion(
  message: string,
  history: ChatMessage[],
  expenses: Expense[],
): Promise<string> {
  const today = getTodayString();
  const conversation = formatConversation(history, message);

  return generateGeminiText(
    `친근한 한국어 AI 가계부 챗봇. 오늘: ${today}
지출 데이터를 분석해 질문에 답하세요. 데이터 없으면 추측하지 마세요.

지출 데이터:
${JSON.stringify(expenses)}

대화:
${conversation}

규칙: 친근한 한국어, 금액은 콤마 사용, 짧게 답변`,
  );
}

async function fetchAllExpenses(): Promise<Expense[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from("expenses")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

function buildClarificationReply(extraction: ExpenseExtraction): string {
  if (extraction.clarification_message) {
    return extraction.clarification_message;
  }

  if (extraction.amount && extraction.description && !extraction.date) {
    return `${extraction.description} ${extraction.amount.toLocaleString("ko-KR")}원이시군요! 언제 지출하셨나요? 예: 오늘, 어제, 8월 25일`;
  }

  if (!extraction.amount && extraction.description) {
    return `${extraction.description}에 얼마를 지출하셨나요?`;
  }

  if (extraction.amount && !extraction.description && !extraction.date) {
    return `${extraction.amount.toLocaleString("ko-KR")}원 지출이시군요! 어떤 내용이었고, 언제 지출하셨나요?`;
  }

  return "날짜와 금액을 알려주시면 저장해 드릴게요. 예: \"오늘 점심 15000원\"";
}

async function handleExpenseInput(message: string, history: ChatMessage[]) {
  const extraction = await extractExpense(message, history);

  if (
    extraction.needs_clarification ||
    !extraction.date ||
    !extraction.amount ||
    !extraction.description
  ) {
    return NextResponse.json({
      reply: buildClarificationReply(extraction),
      saved: false,
    });
  }

  const supabase = createServerSupabaseClient();

  const { error: insertError } = await supabase.from("expenses").insert({
    date: extraction.date,
    amount: extraction.amount,
    description: extraction.description,
  });

  if (insertError) {
    console.error("Supabase insert error:", insertError);
    return NextResponse.json(
      { error: "지출을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }

  const formattedDate = formatDateKorean(extraction.date);
  const formattedAmount = extraction.amount.toLocaleString("ko-KR");

  return NextResponse.json({
    reply: `${formattedDate} ${extraction.description} ${formattedAmount}원을 저장했어요!`,
    saved: true,
    expense: {
      date: extraction.date,
      amount: extraction.amount,
      description: extraction.description,
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    validateChatEnv();

    const { message, history = [] } = await request.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "메시지를 입력해 주세요." },
        { status: 400 },
      );
    }

    const chatHistory: ChatMessage[] = Array.isArray(history)
      ? history.filter(
          (m): m is ChatMessage =>
            typeof m === "object" &&
            m !== null &&
            (m.role === "user" || m.role === "assistant") &&
            typeof m.content === "string",
        )
      : [];

    const intent = detectIntent(message, chatHistory);

    if (intent === "question") {
      const expenses = await fetchAllExpenses();
      const reply = await answerQuestion(message, chatHistory, expenses);

      return NextResponse.json({ reply, saved: false });
    }

    return await handleExpenseInput(message, chatHistory);
  } catch (error) {
    console.error("Chat API error:", error);

    if (error instanceof Error) {
      if (error.message.includes("is not configured")) {
        return NextResponse.json(
          {
            error:
              "서버 환경 변수가 설정되지 않았습니다. Vercel에서 GEMINI_API_KEY와 Supabase 설정을 확인한 뒤 재배포해 주세요.",
          },
          { status: 500 },
        );
      }

      if (error.message.includes("초과")) {
        return NextResponse.json(
          { error: "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요." },
          { status: 504 },
        );
      }
    }

    return NextResponse.json(
      { error: "AI 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
