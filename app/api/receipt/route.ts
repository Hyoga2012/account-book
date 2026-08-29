import { NextRequest, NextResponse } from "next/server";
import { validateChatEnv } from "@/lib/env";
import {
  callGeminiVision,
  getGeminiErrorMessage,
  parseGeminiJson,
} from "@/lib/gemini";
import { createServerSupabaseClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
]);

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

type ReceiptExtraction = {
  date: string | null;
  amount: number | null;
  store_name: string | null;
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
    const normalized = value.replace(/,/g, "").replace(/원/g, "").trim();
    if (!normalized || normalized === "null") return null;
    const num = Number(normalized);
    if (Number.isFinite(num) && num > 0) return Math.round(num);
  }
  return null;
}

function normalizeReceipt(raw: Partial<ReceiptExtraction>): ReceiptExtraction {
  const date = parseNullableString(raw.date);
  const amount = parseAmount(raw.amount);
  const storeName = parseNullableString(raw.store_name);
  const description =
    parseNullableString(raw.description) ?? storeName ?? "영수증 지출";

  return {
    date,
    amount,
    store_name: storeName,
    description,
    needs_clarification: Boolean(raw.needs_clarification) || !date || !amount,
    clarification_message: parseNullableString(raw.clarification_message),
  };
}

export async function POST(request: NextRequest) {
  try {
    validateChatEnv();

    const body = await request.json();
    const imageBase64 =
      typeof body.imageBase64 === "string" ? body.imageBase64 : "";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";

    if (!imageBase64 || !mimeType) {
      return NextResponse.json(
        { error: "영수증 이미지를 업로드해 주세요." },
        { status: 400 },
      );
    }

    if (!ALLOWED_MIME_TYPES.has(mimeType)) {
      return NextResponse.json(
        { error: "지원하지 않는 이미지 형식입니다. JPG, PNG, WEBP를 사용해 주세요." },
        { status: 400 },
      );
    }

    const approxBytes = Math.ceil((imageBase64.length * 3) / 4);
    if (approxBytes > MAX_IMAGE_BYTES) {
      return NextResponse.json(
        { error: "이미지가 너무 큽니다. 4MB 이하로 업로드해 주세요." },
        { status: 400 },
      );
    }

    const today = getTodayString();

    const text = await callGeminiVision(
      `당신은 한국어 영수증 OCR 분석기입니다.
오늘 날짜는 ${today}입니다.

영수증 이미지를 보고 아래 정보를 추출하세요.

반드시 JSON만 응답:
{
  "date": "YYYY-MM-DD 또는 null",
  "amount": 정수(총 결제 금액) 또는 null,
  "store_name": "가게 이름 또는 null",
  "description": "지출 내용(가게명 또는 품목 요약) 또는 null",
  "needs_clarification": true 또는 false,
  "clarification_message": "질문 또는 null"
}

규칙:
- amount는 총 결제 금액(합계/총액/결제금액)을 우선 사용하세요
- date는 영수증의 거래 날짜를 YYYY-MM-DD로 변환하세요
- store_name은 상호명/가게 이름입니다
- description은 가게 이름 또는 대표 품목으로 간결하게
- 읽기 어려운 값은 null로 두고 needs_clarification을 true로 설정하세요
- 영수증이 아니면 needs_clarification을 true로 설정하고 안내하세요`,
      {
        mimeType,
        data: imageBase64,
      },
      { json: true },
    );

    const extraction = normalizeReceipt(
      parseGeminiJson<ReceiptExtraction>(text),
    );

    if (
      extraction.needs_clarification ||
      !extraction.date ||
      !extraction.amount ||
      !extraction.description
    ) {
      return NextResponse.json({
        reply:
          extraction.clarification_message ??
          "영수증에서 정보를 충분히 읽지 못했어요. 더 선명한 사진으로 다시 올려 주시거나, 날짜·금액·가게 이름을 직접 알려 주세요.",
        saved: false,
        expense: null,
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
    const storeLabel = extraction.store_name
      ? ` (${extraction.store_name})`
      : "";

    return NextResponse.json({
      reply: `영수증을 인식했어요!\n${formattedDate} ${extraction.description}${storeLabel} ${formattedAmount}원을 저장했어요.`,
      saved: true,
      expense: {
        date: extraction.date,
        amount: extraction.amount,
        description: extraction.description,
        store_name: extraction.store_name,
      },
    });
  } catch (error) {
    console.error("Receipt API error:", error);
    return NextResponse.json(
      { error: getGeminiErrorMessage(error) },
      { status: 500 },
    );
  }
}
