# Collector Setup

## Browser Extension

Load the unpacked extension from [collectors/browser-extension](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/collectors/browser-extension>).

Configure:

- ingestion webhook URL
- source token
- session label
- user label
- capture interval

The extension captures live browser tabs from the current window and can send them automatically on an interval or manually from the popup.

## Windows Collector

Use [capture-session.ps1](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/collectors/windows/capture-session.ps1>) to gather:

- clipboard text
- recent PowerShell history
- recent file activity in a workspace
- git branch and status
- note file excerpts

Typical usage:

```powershell
.\collectors\windows\capture-session.ps1 `
  -IngestionUrl "http://localhost:5678/webhook/intent-resurrection-engine/ingest" `
  -SourceToken "<token>" `
  -WorkspacePath "D:\Work\platform-ops" `
  -NotesPath "D:\Work\platform-ops\notes.md"
```

To automate that capture, use [register-scheduled-capture.ps1](</D:/Imp Docs/AdvanceDev/Hackathon Projects/Cherry Network/collectors/windows/register-scheduled-capture.ps1>).
