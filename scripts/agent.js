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
    console.error("Invalid GITHUB_REPOSITORY format (expected owner/repo)");
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
    console.error("Failed to fetch PR details:", await safeBody(prRes));
    return;
  }

  const prData = await prRes.json();
  const commit_id = prData?.head?.sha;
  if (!commit_id) {
    console.error("Missing commit SHA in PR details");
    return;
  }

  // ---- PR files ----
  const filesRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/files?per_page=100`,
    { headers: ghHeaders }
  );
  if (!filesRes.ok) {
    console.error("Failed to fetch PR files:", await safeBody(filesRes));
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

  // Build structured patch with absolute patch line numbers per file
  const fileContexts = reviewFiles.map((f) => {
    const parsed = parsePatchWithAbsoluteLines(f.patch);
    return {
      filename: f.filename,
      patch: f.patch,
      parsed,
    };
  });

  // ---- Prompt payload with line anchors ----
  // Each patch line is prefixed as [P<absolutePatchLine>]
  const promptPatch = fileContexts
    .map((fc) => {
      const rendered = fc.parsed.lines
        .map((l) => `[P${l.patchLine}] ${l.raw}`)
        .join("\n");
      return `FILE: ${fc.filename}\n${rendered}`;
    })
    .join("\n\n")
    .slice(0, 16000);

  const prompt = `
You are a strict senior code reviewer.

Return ONLY JSON array:
[
  {
    "file": "exact/path/from_FILE_header",
    "patch_line": number,
    "type": "issue_category",
    "comment": "short actionable issue"
  }
]

Rules:
- patch_line MUST be the numeric P-line from the provided patch (e.g. P37 -> 37).
- Choose ONLY lines that begin with "+" (added lines).
- Do NOT use removed lines ("-"), hunk headers ("@@"), or file metadata lines.
- Only comment on visible code in this patch.
- No duplicates, no hallucinations, concise comments.

Code:
${promptPatch}
`;

  const genAI = new GoogleGenerativeAI(geminiKey);
  const aiText = await callGemini(genAI, prompt);
  const parsed = parseJSON(aiText);

  if (!Array.isArray(parsed) || parsed.length === 0) {
    console.log("No issues found");
    return;
  }

  // Build strict comments: exact patch_line -> exact new-file line (RIGHT)
  let comments = [];

  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    if (!item.comment || typeof item.comment !== "string") continue;

    const requestedFile = String(item.file || "").trim();
    const requestedPatchLine = Number(item.patch_line);

    if (!requestedFile || !Number.isInteger(requestedPatchLine) || requestedPatchLine <= 0) {
      continue;
    }

    const fc = fileContexts.find((x) => x.filename === requestedFile);
    if (!fc) continue;

    const mapped = fc.parsed.byPatchLine.get(requestedPatchLine);
    if (!mapped) continue;

    // Strict: only allow added lines (+) so GitHub RIGHT-side single-line comment is precise
    if (mapped.kind !== "add") continue;
    if (!mapped.newLine || mapped.newLine <= 0) continue;

    comments.push({
      path: fc.filename,
      line: mapped.newLine,
      side: "RIGHT",
      body: item.comment.trim(),
      _type: String(item.type || "general"),
      _patchLine: requestedPatchLine,
    });
  }

  // Dedup by path + line + body
  const seen = new Set();
  comments = comments.filter((c) => {
    const key = `${c.path}:${c.line}:${c.body.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!comments.length) {
    console.log("No valid mappable comments");
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
  body: `[AI Review]: ${body}`,
}));

  // Post in chunks
  const chunkSize = 30;
  let posted = 0;

  for (let i = 0; i < payloadComments.length; i += chunkSize) {
    const batch = payloadComments.slice(i, i + chunkSize);

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

    const body = await safeBody(res);
    if (!res.ok) {
      console.error("GitHub API error:", body);
      continue;
    }

    posted += batch.length;
  }

  console.log(`Posted ${posted} comments`);
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
      old = null;
      neu = newLine;
      newLine++;
    } else if (raw.startsWith("-")) {
      kind = "del";
      old = oldLine;
      neu = null;
      oldLine++;
    } else {
      kind = "context";
      old = oldLine;
      neu = newLine;
      oldLine++;
      newLine++;
    }

    const rec = {
      patchLine,
      raw,
      kind,
      oldLine: old,
      newLine: neu,
    };

    parsedLines.push(rec);
    byPatchLine.set(patchLine, rec);
  }

  return { lines: parsedLines, byPatchLine };
}

async function callGemini(genAI, prompt) {
  const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

  for (const name of models) {
    try {
      console.log(`Trying model: ${name}`);
      const model = genAI.getGenerativeModel({ model: name });
      const res = await model.generateContent(prompt);
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
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) return [];
    try {
      return JSON.parse(m[0]);
    } catch {
      return [];
    }
  }
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
