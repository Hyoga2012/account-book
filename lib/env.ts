export function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

export function validateChatEnv(): void {
  getRequiredEnv("GEMINI_API_KEY");
  getRequiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  getRequiredEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}
