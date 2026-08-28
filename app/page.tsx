"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { Expense, supabase } from "@/lib/supabase";

type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
};

export default function Home() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "안녕하세요! AI 가계부 챗봇이에요. 지출 내역을 자연어로 말씀해 주세요. 예: \"오늘 점심 15000원\"",
    },
  ]);
  const [input, setInput] = useState("");
  const [loadingExpenses, setLoadingExpenses] = useState(true);
  const [sending, setSending] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadExpenses();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  async function loadExpenses() {
    setLoadingExpenses(true);

    const { data } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    setExpenses(data ?? []);
    setLoadingExpenses(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const history = messages
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

      let data: { reply?: string; error?: string; saved?: boolean };
      try {
        data = await res.json();
      } catch {
        throw new Error(
          res.status === 504
            ? "서버 응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."
            : "서버 응답을 처리하지 못했습니다.",
        );
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
    }
  }

  return (
    <div className="flex h-dvh w-full flex-col bg-[#fafafa]">
      <header className="shrink-0 border-b border-[#eeeeee] bg-white px-4 py-4 sm:px-5">
        <h1 className="text-center text-lg font-semibold tracking-tight text-[#111111] sm:text-xl">
          AI 가계부 챗봇
        </h1>
      </header>

      <section className="shrink-0 border-b border-[#eeeeee] bg-white px-4 py-3 sm:px-5">
        <p className="mb-2 text-xs font-medium text-[#8a8a8a]">저장된 지출</p>
        {loadingExpenses ? (
          <p className="py-2 text-sm text-[#8a8a8a]">불러오는 중...</p>
        ) : expenses.length === 0 ? (
          <p className="py-2 text-sm text-[#8a8a8a]">저장된 지출이 없습니다.</p>
        ) : (
          <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {expenses.map((expense) => (
              <article
                key={expense.id}
                className="min-w-[160px] shrink-0 rounded-xl bg-[#f3f3f3] px-3.5 py-3 sm:min-w-[180px]"
              >
                <p className="truncate text-sm font-medium text-[#111111]">
                  {expense.description}
                </p>
                <p className="mt-1 font-mono text-base font-medium tabular-nums text-[#111111]">
                  {expense.amount.toLocaleString("ko-KR")}
                  <span className="ml-0.5 text-xs font-sans font-normal text-[#8a8a8a]">
                    원
                  </span>
                </p>
                <p className="mt-1 text-xs text-[#8a8a8a]">{expense.date}</p>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          <div className="mx-auto flex max-w-2xl flex-col gap-3">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-[15px] leading-relaxed sm:text-base ${
                    message.role === "user"
                      ? "rounded-br-sm bg-[#111111] text-white"
                      : "rounded-bl-sm bg-[#f3f3f3] text-[#111111]"
                  }`}
                >
                  <p className="whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-[#f3f3f3] px-4 py-2.5 text-[15px] text-[#8a8a8a]">
                  입력 중...
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>

        <form
          onSubmit={handleSubmit}
          className="shrink-0 border-t border-[#eeeeee] bg-white px-4 py-3 sm:px-5 sm:py-4"
        >
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="메시지를 입력하세요"
              disabled={sending}
              className="h-12 min-w-0 flex-1 rounded-full bg-[#f3f3f3] px-4 text-base text-[#111111] outline-none placeholder:text-[#b0b0b0] focus:ring-2 focus:ring-[#111111]/10 disabled:opacity-60 sm:h-11 sm:text-[15px]"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="flex h-12 shrink-0 items-center justify-center rounded-full bg-[#111111] px-5 text-sm font-medium text-white transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-40 sm:h-11"
            >
              전송
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
