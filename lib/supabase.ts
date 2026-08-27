import { createClient } from "@supabase/supabase-js";

export type Expense = {
  id: number;
  created_at: string;
  date: string;
  amount: number;
  description: string;
};

export const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);
