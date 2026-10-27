import { GoogleGenAI } from "@google/genai";

interface AttachedFile {
  name: string;
  type: string;
  size?: number;
  data: string; // Base64 string or data URL
}

interface AIRequestPayload {
  prompt: string;
  toolId?: string;
  toolName?: string;
  context?: string;
  systemInstruction?: string;
  files?: AttachedFile[];
  gradeLevel?: string;
}

interface VercelRequest {
  method?: string;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
}

interface VercelResponse {
  status: (code: number) => VercelResponse;
  json: (data: unknown) => VercelResponse;
  setHeader: (name: string, value: string) => VercelResponse;
}

/**
 * Verify a Firebase ID token WITHOUT the Admin SDK by asking Identity Toolkit to look the user up.
 * (Invalid / expired / revoked tokens are rejected by Google.) Requires FIREBASE_API_KEY (or VITE_FIREBASE_API_KEY)
 * to be set on the server. Returns the uid, or null when the token is missing / invalid.
 */
async function verifyFirebaseIdToken(authHeader: string | null): Promise<string | null> {
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const key = process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY;
  if (!token || !key) return null;
  try {
    const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: token }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { users?: Array<{ localId?: string }> };
    return data.users?.[0]?.localId ?? null;
  } catch {
    return null;
  }
}

/**
 * Best-effort per-user rate limit (in-memory: each serverless instance keeps its own counter, so this blunts abuse
 * rather than guaranteeing a hard cap — use Upstash/Redis or Firebase App Check + quotas for a strict limit).
 */
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 25;
const hits = new Map<string, number[]>();
function rateLimited(uid: string): boolean {
  const now = Date.now();
  const recent = (hits.get(uid) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(uid, recent);
    return true;
  }
  recent.push(now);
  hits.set(uid, recent);
  if (hits.size > 5000) for (const k of hits.keys()) { if (!(hits.get(k) ?? []).some((t) => now - t < RATE_WINDOW_MS)) hits.delete(k); }
  return false;
}

const MAX_BODY_BYTES = 8 * 1024 * 1024;
const MAX_PROMPT_CHARS = 8000;

