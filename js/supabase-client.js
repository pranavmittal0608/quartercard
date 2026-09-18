/* ============================================================
   SUPABASE -- accounts and the persistent chip wallet.

   Fill in your project's own values below, from the Supabase dashboard:
   Project Settings > API > Project URL, and Project API keys > anon public.

   The anon key is meant to be public -- it is safe to ship in client code
   because every table it can touch is locked down by the Row Level
   Security policies in sql/schema.sql, and every chip movement goes
   through one of the three functions defined there, not a direct write.
   Never put the service_role key here, or anywhere else client-side --
   that one is a real secret and bypasses RLS entirely.
   ============================================================ */
const SUPABASE_URL = "YOUR_SUPABASE_PROJECT_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const sb = (typeof window !== "undefined" && window.supabase &&
            SUPABASE_URL !== "YOUR_SUPABASE_PROJECT_URL")
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

function sbReady(){ return !!sb; }

async function sbSignUp(email, password, displayName){
  return sb.auth.signUp({
    email, password,
    options: { data: { display_name: displayName } }
  });
}
async function sbSignIn(email, password){
  return sb.auth.signInWithPassword({ email, password });
}
async function sbSignOut(){
  return sb.auth.signOut();
}
async function sbSession(){
  const { data, error } = await sb.auth.getSession();
  return error ? null : data.session;
}

/* The bonus amount is never passed from here -- it is decided entirely by
   the default on the database function, so there is nothing for a client
   to lie about even if someone calls this directly from dev tools. */
async function sbClaimWelcomeBonus(){
  return sb.rpc("claim_welcome_bonus");
}
async function sbBuyIn(amount, tableRef){
  return sb.rpc("buy_in", { amount, table_ref: tableRef });
}
async function sbCashOut(amount, tableRef){
  return sb.rpc("cash_out", { amount, table_ref: tableRef });
}
/* No ledger rows yet (brand new account, bonus not claimed) is a real
   state, not an error -- treat it as a balance of 0 rather than failing. */
async function sbBalance(){
  const { data, error } = await sb.from("chip_balance").select("balance").maybeSingle();
  if (error) return null;
  return data ? data.balance : 0;
}
