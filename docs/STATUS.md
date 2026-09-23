# Status

Started: 2026-09-23 13:43 Asia/Almaty. Deadline corrected by user: 18:00 Asia/Almaty.

Current step: a per-client follow-up chat works through the Streamlit interface, using the selected node's computed context, current brief and the last six question/answer pairs. Histories are isolated by GID and reset on input/config changes. Failed questions are retained for manual retry; missing credentials disable only the chat.

Verified: twenty-two tests pass (latest run: 7.75 seconds). Chat tests cover actual graph context including an isolate, bounded history, invalid evidence/GID/numeric output, consecutive questions, node switching, clearing, failure/retry, changed uploaded data and absent credentials. A live browser dialogue completed two consecutive questions for a synthetic coordinator node, including a clarification of the preceding answer. Calculated evidence values and a permanent hypothesis disclaimer are visible; the desktop chat input was checked for overlap.

Previous verified milestones: a fresh CLI run produced 2248 roles, 91 clusters and top-50; all three CSVs matched the tracked exports byte-for-byte. A control input shifted transaction dates to August and increased one transaction and its matching edge amount; all three regenerated CSVs differed from the baseline. Streamlit AppTest confirmed the August period in the uploaded-data UI and exercised incomplete/corrupted uploads plus success and timeout paths for the optional AI brief with a simulated provider. The live browser exercised calculation, coordinator and distributor lookup, the depth-4 warning, an unknown GID, all three CSV download buttons, visible evidence labels, and one successful real AI brief for a synthetic gid. The key is stored only in ignored local `.env`, not in tracked `.env.example`. Ollama has no local models.

Remaining AI risk: schema and reference validation do not validate every semantic claim. Live testing exposed overconfident wording and a number paraphrased incorrectly in words; the prompt was tightened and a deterministic disclaimer added, but model interpretations still require analyst review. There are no labeled cases proving role accuracy. Chat is limited to the selected node and up to ten immediate neighbors, not an autonomous investigation of the whole graph.

Next: keep the demonstrated build stable and recheck Git, tests, and the live demo before the 18:00 deadline.
