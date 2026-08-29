"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Expense, supabase } from "@/lib/supabase";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

type SpeechRecognitionResultLike = {
  readonly isFinal: boolean;
  readonly [index: number]: { transcript: string };
};

type SpeechRecognitionEventLike = Event & {
  readonly resultIndex: number;
  readonly results: {
    readonly length: number;
    [index: number]: SpeechRecognitionResultLike;
  };
};

type SpeechRecognitionErrorEventLike = Event & {
  readonly error: string;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
};

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognition(): SpeechRecognitionConstructor | null {
  if (typeof window === "undefined") return null;

  const win = window as Window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };

  return win.SpeechRecognition ?? win.webkitSpeechRecognition ?? null;
}

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "안녕하세요! AI 가계부 챗봇이에요.\n지출 내역을 자연어로 말씀해 주세요.\n예: \"오늘 점심 15000원\"\n마이크 버튼으로 음성 입력도 가능해요.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [sending, setSending] = useState(false);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const messagesRef = useRef(messages);
  const sendingRef = useRef(sending);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sendingRef.current = sending;
  }, [sending]);

  useEffect(() => {
    void loadExpenses();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending, listening]);

  useEffect(() => {
    const SpeechRecognitionAPI = getSpeechRecognition();
    setSpeechSupported(Boolean(SpeechRecognitionAPI));

    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  async function loadExpenses() {
    setLoadingExpenses(true);

    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    setExpenses(data ?? []);
    setLoadingExpenses(false);
  }

  async function sendToGemini(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sendingRef.current) return;

    const history = messagesRef.current
      .filter((m) => m.id !== "welcome")
      .map((m) => ({ role: m.role, content: m.content }));

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setSending(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed, history }),
      });

      const responseText = await res.text();

      let data: { reply?: string; error?: string; saved?: boolean };
      try {
        data = JSON.parse(responseText) as {
          reply?: string;
          error?: string;
          saved?: boolean;
        };
      } catch {
        const isHtml = /<!doctype html|<html/i.test(responseText);

        if (res.status === 401 && isHtml) {
          throw new Error(
            "API 접근이 차단되었습니다. Vercel 설정 → Deployment Protection에서 인증을 해제하거나 API 경로를 허용해 주세요.",
          );
        }

        if (res.status === 504 || res.status === 502) {
          throw new Error(
            "서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.",
          );
        }

        if (isHtml) {
          throw new Error(
            `서버 오류가 발생했습니다. (${res.status}) Vercel Functions 로그를 확인해 주세요.`,
          );
        }

        throw new Error("서버 응답을 처리하지 못했습니다.");
      }

      const assistantMessage: Message = {
        id: crypto.randomUUID(),
        role: "assistant",
        content: res.ok
          ? (data.reply ?? "응답을 받지 못했습니다.")
          : (data.error ?? "오류가 발생했습니다. 다시 시도해 주세요."),
      };

      setMessages((prev) => [...prev, assistantMessage]);

      if (res.ok && data.saved) {
        await loadExpenses();
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "네트워크 오류가 발생했습니다. 다시 시도해 주세요.";

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: message,
        },
      ]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void sendToGemini(input);
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setListening(false);
  }

  function startListening() {
    const SpeechRecognitionAPI = getSpeechRecognition();

    if (!SpeechRecognitionAPI) {
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content:
            "이 브라우저는 음성 인식을 지원하지 않습니다. Chrome 또는 Edge를 사용해 주세요.",
        },
      ]);
      return;
    }

    if (sending || listening) return;

    recognitionRef.current?.abort();

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = "ko-KR";
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    let finalTranscript = "";

    recognition.onresult = (event: SpeechRecognitionEventLike) => {
      let interim = "";

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? "";

        if (result.isFinal) {
          finalTranscript += transcript;
        } else {
          interim += transcript;
        }
      }

      setInput((finalTranscript + interim).trim());
    };

    recognition.onerror = (event: SpeechRecognitionErrorEventLike) => {
      setListening(false);

      if (event.error === "aborted" || event.error === "no-speech") {
        return;
      }

      const errorMessage =
        event.error === "not-allowed"
          ? "마이크 권한이 필요합니다. 브라우저에서 마이크 사용을 허용해 주세요."
          : "음성 인식 중 오류가 발생했습니다. 다시 시도해 주세요.";

      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: errorMessage,
        },
      ]);
    };

    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;

      const text = finalTranscript.trim();
      if (text) {
        void sendToGemini(text);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
      setListening(true);
      setInput("");
    } catch {
      setListening(false);
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          content: "음성 인식을 시작할 수 없습니다. 다시 시도해 주세요.",
        },
      ]);
    }
  }

  function toggleListening() {
    if (listening) {
      stopListening();
      return;
    }

    startListening();
  }

  const canSend = input.trim().length > 0 && !sending && !listening;

  return (
    <div className="flex h-dvh w-full items-stretch justify-center bg-[#a8b9c8] sm:bg-[#8fa3b5] sm:p-4 md:p-6">
      <div className="flex h-full w-full max-w-[420px] flex-col overflow-hidden bg-[#b2c7da] shadow-none sm:max-w-[880px] sm:rounded-xl sm:shadow-[0_12px_40px_rgba(0,0,0,0.22)]">
        <div className="hidden shrink-0 items-center justify-between bg-[#3c3c3c] px-4 py-2 sm:flex">
          <p className="text-[13px] font-medium text-white/90">
            AI 가계부 챗봇
          </p>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-[#ffbd2e]" />
            <span className="h-3 w-3 rounded-full bg-[#28c840]" />
            <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-[280px] shrink-0 flex-col border-r border-black/10 bg-[#ededed] sm:flex">
            <div className="flex items-center gap-3 border-b border-black/5 bg-white px-4 py-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fee500] text-sm font-bold text-[#191919]">
                AI
              </div>
              <div className="min-w-0">
                <p className="truncate text-[15px] font-semibold text-[#191919]">
                  AI 가계부
                </p>
                <p className="truncate text-xs text-[#999]">내 지출 친구</p>
              </div>
            </div>

            <div className="border-b border-black/5 bg-white px-4 py-2.5">
              <p className="text-xs font-medium text-[#999]">저장된 지출</p>
            </div>

            <div className="kakao-scrollbar flex-1 overflow-y-auto">
              {loadingExpenses ? (
                <p className="px-4 py-6 text-sm text-[#999]">불러오는 중...</p>
              ) : expenses.length === 0 ? (
                <p className="px-4 py-6 text-sm text-[#999]">
                  저장된 지출이 없습니다.
                </p>
              ) : (
                <ul>
                  {expenses.map((expense) => (
                    <li
                      key={expense.id}
                      className="flex items-center gap-3 border-b border-black/[0.04] px-4 py-3 transition-colors hover:bg-white/70"
                    >
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#d4e0ea] text-xs font-semibold text-[#4a6678]">
                        {expense.description.slice(0, 2)}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-[14px] font-medium text-[#191919]">
                            {expense.description}
                          </p>
                          <p className="shrink-0 font-mono text-[12px] tabular-nums text-[#666]">
                            {expense.amount.toLocaleString("ko-KR")}
                          </p>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[#999]">
                          {expense.date}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-3 border-b border-black/5 bg-white/95 px-3 py-2.5 backdrop-blur-sm sm:px-4 sm:py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-[10px] bg-[#fee500] text-[13px] font-bold text-[#191919] sm:h-10 sm:w-10">
                AI
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-[16px] font-semibold text-[#191919] sm:text-[17px]">
                  AI 가계부 챗봇
                </h1>
                <p className="truncate text-[11px] text-[#999] sm:text-xs">
                  {listening
                    ? "듣고 있어요..."
                    : expenses.length > 0
                      ? `지출 ${expenses.length}건`
                      : "대화를 시작해 보세요"}
                </p>
              </div>
            </header>

            <section className="shrink-0 border-b border-black/5 bg-white/80 px-3 py-2 sm:hidden">
              <p className="mb-1.5 text-[11px] font-medium text-[#999]">
                저장된 지출
              </p>
              {loadingExpenses ? (
                <p className="py-1 text-xs text-[#999]">불러오는 중...</p>
              ) : expenses.length === 0 ? (
                <p className="py-1 text-xs text-[#999]">
                  저장된 지출이 없습니다.
                </p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {expenses.map((expense) => (
                    <article
                      key={expense.id}
                      className="min-w-[132px] shrink-0 rounded-xl bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    >
                      <p className="truncate text-[13px] font-medium text-[#191919]">
                        {expense.description}
                      </p>
                      <p className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums text-[#191919]">
                        {expense.amount.toLocaleString("ko-KR")}
                        <span className="ml-0.5 text-[11px] font-sans font-normal text-[#999]">
                          원
                        </span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-[#999]">
                        {expense.date}
                      </p>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <div className="kakao-scrollbar flex-1 overflow-y-auto px-3 py-4 sm:px-5">
              <div className="mx-auto flex max-w-[640px] flex-col gap-3">
                {messages.map((message) =>
                  message.role === "user" ? (
                    <div key={message.id} className="flex justify-end">
                      <div className="relative max-w-[78%] rounded-[18px] rounded-tr-[4px] bg-[#fee500] px-3.5 py-2.5 text-[15px] leading-[1.45] text-[#191919] shadow-[0_1px_1px_rgba(0,0,0,0.06)] sm:max-w-[70%] sm:text-[14px]">
                        <p className="whitespace-pre-wrap break-words">
                          {message.content}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div key={message.id} className="flex items-end gap-2">
                      <div className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#fee500] text-[11px] font-bold text-[#191919] shadow-[0_1px_2px_rgba(0,0,0,0.08)]">
                        AI
                      </div>
                      <div className="min-w-0">
                        <p className="mb-1 ml-0.5 text-[11px] text-[#555]">
                          AI 가계부
                        </p>
                        <div className="relative max-w-[78vw] rounded-[18px] rounded-tl-[4px] bg-white px-3.5 py-2.5 text-[15px] leading-[1.45] text-[#191919] shadow-[0_1px_1px_rgba(0,0,0,0.06)] sm:max-w-[320px] sm:text-[14px]">
                          <p className="whitespace-pre-wrap break-words">
                            {message.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  ),
                )}

                {listening && (
                  <div className="flex justify-center py-1">
                    <div className="flex items-center gap-2 rounded-full bg-white/90 px-4 py-2 text-[13px] text-[#191919] shadow-[0_1px_3px_rgba(0,0,0,0.1)]">
                      <span className="relative flex h-2.5 w-2.5">
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
                      </span>
                      음성 인식 중... 말씀해 주세요
                    </div>
                  </div>
                )}

                {sending && (
                  <div className="flex items-end gap-2">
                    <div className="mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[#fee500] text-[11px] font-bold text-[#191919]">
                      AI
                    </div>
                    <div>
                      <p className="mb-1 ml-0.5 text-[11px] text-[#555]">
                        AI 가계부
                      </p>
                      <div className="rounded-[18px] rounded-tl-[4px] bg-white px-4 py-3 text-[14px] text-[#999] shadow-[0_1px_1px_rgba(0,0,0,0.06)]">
                        <span className="inline-flex gap-1">
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#bbb] [animation-delay:0ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#bbb] [animation-delay:150ms]" />
                          <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#bbb] [animation-delay:300ms]" />
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatEndRef} />
              </div>
            </div>

            <form
              onSubmit={handleSubmit}
              className="shrink-0 border-t border-black/5 bg-white px-2.5 py-2 sm:px-3 sm:py-2.5"
            >
              <div className="mx-auto flex max-w-[640px] items-end gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={toggleListening}
                  disabled={sending || !speechSupported}
                  aria-label={listening ? "음성 인식 중지" : "음성 인식 시작"}
                  title={
                    speechSupported
                      ? listening
                        ? "음성 인식 중지"
                        : "음성으로 입력"
                      : "이 브라우저는 음성 인식을 지원하지 않습니다"
                  }
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors sm:h-10 sm:w-10 ${
                    listening
                      ? "bg-red-500 text-white"
                      : speechSupported
                        ? "bg-[#f5f5f5] text-[#555] hover:bg-[#ebebeb]"
                        : "cursor-not-allowed bg-[#f0f0f0] text-[#ccc]"
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-5 w-5"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z" />
                  </svg>
                </button>

                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    listening
                      ? "듣고 있어요..."
                      : "메시지를 입력하거나 마이크를 눌러보세요"
                  }
                  disabled={sending || listening}
                  className="min-h-9 min-w-0 flex-1 rounded-[20px] bg-[#f5f5f5] px-4 py-2 text-[15px] text-[#191919] outline-none placeholder:text-[#b0b0b0] disabled:opacity-60 sm:min-h-10 sm:text-[14px]"
                />

                <button
                  type="submit"
                  disabled={!canSend}
                  aria-label="전송"
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold transition-colors sm:h-10 sm:w-10 ${
                    canSend
                      ? "bg-[#fee500] text-[#191919] hover:bg-[#f5dc00]"
                      : "bg-[#f0f0f0] text-[#bbb]"
                  }`}
                >
                  ↑
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
