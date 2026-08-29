import { Expense } from "@/lib/supabase";

export type MonthlyTotal = {
  month: string;
  label: string;
  total: number;
};

export type CategoryTotal = {
  name: string;
  value: number;
  color: string;
};

const CATEGORY_RULES: Array<{ name: string; color: string; keywords: string[] }> = [
  {
    name: "식비",
    color: "#FEE500",
    keywords: [
      "점심",
      "저녁",
      "아침",
      "식사",
      "회식",
      "커피",
      "카페",
      "배달",
      "음식",
      "밥",
      "치킨",
      "피자",
      "술",
      "음료",
    ],
  },
  {
    name: "교통",
    color: "#4A90D9",
    keywords: ["택시", "버스", "지하철", "교통", "주유", "주차", "기차", "KTX", "항공"],
  },
  {
    name: "쇼핑",
    color: "#7ED321",
    keywords: ["쇼핑", "마트", "편의점", "쿠팡", "구매", "옷", "의류", "백화점"],
  },
  {
    name: "생활",
    color: "#BD10E0",
    keywords: ["공과금", "관리비", "통신", "전기", "가스", "수도", "인터넷", "휴대폰"],
  },
  {
    name: "문화",
    color: "#F5A623",
    keywords: ["영화", "공연", "게임", "구독", "넷플릭스", "책", "취미"],
  },
];

const OTHER_COLOR = "#9B9B9B";

export function categorizeExpense(description: string): string {
  const text = description.toLowerCase();
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => text.includes(keyword.toLowerCase()))) {
      return rule.name;
    }
  }
  return "기타";
}

export function getCategoryColor(name: string): string {
  return CATEGORY_RULES.find((rule) => rule.name === name)?.color ?? OTHER_COLOR;
}

export function buildMonthlyTotals(expenses: Expense[]): MonthlyTotal[] {
  const map = new Map<string, number>();

  for (const expense of expenses) {
    if (!expense.date || expense.date.length < 7) continue;
    const month = expense.date.slice(0, 7);
    map.set(month, (map.get(month) ?? 0) + expense.amount);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([month, total]) => {
      const [, m] = month.split("-");
      return {
        month,
        label: `${parseInt(m, 10)}월`,
        total,
      };
    });
}

export function buildCategoryTotals(expenses: Expense[]): CategoryTotal[] {
  const map = new Map<string, number>();

  for (const expense of expenses) {
    const category = categorizeExpense(expense.description);
    map.set(category, (map.get(category) ?? 0) + expense.amount);
  }

  return Array.from(map.entries())
    .map(([name, value]) => ({
      name,
      value,
      color: getCategoryColor(name),
    }))
    .sort((a, b) => b.value - a.value);
}
