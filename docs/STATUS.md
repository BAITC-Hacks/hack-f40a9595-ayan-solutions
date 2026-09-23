# Status

Started: 2026-09-23 13:43 Asia/Almaty. Deadline corrected by user: 18:00 Asia/Almaty.

Current step: the UI period follows actual transaction dates, and a changed valid input has been rerun through the pipeline. A local `.env` file can now supply the optional AI key; the live provider remains unverified until a key is available.

Verified: fourteen tests pass. A fresh CLI run produced 2248 roles, 91 clusters and top-50; all three CSVs match the tracked exports byte-for-byte. A control input shifted transaction dates to August and increased one transaction and its matching edge amount; all three regenerated CSVs differ from the baseline. Streamlit AppTest confirmed the August period in the uploaded-data UI and exercised incomplete/corrupted uploads plus success and timeout paths for the optional AI brief with a simulated provider. The live browser previously exercised calculation, coordinator and distributor lookup, the depth-4 warning, an unknown GID, all three CSV download buttons, and visible evidence labels. The server currently responds with HTTP 200. No OPENAI_API_KEY or `.env` is configured; actual OpenAI connectivity remains unverified. Ollama has no local models.

Next: run one real AI brief through the UI when the key is supplied, then keep the demonstrated build stable and recheck Git, tests, and the live demo before the 18:00 deadline.
