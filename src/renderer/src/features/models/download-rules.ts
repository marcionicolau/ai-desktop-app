// feature 026 (FR-013): the download rules the server enforces
// (src/bun/models/download.ts), mirrored so the form can explain a bad link
// or file name before the round trip. Pure, so a test pins it to the
// server's own regex.
export const HF_GGUF_RE =
  /^https:\/\/huggingface\.co\/[^/]+\/[^/]+\/resolve\/[^\s/]+\/[^\s/]+\.gguf(?:\?[^\s]*)?$/;

export function defaultFileName(url: string): string {
  try {
    const tail = new URL(url).pathname.split("/").pop() ?? "";
    return tail.endsWith(".gguf") ? tail : "";
  } catch {
    return "";
  }
}

export interface DownloadErrors {
  url?: string;
  fileName?: string;
}

// empty fields are not errors (nothing typed yet) — the caller disables the
// button until there is something valid to send
export function validateDownload(url: string, fileName: string): DownloadErrors {
  const out: DownloadErrors = {};
  const u = url.trim();
  if (u !== "" && !HF_GGUF_RE.test(u)) {
    out.url = "Use a link like https://huggingface.co/<org>/<repo>/resolve/<revision>/<file>.gguf";
  }
  const f = fileName.trim();
  if (f !== "") {
    if (f.includes("/") || f.includes("\\")) out.fileName = "Use just a file name, without folders";
    else if (!f.endsWith(".gguf")) out.fileName = "The file name must end in .gguf";
  }
  return out;
}
