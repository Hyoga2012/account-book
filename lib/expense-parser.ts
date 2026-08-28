import { ChatMessage } from "@/lib/types";

export type ExpenseExtraction = {
  date: string | null;
  amount: number | null;
  description: string | null;
  needs_clarification: boolean;
  clarification_message: string | null;
};

function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return String(value);
  const trimmed = value.trim();
  if (!trimmed || trimmed === "null" || trimmed === "없음") return null;
  return trimmed;
}

function parseAmount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === "string") {
    const normalized = value.replace(/,/g, "").trim();
    if (!normalized || normalized === "null") return null;
    const man = normalized.match(/^(\d+(?:\.\d+)?)만$/);
    if (man) return Math.round(parseFloat(man[1]) * 10000);
    const num = Number(normalized);
    if (Number.isFinite(num) && num > 0) return Math.round(num);
  }
  return null;
}

export function normalizeExtraction(raw: Partial<ExpenseExtraction>): ExpenseExtraction {
  const date = parseNullableString(raw.date);
  const amount = parseAmount(raw.amount);
  const description = parseNullableString(raw.description);

  const missingDate = !date;
  const missingAmount = !amount;
  const missingDescription = !description;
  const needsClarification =
    Boolean(raw.needs_clarification) ||
    missingDate ||
    missingAmount ||
    missingDescription;

  return {
    date,
    amount,
    description,
    needs_clarification: needsClarification,
    clarification_message: parseNullableString(raw.clarification_message),
  };
}

function extractAmountFromText(text: string): number | null {
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원?/);
  if (man) return Math.round(parseFloat(man[1]) * 10000);

  const won = text.match(/(\d[\d,]*)\s*원/);
  if (won) return parseInt(won[1].replace(/,/g, ""), 10);

  const number = text.match(/\b(\d{3,})\b/);
  if (number) return parseInt(number[1], 10);

  return null;
}

function extractDateFromText(text: string, today: Date): string | null {
  if (/오늘/.test(text)) return formatDate(today);

  if (/어제/.test(text)) {
    const date = new Date(today);
    date.setDate(date.getDate() - 1);
    return formatDate(date);
  }

  if (/그제/.test(text)) {
    const date = new Date(today);
    date.setDate(date.getDate() - 2);
    return formatDate(date);
  }

  const monthDay = text.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
  if (monthDay) {
    const year = today.getFullYear();
    const month = monthDay[1].padStart(2, "0");
    const day = monthDay[2].padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  return null;
}

function extractDescriptionFromText(
  text: string,
  amount: number | null,
): string | null {
  let cleaned = text
    .replace(/오늘|어제|그제/g, " ")
    .replace(/\d+(?:\.\d+)?\s*만\s*원?/g, " ")
    .replace(/\d[\d,]*\s*원/g, " ")
    .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ")
    .replace(/\b\d{3,}\b/g, " ")
    .replace(/[,.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = cleaned
    .replace(/(썼|썼어|지출|결제|샀|탔|먹었|했어|함|함)$/g, "")
    .trim();

  if (!cleaned || cleaned.length < 2) return null;
  return cleaned;
}

function mergeFromHistory(history: ChatMessage[]): {
  date: string | null;
  amount: number | null;
  description: string | null;
} {
  let date: string | null = null;
  let amount: number | null = null;
  let description: string | null = null;
  const today = new Date();

  for (const message of history) {
    if (message.role !== "user") continue;

    date = extractDateFromText(message.content, today) ?? date;
    amount = extractAmountFromText(message.content) ?? amount;
    description =
      extractDescriptionFromText(message.content, amount) ?? description;
  }

  return { date, amount, description };
}

export function parseExpenseLocally(
  message: string,
  history: ChatMessage[] = [],
): ExpenseExtraction {
  const today = new Date();
  const merged = mergeFromHistory(history);

  const date = extractDateFromText(message, today) ?? merged.date;
  const amount = extractAmountFromText(message) ?? merged.amount;
  const description =
    extractDescriptionFromText(message, amount) ?? merged.description;

  return normalizeExtraction({
    date,
    amount,
    description,
    needs_clarification: !date || !amount || !description,
    clarification_message: null,
  });
}

export function buildClarificationReply(
  extraction: ExpenseExtraction,
): string {
  if (extraction.clarification_message) {
    return extraction.clarification_message;
  }

  if (extraction.amount && extraction.description && !extraction.date) {
    return `${extraction.description} ${extraction.amount.toLocaleString("ko-KR")}원이시군요! 언제 지출하셨나요? 예: 오늘, 어제, 8월 25일`;
  }

  if (extraction.date && extraction.description && !extraction.amount) {
    return `${extraction.description}에 얼마를 지출하셨나요?`;
  }

  if (extraction.date && extraction.amount && !extraction.description) {
    return `${extraction.date}에 얼마를, 어떤 내용으로 지출하셨나요?`;
  }

  if (!extraction.amount && extraction.description) {
    return `${extraction.description}에 얼마를 지출하셨나요?`;
  }

  if (extraction.amount && !extraction.description && !extraction.date) {
    return `${extraction.amount.toLocaleString("ko-KR")}원 지출이시군요! 어떤 내용이었고, 언제 지출하셨나요?`;
  }

  return "날짜, 금액, 내용을 알려주시면 저장해 드릴게요. 예: \"오늘 점심 15000원\"";
}
