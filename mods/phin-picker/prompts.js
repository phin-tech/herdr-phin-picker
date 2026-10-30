// The prompts that come with the picker. `for` names the rows one suits: a
// target kind, or "local" for a checkout or branch with no link behind it. With
// no `for` it suits every row. A file in the prompts folder replaces one of
// these by name.

export const DEFAULT_PROMPTS = [
  {
    name: "orient",
    text: `Read this repository and get your bearings: what it does, how it's laid out, how to build and test it, and what's in progress on this branch. Then give me a short summary and stop. Don't change anything.`,
  },
  {
    name: "plan",
    for: ["local", "github_issue", "linear"],
    text: `Before changing anything, read the code this work touches and write a plan: what you'd change, in what order, and what could go wrong. List anything you need me to decide. Then stop and wait for me.`,
  },
  {
    name: "fix-tests",
    for: ["local"],
    text: `Run the test suite. For each failure, find the root cause and fix it in the code, not by weakening the test. If a test itself is wrong, say why before changing it. Finish by running the full suite again and report the result.`,
  },
  {
    name: "review-branch",
    for: ["local"],
    text: `Review this branch's changes against its base branch. Look for bugs, missing edge cases and missing tests, and rank what you find by severity with file and line. Only report problems you've confirmed by reading the code. Don't change anything.`,
  },
  {
    name: "review",
    for: ["github_pr"],
    text: `Review PR #{{.Number}}: {{.Title}}
{{.URL}}

Read the description and the diff with gh, then read the surrounding code. Look for bugs, missing edge cases and missing tests, and check that it does what the description says. Rank findings by severity with file and line, and only report what you've confirmed. Don't change anything or post to GitHub.`,
  },
  {
    name: "address-comments",
    for: ["github_pr"],
    text: `Read the unresolved review comments on PR #{{.Number}} with gh: {{.URL}}

Fix the ones that are right. For any you disagree with, leave the code alone and tell me why. Commit the fixes on this branch, but don't push or reply on GitHub. Finish with a list of what you did with each comment.`,
  },
  {
    name: "fix-ci",
    for: ["github_pr"],
    text: `Check the failing CI runs for PR #{{.Number}} with gh: {{.URL}}

Read the logs, find the root cause and fix it. If a failure is unrelated to this PR or looks flaky, say so rather than working around it. Run the same check locally where you can, and commit the fix on this branch, but don't push.`,
  },
  {
    name: "implement",
    for: ["github_issue", "linear"],
    text: `Work this ticket: {{.URL}}

Read it in full, including the comments, and read the code it touches. Implement it with tests, keeping the change to what the ticket asks for. If it's ambiguous, stop and ask. Run the tests and commit on this branch, but don't push.`,
  },
  {
    name: "investigate",
    for: ["github_issue", "linear"],
    text: `Investigate this ticket without fixing it: {{.URL}}

Reproduce the problem if you can, find the root cause, and tell me what you found with file and line, what a fix would involve, and how sure you are. Don't change anything.`,
  },
];

export function promptsFor(row, prompts) {
  const kind = row.target?.kind ?? "local";
  return prompts.filter((p) => !p.for || p.for.includes(kind));
}
