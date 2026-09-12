function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  SUPABASE_URL: required("SUPABASE_URL"),
  SUPABASE_SERVICE_ROLE_KEY: required("SUPABASE_SERVICE_ROLE_KEY"),
  R2_ENDPOINT: required("R2_ENDPOINT"),
  R2_ACCESS_KEY_ID: required("R2_ACCESS_KEY_ID"),
  R2_SECRET_ACCESS_KEY: required("R2_SECRET_ACCESS_KEY"),
  R2_BUCKET_NAME: required("R2_BUCKET_NAME"),
  OPENAI_API_KEY: required("OPENAI_API_KEY"),
  POLL_INTERVAL_MS: Number(process.env.POLL_INTERVAL_MS ?? 4000),
};
