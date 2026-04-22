async function run() {
  const token = process.env.GITHUB_TOKEN;
  const repo = process.env.GITHUB_REPOSITORY;
  const ref = process.env.GITHUB_REF || "";

  if (!token || !repo) {
    console.error("Missing required env vars: GITHUB_TOKEN, GITHUB_REPOSITORY");
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

Review priorities (highest to lower):
1) Correctness / bugs
2) Security and reliability risks
3) Maintainability and readability
4) Test automation best practices

Code:
${promptPatch}
`;

  let aiText;
  try {
    aiText = await callGitHubModel(prompt, token);
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
    existing.map((c) => `${c.path || c?.original_path || ""}:${c.line || c.original_line || ""}:${normalizeText(c.body)}`)
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

async function callGitHubModel(prompt, token) {
  const models = ["gpt-4o-mini", "gpt-4o"];

  for (const model of models) {
    try {
      console.log(`Trying model: ${model}`);

      const res = await fetch("https://models.inference.ai.azure.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a strict code reviewer." },
            { role: "user", content: prompt }
          ],
          temperature: 0.2
        })
      });

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content;

      if (text && text.trim()) return text;

    } catch (e) {
      const msg = String(e?.message || "");
      if (msg.includes("429") || msg.includes("503")) continue;
      throw e;
    }
  }

  throw new Error("All GitHub models failed");
}
