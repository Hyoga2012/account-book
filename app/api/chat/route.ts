import { NextRequest, NextResponse } from "next/server";
import { validateChatEnv } from "@/lib/env";
import {
  buildClarificationReply,
  ExpenseExtraction,
  normalizeExtraction,
  parseExpenseLocally,
} from "@/lib/expense-parser";
import { callGemini, parseGeminiJson } from "@/lib/gemini";
import {
  createServerSupabaseClient,
  Expense,
} from "@/lib/supabase-server";
import { ChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type MessageIntent = "expense" | "question";

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
      lastAssistant.content.includes("알려주시면 저장") ||
      lastAssistant.content.includes("어떤 내용"));

  if (isExpenseFollowUp) {
    return "expense";
  }

  const isQuestion =
    /[?？]/.test(message) ||
    /(얼마야|얼마예요|얼마인|뭐야|뭐예요|몇\s*원|어떻게|무엇을|뭐\s*샀|총\s*지출|가장\s*많이|지난주|이번\s*달.*얼마|식비.*얼마)/.test(
      message,
    );

  if (isQuestion && !/(썼|지출|결제|샀|탔|먹었)/.test(message)) {
    return "question";
  }

  return "expense";
}

async function extractExpenseWithGemini(
  message: string,
  history: ChatMessage[] = [],
): Promise<ExpenseExtraction> {
  const today = getTodayString();
  const conversation = formatConversation(history, message);

  const text = await callGemini(
    `한국어 가계부 지출 분석기. 오늘: ${today} (기본값으로 사용 금지)
대화 전체 맥락을 보고 지출 정보를 추출하세요.

반드시 아래 JSON 형식으로만 응답:
{
  "date": "YYYY-MM-DD 또는 null",
  "amount": 정수 또는 null,
  "description": "내용 또는 null",
  "needs_clarification": true 또는 false,
  "clarification_message": "질문 또는 null"
}

규칙:
- 이전 대화의 금액/내용/날짜를 유지하고 새 메시지로 보완
- date는 명시적 날짜 언급 시에만, 없으면 null
- amount는 숫자만 (예: 50000)
- 정보가 부족하면 needs_clarification을 true로 설정

대화:
${conversation}`,
    { json: true },
  );

  return normalizeExtraction(parseGeminiJson<ExpenseExtraction>(text));
}

async function extractExpense(
  message: string,
  history: ChatMessage[] = [],
): Promise<ExpenseExtraction> {
  const local = parseExpenseLocally(message, history);

  if (!local.needs_clarification) {
    return local;
  }

  try {
    const gemini = await extractExpenseWithGemini(message, history);
    return normalizeExtraction({
      date: gemini.date ?? local.date,
      amount: gemini.amount ?? local.amount,
      description: gemini.description ?? local.description,
      needs_clarification: gemini.needs_clarification,
      clarification_message: gemini.clarification_message,
    });
  } catch (error) {
    console.error("Gemini extraction failed, using local parser:", error);
    return local;
  }
}

async function answerQuestion(
  message: string,
  history: ChatMessage[],
  expenses: Expense[],
): Promise<string> {
  const today = getTodayString();
  const conversation = formatConversation(history, message);

  return callGemini(
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

async function handleExpenseInput(message: string, history: ChatMessage[]) {
  const extraction = await extractExpense(message, history);

  if (extraction.needs_clarification) {
    return NextResponse.json({
      reply: buildClarificationReply(extraction),
      saved: false,
    });
  }

  if (!extraction.date || !extraction.amount || !extraction.description) {
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
  let message = "";

  try {
    validateChatEnv();

    const body = await request.json();
    message = typeof body.message === "string" ? body.message : "";
    const history = body.history ?? [];

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

    const local = parseExpenseLocally(message, []);

    if (local.needs_clarification) {
      return NextResponse.json({
        reply: buildClarificationReply(local),
        saved: false,
      });
    }

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "AI 응답을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.",
      },
      { status: 500 },
    );
  }
}
