const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF;
  const geminiKey = process.env.GEMINI_API_KEY;

  if (!token || !repo || !ref || !geminiKey) {
    console.error("Missing required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_REF, GEMINI_API_KEY");
    return;
  }

  const [owner, repoName] = repo.split("/");
  if (!owner || !repoName) {
    console.error("Invalid GITHUB_REPOSITORY format, expected owner/repo");
    return;
  }

  const prMatch = ref.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) {
    console.log("Not a pull_request ref, skipping");
    return;
  }

  const pull_number = Number(prMatch[1]);

  const ghHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  // ---- PR details ----
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}`,
    { headers: ghHeaders }
  );

  if (!prRes.ok) {
    const err = await safeJson(prRes);
    console.error("Failed to fetch PR details:", err);
    return;
  }

  const prData = await prRes.json();
  const commit_id = prData?.head?.sha;
  if (!commit_id) {
    console.error("Missing head SHA from PR data");
    return;
  }

  // ---- PR files ----
  const filesRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/files?per_page=100`,
    { headers: ghHeaders }
  );

  if (!filesRes.ok) {
    const err = await safeJson(filesRes);
    console.error("Failed to fetch PR files:", err);
    return;
  }

  const files = await filesRes.json();

  const reviewFiles = files.filter(
    (f) =>
      f.patch &&
      f.filename !== "scripts/agent.js" &&
      !f.filename.startsWith(".github/")
  );

  if (!reviewFiles.length) {
    console.log("No relevant files");
    return;
  }

  // ---- Combine patch for prompt ----
  const combinedPatch = reviewFiles
    .map((f) => `FILE: ${f.filename}\n${f.patch}`)
    .join("\n\n")
    .slice(0, 12000);

  const genAI = new GoogleGenerativeAI(geminiKey);

  // ---- Prompt ----
  const prompt = `
You are a strict senior code reviewer.

Return ONLY valid JSON array:
[
  {
    "file": "exact/path/from_FILE_header",
    "new_line": number,
    "type": "issue_category",
    "comment": "short issue description"
  }
]

Rules:
- "new_line" MUST be the line number in the NEW file (RIGHT side of PR diff).
- Only report issues visible in provided patch.
- Do not hallucinate.
- Do not repeat issues.
- Keep comments concise and actionable.

Code:
${combinedPatch}
`;

  async function callGemini(genAIInstance, promptText) {
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

    for (const name of models) {
      try {
        console.log(`Trying model: ${name}`);
        const model = genAIInstance.getGenerativeModel({ model: name });
        const res = await model.generateContent(promptText);
        const text = res?.response?.text?.();
        if (text && text.trim()) return text;
      } catch (e) {
        const msg = String(e?.message || "");
        if (msg.includes("429") || msg.includes("503")) continue;
        throw e;
      }
    }

    throw new Error("All Gemini models failed");
  }

  function parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          return [];
        }
      }
      return [];
    }
  }

  // Maps each patch row to new-file line number where comment can be attached on RIGHT.
  // For deleted lines ("-"), mapping is null because single-line RIGHT comments cannot target removed lines.
  function buildPatchIndexToNewLineMap(patch) {
    const lines = patch.split("\n");
    const map = new Array(lines.length).fill(null);

    let oldLine = 0;
    let newLine = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const hunk = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        oldLine = Number(hunk[1]);
        newLine = Number(hunk[2]);
        continue;
      }

      if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ")
      ) {
        continue;
      }

      if (line.startsWith("+")) {
        map[i] = newLine;
        newLine++;
      } else if (line.startsWith("-")) {
        map[i] = null;
        oldLine++;
      } else {
        // context line (" " or empty in edge cases)
        map[i] = newLine;
        oldLine++;
        newLine++;
      }
    }

    return map;
  }

  // Collect all reachable RIGHT-side line numbers from patch
  function collectValidNewLines(patch) {
    const map = buildPatchIndexToNewLineMap(patch);
    const valid = map.filter((n) => Number.isInteger(n) && n > 0);
    return { map, valid };
  }

  function normalizePathMatch(aiFile, actualPath) {
    if (!aiFile) return true;
    return (
      actualPath === aiFile ||
      actualPath.endsWith(`/${aiFile}`) ||
      actualPath.endsWith(aiFile)
    );
  }

  function nearestValidLine(target, sortedValidLines) {
    if (!sortedValidLines.length) return null;
    if (!Number.isFinite(target)) return sortedValidLines[0];

    let best = sortedValidLines[0];
    let bestDist = Math.abs(best - target);

    for (let i = 1; i < sortedValidLines.length; i++) {
      const n = sortedValidLines[i];
      const d = Math.abs(n - target);
      if (d < bestDist) {
        best = n;
        bestDist = d;
      }
    }
    return best;
  }

  let comments = [];

  try {
    const text = await callGemini(genAI, prompt);
    const parsed = parseJSON(text);

    if (!Array.isArray(parsed)) {
      console.log("AI output not an array; skipping comments");
      return;
    }

    for (const file of reviewFiles) {
      const { valid } = collectValidNewLines(file.patch);
      if (!valid.length) continue;

      // Keep sorted for stable nearest-line fallback
      const sortedValid = [...new Set(valid)].sort((a, b) => a - b);

      for (const c of parsed) {
        if (!c || typeof c !== "object") continue;
        if (!c.comment || typeof c.comment !== "string") continue;
        if (!normalizePathMatch(c.file, file.filename)) continue;

        const requested = Number(c.new_line);
        let line = Number.isFinite(requested) && requested > 0 ? requested : null;

        // If line isn't in changed/context lines in patch, snap to nearest valid line
        if (!line || !sortedValid.includes(line)) {
          line = nearestValidLine(line ?? sortedValid[0], sortedValid);
        }

        if (!line) continue;

        comments.push({
          path: file.filename,
          line,
          side: "RIGHT",
          body: c.comment.trim(),
          _type: String(c.type || "general"),
        });
      }
    }
  } catch (e) {
    console.error("AI failed:", e?.message || e);
    return;
  }

  if (!comments.length) {
    console.log("No issues found");
    return;
  }

  // ---- Deduplicate by path + line + comment ----
  const seen = new Set();
  comments = comments.filter((c) => {
    const key = `${c.path}:${c.line}:${c.body.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ---- Sort for stable output ----
  comments.sort((a, b) => {
    if (a.path === b.path) return a.line - b.line;
    return a.path.localeCompare(b.path);
  });

  const clean = comments.map(({ path, line, side, body }) => ({
    path,
    line,
    side,
    body,
  }));

  // ---- Send to GitHub in chunks ----
  const chunkSize = 30;
  let posted = 0;

  for (let i = 0; i < clean.length; i += chunkSize) {
    const batch = clean.slice(i, i + chunkSize);

    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/reviews`,
      {
        method: "POST",
        headers: ghHeaders,
        body: JSON.stringify({
          commit_id,
          event: "COMMENT",
          comments: batch,
        }),
      }
    );

    const data = await safeJson(res);

    if (!res.ok) {
      console.error("GitHub API ERROR:", data);
      continue;
    }

    posted += batch.length;
  }

  console.log(`Posted ${posted} comments`);
}

async function safeJson(res) {
  try {
    return await res.json();
  } catch {
    try {
      return await res.text();
    } catch {
      return "Unable to parse response";
    }
  }
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
