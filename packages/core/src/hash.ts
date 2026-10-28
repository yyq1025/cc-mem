// A djb2 hash as Math.abs(hash).toString(36), the suffix Claude Code adds to
// project directory names over 200 characters (checked against a real
// Claude Code 2.1.311 session in a 268-character directory).
export function djb2Hash(s: string): string {
  let hash = 0
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}
