import { Expense } from "@/lib/supabase";

export const BUDGET_STORAGE_KEY = "account-book-monthly-budget";
export const BUDGET_WARNING_THRESHOLD = 0.8;

export type BudgetStatus = {
  budget: number;
  spent: number;
  remaining: number;
  ratio: number;
  percent: number;
  monthLabel: string;
  isWarning: boolean;
  isOver: boolean;
};

export function getCurrentMonthKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function getCurrentMonthLabel(date = new Date()): string {
  return `${date.getMonth() + 1}월`;
}

export function loadBudget(): number {
  if (typeof window === "undefined") return 0;
  const raw = window.localStorage.getItem(BUDGET_STORAGE_KEY);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

export function saveBudget(amount: number): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(BUDGET_STORAGE_KEY, String(Math.round(amount)));
}

export function getMonthSpent(expenses: Expense[], monthKey?: string): number {
  const key = monthKey ?? getCurrentMonthKey();
  return expenses
    .filter((expense) => expense.date?.startsWith(key))
    .reduce((sum, expense) => sum + expense.amount, 0);
}

export function getBudgetStatus(
  expenses: Expense[],
  budget: number,
): BudgetStatus {
  const spent = getMonthSpent(expenses);
  const ratio = budget > 0 ? spent / budget : 0;
  const percent = Math.round(ratio * 100);
  const remaining = budget - spent;

  return {
    budget,
    spent,
    remaining,
    ratio,
    percent,
    monthLabel: getCurrentMonthLabel(),
    isWarning: budget > 0 && ratio >= BUDGET_WARNING_THRESHOLD,
    isOver: budget > 0 && spent >= budget,
  };
}

export function getBudgetWarningMessage(status: BudgetStatus): string | null {
  if (status.budget <= 0) return null;

  if (status.isOver) {
    const over = status.spent - status.budget;
    return `⚠️ ${status.monthLabel} 예산을 초과했어요!\n예산 ${status.budget.toLocaleString("ko-KR")}원 중 ${status.spent.toLocaleString("ko-KR")}원 사용 (${status.percent}%)\n초과 금액: ${over.toLocaleString("ko-KR")}원`;
  }

  if (status.isWarning) {
    return `⚠️ ${status.monthLabel} 예산의 ${status.percent}%를 사용했어요.\n예산 ${status.budget.toLocaleString("ko-KR")}원 중 ${status.spent.toLocaleString("ko-KR")}원 사용\n남은 예산: ${status.remaining.toLocaleString("ko-KR")}원`;
  }

  return null;
}
