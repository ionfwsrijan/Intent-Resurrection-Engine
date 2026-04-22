# Intent Resurrection Engine Presentation Guide

## 1. Title Slide

- **Project name:** Intent Resurrection Engine
- **Tagline:** Reconstructing abandoned user intent from live digital traces
- **One-line pitch:** A real n8n-orchestrated system that helps users recover what they were trying to do before they got interrupted.

## 2. Problem Statement

- People abandon tasks all the time because of interruptions, multitasking, context switching, fatigue, or unexpected notifications.
- When they come back, they do not just forget a file or a tab. They lose the **intent** behind the work.
- Existing tools show raw history, but they do not explain:
  - what the user was trying to accomplish
  - why that conclusion makes sense
  - what they should do next

### Strong problem framing line

`Current systems remember actions. Our system reconstructs purpose.`

## 3. Why This Project Is Unique

- Most systems classify visible content.
- This project predicts the **invisible goal behind incomplete behavior**.
- It combines:
  - workflow automation with n8n
  - live collection from real browser and Windows sources
  - backend normalization and persistence
  - intent scoring with evidence and recovery steps
- It is not a toy chatbot. It is an operational recovery pipeline.

### Strong uniqueness line

`This is not task tracking. It is intent recovery.`

## 4. Solution Overview

Intent Resurrection Engine ingests live digital traces, sanitizes them, scores the most likely abandoned intent, and returns recovery guidance.

### Input signals

- browser tabs
- recent file activity
- clipboard fragments
- PowerShell history
- draft notes
- git branch and git status
- idle and focus metadata

### Output

- predicted intent
- confidence score
- evidence
- privacy summary
- suggested next steps
- stale-session monitoring for follow-up notifications

## 5. Architecture Slide

### Suggested diagram

`Collectors -> n8n Intake Workflow -> Backend API -> SQLite Store -> Analysis Engine -> Dashboard`

### Real system components

- **Frontend dashboard**
  - workspace creation
  - source token generation
  - session inspection
  - analysis detail
- **Backend**
  - HTTP API
  - persistence
  - normalization
  - analysis engine
- **Collectors**
  - Windows PowerShell collector
  - browser extension
- **n8n**
  - intake orchestration
  - stale-session monitoring

## 6. Live Workflow Slide

### Demo flow

1. Create a workspace
2. Register a source
3. Collector sends a live snapshot to n8n
4. n8n stores the session in the backend
5. Backend runs analysis
6. Dashboard shows the predicted intent and evidence
7. If the session becomes stale, n8n can trigger a notification

### Strong explanation line

`The system turns messy digital residue into a structured recovery plan.`

## 7. What Makes It Real

- Uses real local browser and Windows traces
- Uses real source tokens and hashed token storage
- Uses a real database
- Uses actual n8n workflows, not pseudo-logic
- Supports scheduled collection
- Supports privacy redaction before analysis
- Supports session lifecycle actions like rerun, resolve, and delete

## 8. Machine Intelligence Layer

### Current analysis strategy

- sanitize traces
- flatten multi-source evidence
- score each intent using:
  - keyword matches
  - phrase matches
  - field-specific weights
  - behavior boosts
  - workspace and file-context boosts
- generate:
  - top predicted intent
  - alternatives
  - confidence
  - evidence
  - next-step guidance

### Intent classes currently supported

- Client pitch and pricing preparation
- Authentication or token debugging
- Literature review or research synthesis
- Release triage or incident response
- Product planning or roadmap shaping
- Job application packaging

## 9. Privacy and Safety Slide

- source tokens are stored hashed
- secrets are redacted before storage and analysis
- notification webhooks are opt-in per workspace
- privacy summary is shown in the dashboard
- the system is built to avoid exposing raw credentials in evidence output

### Strong privacy line

`The system remembers work context, not private secrets.`

## 10. Key Engineering Challenges

### Challenge 1: Workflow reliability

- n8n code nodes initially failed because `process` and `fetch` were not available in that environment
- fixed by switching to n8n-compatible HTTP helpers

### Challenge 2: Session identity

- Windows collector originally created date-based sessions
- changed to stable workspace-based session IDs so one workspace now maps to one persistent session

### Challenge 3: Dashboard usability

- session selection and deletion now work reliably
- stale or useless sessions can be removed cleanly

### Challenge 4: Prediction quality

- raw terminal history and random browser tabs created noise
- scoring was improved by:
  - stricter keyword matching
  - down-weighting generic commands
  - stronger file/path intent signals
  - filtering noisy entertainment tabs in browser captures

## 11. Innovation / Impact Slide

### Human impact

- helps users resume work faster after interruptions
- supports memory recovery
- useful for ADHD-friendly workflows
- improves productivity in research, engineering, and documentation tasks

### Product directions

- personal productivity assistant
- enterprise interrupted-work recovery
- developer workflow memory system
- research context assistant

## 12. Demo Script

### Suggested demo sequence

1. Show the dashboard with a real workspace
2. Trigger the Windows collector or browser extension
3. Refresh the dashboard
4. Open the new session
5. Show:
   - predicted intent
   - evidence
   - next steps
   - sanitized snapshot preview
6. Explain how stale-session monitoring can notify later

### Strong demo line

`Instead of asking the user to remember where they left off, the system reconstructs it for them.`

## 13. Tech Stack Slide

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js
- **Database:** SQLite
- **Automation:** n8n
- **Collectors:** PowerShell, browser extension APIs
- **Containerization:** Docker Compose

## 14. Future Scope Slide

- replace heuristics with embedding-based or classifier-based ranking
- support richer behavior signals
- add richer browser relevance modeling
- add Slack, Discord, or email recovery notifications
- build user-specific personalization over time
- add streak-based session segmentation instead of simple source-based grouping

## 15. Closing Slide

### Final message

Intent Resurrection Engine is a real system for recovering abandoned work from live traces. It does not just log what happened. It reconstructs why the user was working and how they can resume effectively.

### Final closing line

`From activity history to intent recovery.`

## Quick 8-Slide Version

If you need a shorter deck, use this:

1. Title + one-line pitch
2. Problem
3. Why this is unique
4. Architecture
5. Live workflow
6. Demo screenshots
7. Privacy + impact
8. Future scope + closing

## Best Screenshots To Use

- dashboard showing recent sessions
- selected session detail with predicted intent, evidence, and next steps
- n8n intake workflow
- browser extension options or popup
- architecture/workflow diagram

## One-Sentence Elevator Pitch

`Intent Resurrection Engine is a live context recovery system that reconstructs what a user was trying to do from partial digital traces and helps them resume work quickly.`
