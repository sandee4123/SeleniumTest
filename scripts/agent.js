const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF || "";
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!token || !repo || !geminiKey) {
    console.error("Missing required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY, GEMINI_API_KEY");
    process.exit(1);
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error("Invalid GITHUB_REPOSITORY format. Expected owner/repo");
    process.exit(1);
  }

  const prMatch = ref.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) {
    console.log("Not a pull request ref. Exiting.");
    return;
  }

  const pullNumber = Number(prMatch[1]);

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}`,
    { headers: ghHeaders }
  );

  if (!prRes.ok) {
    console.error("Failed to fetch PR details:", await safeBody(prRes));
    return;
  }

  const prData = await prRes.json();
  const commitId = prData?.head?.sha;
  if (!commitId) {
    console.error("Missing commit SHA in PR details");
    return;
  }

  const files = await fetchAllPrFiles(owner, repoName, pullNumber, ghHeaders);
  if (!files.length) {
    console.log("No files returned by GitHub API");
    return;
  }

  const reviewFiles = files.filter(
    (f) =>
      f.patch &&
      f.status !== "removed" &&
      f.filename !== "scripts/agent.js" &&
      !f.filename.startsWith(".github/")
  );

  if (!reviewFiles.length) {
    console.log("No relevant patched files");
    return;
  }

  const fileContexts = reviewFiles.map((f) => ({
    filename: f.filename,
    parsed: parsePatchWithAbsoluteLines(f.patch),
  }));

  const promptPatch = fileContexts
    .map((fc) => {
      const rendered = fc.parsed.lines
        .map((l) => `[P${l.patchLine}] ${l.raw}`)
        .join("\n");
      return `FILE: ${fc.filename}\n${rendered}`;
    })
    .join("\n\n")
    .slice(0, 18000);

  const prompt = `
You are a strict senior code reviewer focused on correctness, maintainability, and test automation best practices.

Return ONLY valid JSON array:
[
  {
    "file": "exact/path/from_FILE_header",
    "patch_line": number,
    "type": "bug|security|performance|style|maintainability|test",
    "comment": "short actionable issue"
  }
]

Rules:
- "file" must exactly match a FILE header path.
- "patch_line" must be the numeric value from [P<number>] in that file block.
- Select ONLY added code lines (those beginning with "+").
- Do NOT use metadata lines, hunk headers, deleted lines, or context lines.
- Only report issues visible in the provided patch.
- No duplicates, no hallucinations, concise comments.
Review everything carefully and dont skip any category.

Bugs:
Check for null issues, wrong conditions, broken logic, or incorrect API usage.

Security:
Look for hardcoded credentials (usernames, passwords, tokens, card data) and any exposure of sensitive information.

Selenium practices:
Avoid inline locators inside actions; locators should be reusable.
Flag absolute XPath and overly generic XPath (like //button or //div).
Flag brittle selectors such as nth-child.
Avoid Thread.sleep; proper waits should be used instead.
Flag missing waits, pageSource-based validations, and any non-deterministic behavior.

Maintainability:
Avoid magic values; use constants.
Flag hardcoded paths and mutable static variables.
Identify repeated logic that should be reused.

Test design:
Check for proper setup and teardown.
Ensure driver lifecycle is handled correctly (including quit).
Flag weak or incomplete test structure.

Naming:
Names should clearly describe purpose.
Avoid vague, abbreviated, or inconsistent naming.
Use standard naming conventions for classes, methods, and variables.

Readability:
Flag complex or hard-to-read expressions.
Highlight anything that makes the code harder to understand.
Be thorough, but avoid repeating the same issue multiple times.

STRICT MODE:
- Do NOT skip small issues
- Do NOT combine multiple issues
- Maximize findings aggressively
Code:
${promptPatch}
`;

  const genAI = new GoogleGenerativeAI(geminiKey);

  let aiText;
  try {
    aiText = await callAI(prompt, genAI);
  } catch (e) {
    console.error("AI request failed:", e?.message || e);
    return;
  }

  const aiIssues = parseJSON(aiText);
  if (!Array.isArray(aiIssues) || aiIssues.length === 0) {
    console.log("No issues found by AI");
    return;
  }

  let comments = [];
  for (const issue of aiIssues) {
    if (!issue || typeof issue !== "object") continue;

    const file = String(issue.file || "").trim();
    const patchLine = Number(issue.patch_line);
    const comment = String(issue.comment || "").trim();

    if (!file || !Number.isInteger(patchLine) || patchLine <= 0 || !comment) continue;

    const fc = fileContexts.find((x) => x.filename === file);
    if (!fc) continue;

    const rec = fc.parsed.byPatchLine.get(patchLine);
    if (!rec) continue;

    if (rec.kind !== "add") continue;
    if (!Number.isInteger(rec.newLine) || rec.newLine <= 0) continue;

    comments.push({
      path: fc.filename,
      line: rec.newLine,
      side: "RIGHT",
      body: `[AI Review]: ${comment}`,
    });
  }

  const seen = new Set();
  comments = comments.filter((c) => {
    const key = `${c.path}:${c.line}:${normalizeText(c.body)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const existing = await fetchExistingReviewComments(owner, repoName, pullNumber, ghHeaders);
  const existingKeys = new Set(
    existing.map((c) =>
      `${c.path || c?.original_path || ""}:${c.line || c.original_line || ""}:${normalizeText(c.body)}`
    )
  );

  comments = comments.filter((c) => {
    const key = `${c.path}:${c.line}:${normalizeText(c.body)}`;
    return !existingKeys.has(key);
  });

  if (!comments.length) {
    console.log("No valid mappable comments after dedupe");
    return;
  }

  comments.sort((a, b) => {
    if (a.path === b.path) return a.line - b.line;
    return a.path.localeCompare(b.path);
  });

  const payloadComments = comments.map(({ path, line, side, body }) => ({
    path,
    line,
    side,
    body,
  }));

  const chunkSize = 30;
  let posted = 0;

  for (let i = 0; i < payloadComments.length; i += chunkSize) {
    const batch = payloadComments.slice(i, i + chunkSize);

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}/reviews`,
      {
        method: "POST",
        headers: {
          ...ghHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          commit_id: commitId,
          event: "COMMENT",
          comments: batch,
        }),
      }
    );

    const body = await safeBody(res);
    if (!res.ok) {
      console.error("GitHub API error:", body);
      continue;
    }

    posted += batch.length;
  }

  console.log(`Posted ${posted} comments`);
}

async function fetchAllPrFiles(owner, repoName, pullNumber, headers) {
  const all = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}/files?per_page=100&page=${page}`,
      { headers }
    );

    if (!res.ok) {
      console.error("Failed to fetch PR files page", page, ":", await safeBody(res));
      break;
    }

    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;

    all.push(...chunk);
    if (chunk.length < 100) break;
    page++;
  }

  return all;
}