export async function handleAIRequest(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ success: false, error: "Method not allowed" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Only signed-in Cortex users may spend the Gemini quota.
  const uid = await verifyFirebaseIdToken(request.headers.get("authorization"));
  if (!uid) {
    return new Response(
      JSON.stringify({ success: false, error: "Please sign in again to use Cortex AI." }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        success: false,
        error:
          "GEMINI_API_KEY is missing on Vercel. Please add GEMINI_API_KEY to your Vercel Project Environment Variables (Settings -> Environment Variables).",
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (rateLimited(uid)) {
    return new Response(
      JSON.stringify({ success: false, error: "You're sending requests too quickly. Please wait a few minutes and try again." }),
      { status: 429, headers: { "Content-Type": "application/json", "Retry-After": "600" } },
    );
  }
  const declaredSize = Number(request.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_BODY_BYTES) {
    return new Response(JSON.stringify({ success: false, error: "That request is too large." }), {
      status: 413,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    let body: AIRequestPayload;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid JSON request payload or file payload exceeded server capacity.",
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const {
      prompt,
      toolId = "study",
      toolName,
      context,
      systemInstruction,
      files,
      gradeLevel,
    } = body;

    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: "A prompt or study question is required." }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (prompt.length > MAX_PROMPT_CHARS) {
      return new Response(
        JSON.stringify({ success: false, error: `Your message is too long (max ${MAX_PROMPT_CHARS} characters).` }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
    if (Array.isArray(files) && files.length > 4) {
      return new Response(JSON.stringify({ success: false, error: "You can attach up to 4 files." }), {
        status: 413,
        headers: { "Content-Type": "application/json" },
      });
    }

    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });

    let defaultSystemInstruction =
      "You are Cortex AI, an intelligent, empathetic academic assistant, tutor, and study companion. " +
      "Provide clear, structured, engaging, and highly accurate educational responses. " +
      "Format your output cleanly using Markdown headers, bullet points, code blocks, or bold text where appropriate.";

    if (gradeLevel) {
      defaultSystemInstruction += `\n\nCRITICAL ACADEMIC ADAPTATION RULE: The student is currently studying at the "${gradeLevel}" level. You MUST tailor all your explanations, terminology, depth, example problems, and mathematical rigor specifically for a ${gradeLevel} student:`;
      if (gradeLevel === "Matric") {
        defaultSystemInstruction +=
          "\n- Matric Level (8th - 10th Grade): Focus on foundational clarity, clear step-by-step guidance, relatable real-world visual analogies, encouraging tone, and plain accessible explanations without unneeded complex jargon.";
      } else if (gradeLevel === "Intermediate") {
        defaultSystemInstruction +=
          "\n- Intermediate Level (FSc / A-Levels / 11th-12th Grade): Provide pre-university structure, clear formula derivations, exam-focused key points, and foundational conceptual rigor.";
      } else if (gradeLevel === "Undergraduate") {
        defaultSystemInstruction +=
          "\n- Undergraduate Level (Bachelor's / College): Maintain professional academic rigor, standard domain terminology, precise technical logic, working code implementations, and analytical problem-solving.";
      } else if (gradeLevel === "Graduate") {
        defaultSystemInstruction +=
          "\n- Graduate Level (Master's): Focus on advanced domain mechanics, research literature synthesis, critical trade-off analysis, and higher-order engineering or academic reasoning.";
      } else if (gradeLevel === "Mphil") {
        defaultSystemInstruction +=
          "\n- Mphil Level (Post-graduate Research): Emphasize research methodologies, theoretical frameworks, literature critiques, and formal analytical proofs.";
      } else if (gradeLevel === "Phd") {
        defaultSystemInstruction +=
          "\n- PhD Level (Doctoral / Advanced Research): Provide cutting-edge research insights, peer-reviewed academic rigor, formal mathematical proofs, paradigm comparisons, and publication-grade synthesis.";
      }
    }

    if (toolId === "quiz") {
      defaultSystemInstruction +=
        "\n\nSpecialized mode: Quiz Generator. Generate exactly 5 multiple-choice questions in valid JSON format as an array of objects. Each object MUST have keys: " +
        '"id" (number), "question" (string), "options" (array of 4 strings e.g. ["Option A", "Option B", "Option C", "Option D"]), "correctAnswer" (string "A", "B", "C", or "D"), "explanation" (string explaining why). ' +
        "Return the output as a valid JSON array inside a ```json ``` code block.";
    } else if (toolId === "flash") {
      defaultSystemInstruction +=
        "\n\nSpecialized mode: Flashcard Generator. Create clear, concise Front (Question) and Back (Answer/Explanation) pairs ideal for active recall and spaced repetition.";
    } else if (toolId === "lecture") {
      defaultSystemInstruction +=
        "\n\nSpecialized mode: Lecture Generator. Structure the response like a 30-minute interactive lecture outline with learning objectives, core concepts, real-world analogies, and review questions.";
    } else if (toolId === "road") {
      defaultSystemInstruction +=
        "\n\nSpecialized mode: Multi-Week Roadmap. Break down the goal into a week-by-week curriculum with key milestones and actionable study tasks.";
    } else if (toolId === "code") {
      defaultSystemInstruction +=
        "\n\nSpecialized mode: Coding Assistant. Provide working, elegant code, line-by-line debugging explanations, and best practices.";
    } else if (toolId === "hw") {
      defaultSystemInstruction +=
        "\n\nSpecialized mode: Homework Guide. Provide helpful hints, guiding questions, and step-by-step reasoning without revealing direct answers immediately so the student learns.";
    }

    if (systemInstruction) {
      defaultSystemInstruction += `\n\nAdditional user guidelines: ${systemInstruction}`;
    }

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    // Attach reference material files
    if (files && Array.isArray(files) && files.length > 0) {
      for (const file of files) {
        if (!file || !file.data) continue;
        const nameLower = (file.name || "").toLowerCase();
        let mimeType = file.type || "application/octet-stream";

        if (nameLower.endsWith(".pdf")) {
          mimeType = "application/pdf";
        } else if (nameLower.endsWith(".png")) {
          mimeType = "image/png";
        } else if (nameLower.endsWith(".jpg") || nameLower.endsWith(".jpeg")) {
          mimeType = "image/jpeg";
        } else if (nameLower.endsWith(".webp")) {
          mimeType = "image/webp";
        } else if (nameLower.endsWith(".gif")) {
          mimeType = "image/gif";
        } else if (nameLower.endsWith(".mp3")) {
          mimeType = "audio/mp3";
        } else if (nameLower.endsWith(".wav")) {
          mimeType = "audio/wav";
        } else if (
          nameLower.endsWith(".txt") ||
          nameLower.endsWith(".md") ||
          nameLower.endsWith(".js") ||
          nameLower.endsWith(".ts") ||
          nameLower.endsWith(".py") ||
          nameLower.endsWith(".java") ||
          nameLower.endsWith(".cpp") ||
          nameLower.endsWith(".c") ||
          nameLower.endsWith(".json") ||
          nameLower.endsWith(".csv")
        ) {
          mimeType = "text/plain";
        }

        const isDataUrl = typeof file.data === "string" && file.data.startsWith("data:");
        const cleanBase64 = isDataUrl ? file.data.split(",")[1] || "" : file.data;

        if (
          mimeType.startsWith("image/") ||
          mimeType === "application/pdf" ||
          mimeType.startsWith("audio/")
        ) {
          parts.push({
            inlineData: {
              mimeType,
              data: cleanBase64,
            },
          });
          parts.push({
            text: `[Attached Reference Material: ${file.name}]`,
          });
        } else {
          let textContent = "";
          if (isDataUrl) {
            try {
              textContent = Buffer.from(cleanBase64, "base64").toString("utf-8");
            } catch {
              textContent = file.data;
            }
          } else {
            textContent = file.data;
          }

          if (textContent.length > 50000) {
            textContent = textContent.slice(0, 50000) + "\n...[truncated long text]...";
          }

          parts.push({
            text: `\n=== Attached Reference Document: ${file.name} (${mimeType}) ===\n${textContent}\n=== End of Attached Document ===\n`,
          });
        }
      }
    }

    let mainPromptText = prompt.trim();
    if (context) {
      mainPromptText = `Context / Text Material provided by user:\n"""\n${context}\n"""\n\nUser Question / Instruction:\n${mainPromptText}`;
    }
    if (toolName) {
      mainPromptText = `[Tool Context: ${toolName}]\n${mainPromptText}`;
    }

    parts.push({ text: mainPromptText });

    const candidateModels = ["gemini-3.6-flash", "gemini-flash-latest", "gemini-2.5-flash"];

    let lastError: unknown = null;
    let responseText: string | null = null;

    for (const modelName of candidateModels) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: { parts },
          config: {
            systemInstruction: defaultSystemInstruction,
          },
        });
        if (response.text) {
          responseText = response.text;
          break;
        }
      } catch (e: unknown) {
        lastError = e;
        console.warn(`Gemini model ${modelName} failed, trying fallback model. Error:`, e);
      }
    }

    if (!responseText) {
      throw lastError || new Error("All Gemini model generation attempts failed.");
    }

    return new Response(
      JSON.stringify({
        success: true,
        text: responseText,
        toolId,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err: unknown) {
    console.error("Gemini API handler error:", err);
    const errorMessage = err instanceof Error ? err.message : "An unexpected AI error occurred.";
    return new Response(
      JSON.stringify({
        success: false,
        error: `AI Generation Error: ${errorMessage}`,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
}

// Support Vercel Web Standard Endpoint (POST)
export async function POST(request: Request) {
  try {
    return await handleAIRequest(request);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// Support Legacy Vercel Serverless Function Signature (req, res)
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" });
  }

  try {
    const bodyString = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
    const webReq = new Request("http://localhost/api/ai/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // forward the caller's Firebase ID token so handleAIRequest can verify it
        ...(typeof req.headers?.authorization === "string"
          ? { Authorization: req.headers.authorization }
          : {}),
      },
      body: bodyString,
    });

    const webRes = await handleAIRequest(webReq);
    const resText = await webRes.text();
    let data: unknown;
    try {
      data = JSON.parse(resText);
    } catch {
      data = { success: false, error: resText || "Server error occurred" };
    }
    return res.status(webRes.status).json(data);
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : "Internal server error";
    return res.status(200).json({ success: false, error: errorMessage });
  }
}
