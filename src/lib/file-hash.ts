export async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export function shouldHashForSrt(file: File): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith('.srt') || file.type === 'application/x-subrip';
}