async function fetchExistingReviewComments(owner, repoName, pullNumber, headers) {
  const all = [];
  let page = 1;

  while (true) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pullNumber}/comments?per_page=100&page=${page}`,
      { headers }
    );

    if (!res.ok) {
      console.error("Failed to fetch existing review comments page", page, ":", await safeBody(res));
      break;
    }

    const chunk = await res.json();
    if (!Array.isArray(chunk) || chunk.length === 0) break;

    all.push(...chunk);
    if (chunk.length < 100) break;
    page++;
  }

  return all;
}

function parsePatchWithAbsoluteLines(patch) {
  const lines = patch.split("\n");
  const byPatchLine = new Map();
  let oldLine = 0;
  let newLine = 0;
  const parsedLines = [];

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const patchLine = i + 1;
    let kind = "meta";
    let old = null;
    let neu = null;

    const hunk = raw.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      kind = "hunk";
    } else if (
      raw.startsWith("diff --git") ||
      raw.startsWith("index ") ||
      raw.startsWith("--- ") ||
      raw.startsWith("+++ ")
    ) {
      kind = "meta";
    } else if (raw.startsWith("+")) {
      kind = "add";
      neu = newLine;
      newLine++;
    } else if (raw.startsWith("-")) {
      kind = "del";
      old = oldLine;
      oldLine++;
    } else {
      kind = "context";
      old = oldLine;
      neu = newLine;
      oldLine++;
      newLine++;
    }

    const rec = { patchLine, raw, kind, oldLine: old, newLine: neu };
    parsedLines.push(rec);
    byPatchLine.set(patchLine, rec);
  }

  return { lines: parsedLines, byPatchLine };
}

async function callAI(prompt, genAI) {
  try {
    return await tryGemini("gemini-2.5-flash", prompt, genAI);
  } catch (e) {
    console.log("Flash failed, trying 2.0...");
  }

  try {
    return await tryGemini("gemini-2.0-flash", prompt, genAI);
  } catch (e) {
    console.log("2.0 Flash failed, trying DeepSeek...");
  }

  try {
    return await callOpenRouter(prompt);
  } catch (e) {
    console.log("DeepSeek failed, falling back to Lite...");
  }

  return await tryGemini("gemini-2.5-flash-lite", prompt, genAI);
}

async function tryGemini(modelName, prompt, genAI) {
  const retries = 3;

  for (let i = 0; i < retries; i++) {
    try {
      console.log(`Trying ${modelName} attempt ${i + 1}`);

      const model = genAI.getGenerativeModel({ model: modelName });
      const res = await model.generateContent(prompt);
      const text = res?.response?.text?.();

      if (text && text.trim()) return text;

    } catch (e) {
      const msg = String(e?.message || "");

      if (msg.includes("429")) {
        const delay = Math.pow(2, i) * 2000;
        console.log(`429 on ${modelName}, waiting ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      throw e;
    }
  }

  throw new Error(`${modelName} failed`);
}

// ONLY CHANGE: OpenRouter models fallback
async function callOpenRouter(prompt) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  console.log("Trying OpenRouter models");
  console.log("OpenRouter key exists:", !!apiKey);

  const models = [
    "qwen/qwen3-coder:free",
    "deepseek/deepseek-chat",
    "meta-llama/llama-3.3-70b-instruct:free",
    "nvidia/nemotron-3-super-120b-a12b:free"
  ];

  for (const model of models) {
    try {
      console.log("Trying OpenRouter model:", model);

      const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: prompt }
          ],
          temperature: 0.2
        })
      });

      const data = await res.json();

      if (!res.ok) continue;

      const text = data?.choices?.[0]?.message?.content;
      if (text) return text;

    } catch (e) {}
  }

  throw new Error("All OpenRouter models failed");
}

function parseJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      return JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
}

function normalizeText(text) {
  return String(text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

async function safeBody(res) {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return "unreadable response";
    }
  }
}

run().catch((e) => {
  console.error("FATAL:", e?.message || e);
  process.exit(1);
});
