"use client";

import { FormEvent, useEffect, useState } from "react";
import { Expense } from "@/lib/supabase";
import {
  getBudgetStatus,
  getBudgetWarningMessage,
  loadBudget,
  saveBudget,
} from "@/lib/budget";

type BudgetPanelProps = {
  expenses: Expense[];
  compact?: boolean;
  onBudgetChange?: (budget: number) => void;
};

export default function BudgetPanel({
  expenses,
  compact = false,
  onBudgetChange,
}: BudgetPanelProps) {
  const [budget, setBudget] = useState(0);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const saved = loadBudget();
    setBudget(saved);
    setDraft(saved > 0 ? String(saved) : "");
    setEditing(saved <= 0);
    setReady(true);
  }, []);

  const status = getBudgetStatus(expenses, budget);
  const warning = getBudgetWarningMessage(status);

  function handleSave(e: FormEvent) {
    e.preventDefault();
    const value = Number(draft.replace(/,/g, ""));
    if (!Number.isFinite(value) || value <= 0) return;

    const next = Math.round(value);
    saveBudget(next);
    setBudget(next);
    setDraft(String(next));
    setEditing(false);
    onBudgetChange?.(next);
  }

  if (!ready) {
    return (
      <div className="rounded-xl bg-white px-3 py-4 text-xs text-[#999]">
        예산 불러오는 중...
      </div>
    );
  }

  const barWidth = Math.min(status.percent, 100);
  const barColor = status.isOver
    ? "#e5484d"
    : status.isWarning
      ? "#f5a623"
      : "#FEE500";

  return (
    <div className="rounded-xl bg-white px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-semibold text-[#191919]">
          {status.monthLabel} 예산
        </h3>
        {budget > 0 && !editing && (
          <button
            type="button"
            onClick={() => {
              setEditing(true);
              setDraft(String(budget));
            }}
            className="text-[11px] text-[#666] underline-offset-2 hover:underline"
          >
            수정
          </button>
        )}
      </div>

      {editing || budget <= 0 ? (
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-[#888]">
            이번 달 예산을 설정하면 사용 비율과 경고를 알려드려요.
          </p>
          <div className="flex gap-2">
            <input
              type="number"
              min={1}
              step={1000}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="예: 500000"
              className="h-9 min-w-0 flex-1 rounded-lg bg-[#f5f5f5] px-3 text-[13px] text-[#191919] outline-none placeholder:text-[#bbb]"
            />
            <button
              type="submit"
              className="h-9 shrink-0 rounded-lg bg-[#fee500] px-3 text-[12px] font-semibold text-[#191919] hover:bg-[#f5dc00]"
            >
              저장
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="font-mono text-[15px] font-semibold tabular-nums text-[#191919]">
              {status.spent.toLocaleString("ko-KR")}
              <span className="text-[11px] font-sans font-normal text-[#999]">
                원
              </span>
            </p>
            <p className="text-[11px] text-[#888]">
              / {status.budget.toLocaleString("ko-KR")}원
            </p>
          </div>

          <div className="h-2.5 overflow-hidden rounded-full bg-[#f0f0f0]">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${barWidth}%`, backgroundColor: barColor }}
            />
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span
              className={
                status.isOver
                  ? "font-semibold text-[#e5484d]"
                  : status.isWarning
                    ? "font-semibold text-[#d4890a]"
                    : "text-[#666]"
              }
            >
              {status.percent}% 사용
            </span>
            <span className="text-[#888]">
              {status.isOver
                ? `${(status.spent - status.budget).toLocaleString("ko-KR")}원 초과`
                : `${status.remaining.toLocaleString("ko-KR")}원 남음`}
            </span>
          </div>

          {warning && (
            <div
              className={`rounded-lg px-2.5 py-2 text-[11px] leading-relaxed whitespace-pre-wrap ${
                status.isOver
                  ? "bg-[#fff1f0] text-[#c92a2a]"
                  : "bg-[#fff8e8] text-[#9a6700]"
              }`}
            >
              {compact ? warning.split("\n")[0] : warning}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
