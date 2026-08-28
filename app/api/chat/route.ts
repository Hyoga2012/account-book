import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";
import { validateChatEnv } from "@/lib/env";
import {
  createServerSupabaseClient,
  Expense,
} from "@/lib/supabase-server";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const GEMINI_MODEL = "gemini-3.6-flash";

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

function getGenAI() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenerativeAI(apiKey);
}

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

function parseJson<T>(text: string): T {
  return JSON.parse(text) as T;
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

async function extractExpense(
  message: string,
  history: ChatMessage[] = [],
): Promise<ExpenseExtraction> {
  const today = getTodayString();
  const conversation = formatConversation(history, message);

  const model = getGenAI().getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `당신은 한국어 가계부 지출 분석기입니다.
오늘 날짜는 ${today}입니다. (상대 날짜 계산 참고용이며, 기본값으로 사용하지 마세요)

아래 대화 전체를 읽고 지출 정보를 추출하세요.
이전 대화에서 이미 파악된 정보는 유지하고, 최신 메시지에서 추가된 정보만 보완하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "date": "YYYY-MM-DD" 또는 null,
  "amount": 숫자(정수) 또는 null,
  "description": "지출 내용" 또는 null,
  "needs_clarification": true 또는 false,
  "clarification_message": "사용자에게 물어볼 질문" 또는 null
}

규칙:
- 대화 전체 맥락을 종합하여 판단하세요
- 현재 메시지에 금액이 없어도 이전 대화에서 파악된 금액을 사용하세요
- 현재 메시지에 내용이 없어도 이전 대화에서 파악된 내용을 사용하세요
- 현재 메시지에 날짜만 있고 이전에 금액/내용이 있었다면 합쳐서 완성하세요
- date는 대화 어디에서든 날짜가 명시적으로 언급된 경우에만 설정하세요
- 날짜가 한 번도 언급되지 않았으면 date는 반드시 null로 두세요
- 부족한 정보만 물어보고, clarification_message는 이미 파악한 내용을 반영해 자연스럽게 작성하세요
- 모든 정보가 갖춰지면 needs_clarification을 false로 설정하세요

대화 기록:
${conversation}`,
          },
        ],
      },
    ],
  });

  const parsed = parseJson<ExpenseExtraction>(result.response.text());
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
  const expenseData = JSON.stringify(expenses, null, 2);

  const model = getGenAI().getGenerativeModel({ model: GEMINI_MODEL });

  const result = await model.generateContent({
    contents: [
      {
        role: "user",
        parts: [
          {
            text: `당신은 친근한 한국어 AI 가계부 챗봇입니다.
오늘 날짜는 ${today}입니다.

아래 지출 데이터를 분석하여 사용자 질문에 답변하세요.
데이터에 없는 내용은 추측하지 말고, 기록이 없다고 안내하세요.

지출 데이터 (date: 지출 날짜, amount: 금액, description: 내용):
${expenseData}

대화 기록:
${conversation}

답변 규칙:
- 자연스럽고 친근한 한국어로 답변하세요
- 금액은 천 단위 콤마를 사용하세요 (예: 50,000원)
- 통계 질문에는 구체적인 숫자와 함께 답변하세요
- 데이터가 비어 있으면 "아직 저장된 지출이 없어요"라고 안내하세요
- 짧고 읽기 쉽게 답변하세요`,
          },
        ],
      },
    ],
  });

  return result.response.text();
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

async function handleExpenseInput(message: string, history: ChatMessage[]) {
  const extraction = await extractExpense(message, history);

  if (
    extraction.needs_clarification ||
    !extraction.date ||
    !extraction.amount ||
    !extraction.description
  ) {
    let fallback =
      "날짜와 금액을 알려주시면 저장해 드릴게요. 예: \"오늘 점심 15000원\"";

    if (extraction.amount && extraction.description && !extraction.date) {
      fallback = `${extraction.description} ${extraction.amount.toLocaleString("ko-KR")}원이시군요! 언제 지출하셨나요? 예: 오늘, 어제, 8월 25일`;
    } else if (!extraction.amount && extraction.description) {
      fallback = `${extraction.description}에 얼마를 지출하셨나요?`;
    } else if (
      extraction.amount &&
      !extraction.description &&
      !extraction.date
    ) {
      fallback = `${extraction.amount.toLocaleString("ko-KR")}원 지출이시군요! 어떤 내용이었고, 언제 지출하셨나요?`;
    }

    return NextResponse.json({
      reply: extraction.clarification_message ?? fallback,
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

      return NextResponse.json({
        reply,
        saved: false,
      });
    }

    return handleExpenseInput(message, chatHistory);
  } catch (error) {
    console.error("Chat API error:", error);

    if (error instanceof Error && error.message.includes("is not configured")) {
      return NextResponse.json(
        {
          error:
            "서버 환경 변수가 설정되지 않았습니다. Vercel 대시보드에서 GEMINI_API_KEY와 Supabase 설정을 확인해 주세요.",
        },
        { status: 500 },
      );
    }

    return NextResponse.json(
      { error: "AI 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요." },
      { status: 500 },
    );
  }
}
