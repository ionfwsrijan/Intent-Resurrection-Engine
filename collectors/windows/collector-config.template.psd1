@{
  IngestionUrl = "http://localhost:5678/webhook/intent-resurrection-engine/ingest"
  SourceToken = "src_replace_me"
  WorkspacePath = "D:\Work\your-workspace"
  NotesPath = "D:\Work\your-workspace\notes.md"
  UserLabel = "Primary workstation"
IncludeExtensions = "pptx,pdf,docx"
ExcludePatterns = ".git,node_modules,__pycache__,*.db,*.db-wal,*.db-shm,.env,.env.*"
PathRedactionMode = "workspace"
MaskFileNames = $false
PrivateMode = $false
LocalOnlyMode = $false
SkipFileActivity = $false
SkipNotes = $false
SkipGitStatus = $false
SkipAppFocus = $false
}
