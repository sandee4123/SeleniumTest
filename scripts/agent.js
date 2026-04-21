const { context, getOctokit } = require("@actions/github");
const { GoogleGenerativeAI } = require("@google/generative-ai");

async function run() {
  const octokit = getOctokit(process.env.GITHUB_TOKEN);

  const { owner, repo } = context.repo;
  const pull_number = context.issue.number;

  // 1. Get changed files with patches
  const { data: files } = await octokit.rest.pulls.listFiles({
    owner,
    repo,
    pull_number,
  });

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

  let comments = [];

  for (const file of files) {
    if (!file.patch) continue;

    // Skip junk files
    if (
      file.filename.includes("package-lock.json") ||
      file.filename.includes("node_modules")
    ) continue;

    const prompt = `
You are a strict senior code reviewer.

Return ONLY valid JSON in this format:
[
  {
    "line": <line_number_in_patch>,
    "comment": "issue"
  }
]

Rules:
- Only real issues
- No praise
- No explanations outside JSON

File: ${file.filename}

Patch:
${file.patch}
    `;

    try {
      const result = await model.generateContent(prompt);
      const text = (await result.response).text();

      const parsed = JSON.parse(text);

      for (const c of parsed) {
        comments.push({
          path: file.filename,
          line: c.line,
          body: c.comment,
        });
      }
    } catch (e) {
      console.log("Failed parsing for file:", file.filename);
    }
  }

  if (comments.length === 0) {
    console.log("No issues found");
    return;
  }

  // 2. Post inline review
  await octokit.rest.pulls.createReview({
    owner,
    repo,
    pull_number,
    event: "COMMENT",
    comments: comments.slice(0, 30), // GitHub limit safety
  });

  console.log("Posted review with", comments.length, "comments");
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
