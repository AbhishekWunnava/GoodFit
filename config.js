// Step 2 of the README: paste your two Supabase values here.
// The publishable (anon) key is SAFE to be public (your SQL rules protect the data).
window.APP_CONFIG = {
  SUPABASE_URL: "https://pedgqakutcltfwsbhpql.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_eBOkdSfC9NGrizJwVdEKOQ_SjP6vUXl",

  // Read resumes with Claude (README step 4: needs the parse-resume function and an
  // ANTHROPIC_API_KEY secret in Supabase). While false, resumes are read by the
  // rules-based reader in the browser, which is free but less accurate.
  USE_AI_READER: false,

  // The GoodFit assistant (chat panel on Matches). Needs the agent function deployed and the
  // ANTHROPIC_API_KEY secret (README step "GoodFit assistant"). While false, the panel explains how to turn it on.
  USE_AGENT: false,

  // The GoodFit extension's Chrome Web Store address (README step 13). While empty, the "GoodFit for Chrome"
  // page says it's coming soon and shows developer-preview install steps instead of an Add to Chrome button.
  EXTENSION_URL: "",
};
