"use client";

import { FormEvent, useEffect, useState } from "react";
import { Expense, supabase } from "@/lib/supabase";

export default function Home() {
  const [date, setDate] = useState("");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void loadExpenses();
  }, []);

  async function loadExpenses() {
    setLoading(true);
    setError(null);

    const { data, error: fetchError } = await supabase
      .from("expenses")
      .select("*")
      .order("created_at", { ascending: false });

    if (fetchError) {
      setError(fetchError.message);
      setExpenses([]);
    } else {
      setExpenses(data ?? []);
    }

    setLoading(false);
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const { error: insertError } = await supabase.from("expenses").insert({
      date,
      amount: Number(amount),
      description,
    });

    if (insertError) {
      setError(insertError.message);
      setSaving(false);
      return;
    }

    setDate("");
    setAmount("");
    setDescription("");
    await loadExpenses();
    setSaving(false);
  }

  const fieldClassName =
    "h-14 w-full rounded-xl bg-white px-4 text-base text-[#111111] outline-none transition placeholder:text-[#b0b0b0] focus:ring-2 focus:ring-[#111111]/15 sm:h-12 sm:text-[15px]";

  return (
    <div className="flex min-h-full w-full flex-1 flex-col bg-[#fafafa]">
      <header className="w-full">
        <div className="mx-auto flex w-full max-w-xl items-center justify-center px-5 py-10 sm:px-6 sm:py-14">
          <h1 className="text-center text-3xl font-semibold tracking-tight text-[#111111] sm:text-[28px]">
            나의 AI 가계부
          </h1>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-12 px-5 pb-16 sm:gap-14 sm:px-6">
        <form
          onSubmit={handleSubmit}
          className="flex w-full flex-col gap-7 rounded-2xl bg-[#f3f3f3] p-6 sm:gap-6 sm:p-8"
        >
          <div className="flex flex-col gap-1.5">
            <p className="text-base font-medium tracking-tight text-[#111111] sm:text-[15px]">
              지출 내역 입력
            </p>
            <p className="text-base leading-relaxed text-[#8a8a8a] sm:text-sm">
              날짜, 금액, 내용을 입력한 뒤 저장하세요.
            </p>
          </div>

          <label className="flex flex-col gap-2.5 sm:gap-2">
            <span className="text-base text-[#8a8a8a] sm:text-sm">날짜</span>
            <input
              type="date"
              required
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className={fieldClassName}
            />
          </label>

          <label className="flex flex-col gap-2.5 sm:gap-2">
            <span className="text-base text-[#8a8a8a] sm:text-sm">금액</span>
            <input
              type="number"
              required
              min={1}
              step={1}
              placeholder="예: 12000"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className={`${fieldClassName} font-mono tabular-nums`}
            />
          </label>

          <label className="flex flex-col gap-2.5 sm:gap-2">
            <span className="text-base text-[#8a8a8a] sm:text-sm">내용</span>
            <input
              type="text"
              required
              placeholder="예: 점심 식사"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={fieldClassName}
            />
          </label>

          {error && (
            <p className="text-base text-[#8a8a8a] sm:text-sm">{error}</p>
          )}

          <button
            type="submit"
            disabled={saving}
            className="mt-1 h-14 w-full rounded-xl bg-[#111111] text-base font-medium text-white transition-colors hover:bg-[#2a2a2a] disabled:cursor-not-allowed disabled:opacity-50 sm:h-12 sm:text-[15px]"
          >
            {saving ? "저장 중..." : "저장하기"}
          </button>
        </form>

        <section className="flex w-full flex-col gap-5">
          <h2 className="text-base font-medium tracking-tight text-[#111111] sm:text-[15px]">
            지출 목록
          </h2>

          {loading ? (
            <p className="py-6 text-base text-[#8a8a8a] sm:text-sm">
              불러오는 중...
            </p>
          ) : expenses.length === 0 ? (
            <p className="py-10 text-center text-base text-[#8a8a8a] sm:text-sm">
              아직 저장된 지출이 없습니다.
            </p>
          ) : (
            <ul className="flex w-full flex-col gap-3">
              {expenses.map((expense) => (
                <li
                  key={expense.id}
                  className="w-full rounded-2xl bg-[#f3f3f3] px-5 py-5 sm:px-6"
                >
                  <div className="flex items-baseline justify-between gap-6">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-base font-medium tracking-tight text-[#111111] sm:text-[15px]">
                        {expense.description}
                      </p>
                      <p className="mt-1.5 text-base text-[#8a8a8a] sm:text-sm">
                        {expense.date}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-xl font-medium tabular-nums tracking-tight text-[#111111] sm:text-2xl">
                      {expense.amount.toLocaleString("ko-KR")}
                      <span className="ml-0.5 text-sm font-sans font-normal text-[#8a8a8a] sm:text-base">
                        원
                      </span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
