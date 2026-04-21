const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const [owner, repoName] = repo.split("/");

  const prMatch = process.env.GITHUB_REF.match(/refs\/pull\/(\d+)\//);
  if (!prMatch) return;

  const pull_number = prMatch[1];

  // ---- PR details (commit_id required for position) ----
  const prRes = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );
  const prData = await prRes.json();
  const commit_id = prData.head.sha;

  // ---- PR files ----
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/files`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  const files = await res.json();

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

  const combinedPatch = reviewFiles
    .map((f) => `FILE: ${f.filename}\n${f.patch}`)
    .join("\n\n")
    .slice(0, 6000);

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

  // ---- STRICT PROMPT (code-snippet anchoring) ----
  const prompt = `
You are a strict senior code reviewer.

Return ONLY JSON:
[
  {
    "file": "filename",
    "code": "exact code snippet from patch",
    "type": "issue_category",
    "comment": "issue"
  }
]

Rules:
- "code" MUST be an exact substring from the patch
- NEVER invent code
- ONLY refer to lines present in the patch
- DO NOT repeat issues
- Be concise
- No explanation outside JSON

Code:
${combinedPatch}
`;

  // ---- Gemini fallback (valid models only) ----
  async function callGemini(genAI, prompt) {
    const models = ["gemini-2.5-flash", "gemini-2.5-flash-lite"];

    for (const name of models) {
      try {
        console.log("Trying:", name);
        const model = genAI.getGenerativeModel({ model: name });
        const res = await model.generateContent(prompt);
        const text = res.response.text();
        if (text && text.trim()) return text;
      } catch (e) {
        const msg = e.message || "";
        if (msg.includes("429") || msg.includes("503")) continue;
        throw e;
      }
    }

    throw new Error("All models failed");
  }

  // ---- Safe JSON parse ----
  function parseJSON(text) {
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {}
      }
      return [];
    }
  }

  // ---- Build diff map (exact GitHub positions) ----
  function buildDiffMap(patch) {
    const lines = patch.split("\n");
    let pos = 0;

    const map = []; // index → diff position or null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@")
      ) {
        map.push(null);
        continue;
      }

      pos++;
      map.push(pos);
    }

    return { lines, map };
  }

  // ---- Exact code → position mapping ----
  function findExactPosition(patchMap, code) {
    const { lines, map } = patchMap;

    const target = code.trim();

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];

      if (!map[i]) continue;

      const clean = raw.replace(/^[+-]/, "").trim();

      if (!clean) continue;

      if (target.includes(clean) || clean.includes(target)) {
        return map[i];
      }
    }

    return null;
  }

  let comments = [];

  try {
    const text = await callGemini(genAI, prompt);
    const parsed = parseJSON(text);

    for (const file of reviewFiles) {
      const patchMap = buildDiffMap(file.patch);

      for (const c of parsed) {
        if (!c.comment || !c.code) continue;
        if (c.file && !file.filename.endsWith(c.file)) continue;

        let position = findExactPosition(patchMap, c.code);

        // fallback (very rare)
        if (!position) {
          console.log("Fallback for:", c.code);
          position = 1;
        }

        comments.push({
          path: file.filename,
          position,
          body: c.comment,
          _type: c.type || "general",
        });
      }
    }
  } catch (e) {
    console.error("AI failed:", e.message || e);
    return;
  }

  if (!comments.length) {
    console.log("No issues found");
    return;
  }

  // ---- Deduplicate ----
  const seen = new Set();
  comments = comments.filter((c) => {
    const key = `${c.path}:${c._type}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ---- Sort ----
  comments.sort((a, b) => {
    if (a.path === b.path) return a.position - b.position;
    return a.path.localeCompare(b.path);
  });

  // ---- Clean payload ----
  const clean = comments.map(({ path, position, body }) => ({
    path,
    position,
    body,
  }));

  // ---- Post to GitHub ----
  const chunkSize = 30;

  for (let i = 0; i < clean.length; i += chunkSize) {
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/pulls/${pull_number}/reviews`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        body: JSON.stringify({
          commit_id,
          event: "COMMENT",
          comments: clean.slice(i, i + chunkSize),
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error("GitHub API ERROR:", data);
    }
  }

  console.log(`Posted ${clean.length} comments`);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(1);
});
