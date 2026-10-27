import { auth } from "@/integrations/firebase/client";

/** `fetch` that attaches the signed-in user's Firebase ID token (the AI endpoint rejects anonymous calls). */
export async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = await auth.currentUser?.getIdToken();
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
}
