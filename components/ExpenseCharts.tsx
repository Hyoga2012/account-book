"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Expense } from "@/lib/supabase";
import {
  buildCategoryTotals,
  buildMonthlyTotals,
} from "@/lib/expense-charts";

type ExpenseChartsProps = {
  expenses: Expense[];
  compact?: boolean;
};

function formatWon(value: number): string {
  if (value >= 10000) {
    return `${Math.round(value / 10000)}만`;
  }
  return value.toLocaleString("ko-KR");
}

export default function ExpenseCharts({
  expenses,
  compact = false,
}: ExpenseChartsProps) {
  const monthly = buildMonthlyTotals(expenses);
  const categories = buildCategoryTotals(expenses);

  if (expenses.length === 0) {
    return (
      <div className="rounded-xl bg-white/80 px-3 py-6 text-center text-xs text-[#999]">
        지출이 쌓이면 차트가 표시됩니다.
      </div>
    );
  }

  const chartHeight = compact ? 140 : 160;

  return (
    <div className={`flex flex-col gap-3 ${compact ? "" : "gap-4"}`}>
      <section className="rounded-xl bg-white px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <h3 className="mb-2 text-[12px] font-semibold text-[#191919]">
          월별 총 지출
        </h3>
        <div style={{ width: "100%", height: chartHeight }}>
          <ResponsiveContainer>
            <BarChart data={monthly} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#eee" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: "#888" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tickFormatter={formatWon}
                tick={{ fontSize: 10, fill: "#888" }}
                axisLine={false}
                tickLine={false}
                width={42}
              />
              <Tooltip
                formatter={(value) => [
                  `${Number(value ?? 0).toLocaleString("ko-KR")}원`,
                  "지출",
                ]}
                contentStyle={{
                  borderRadius: 10,
                  border: "none",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                  fontSize: 12,
                }}
              />
              <Bar dataKey="total" fill="#FEE500" radius={[6, 6, 0, 0]} maxBarSize={36} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl bg-white px-3 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.06)]">
        <h3 className="mb-2 text-[12px] font-semibold text-[#191919]">
          카테고리별 지출
        </h3>
        <div style={{ width: "100%", height: chartHeight }}>
          <ResponsiveContainer>
            <PieChart>
              <Pie
                data={categories}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius={compact ? 28 : 36}
                outerRadius={compact ? 52 : 60}
                paddingAngle={2}
              >
                {categories.map((entry) => (
                  <Cell key={entry.name} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip
                formatter={(value) => [
                  `${Number(value ?? 0).toLocaleString("ko-KR")}원`,
                  "금액",
                ]}
                contentStyle={{
                  borderRadius: 10,
                  border: "none",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
                  fontSize: 12,
                }}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
          {categories.map((entry) => (
            <li
              key={entry.name}
              className="flex items-center gap-1.5 text-[11px] text-[#555]"
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              {entry.name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
