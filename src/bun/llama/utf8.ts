// Streaming UTF-8 decoder for token pieces. llama.cpp pieces are raw
// bytes and a multi-byte character (accents, CJK, emoji) can be split
// across two tokens; decoding each piece with a fresh TextDecoder turns
// the halves into U+FFFD ("�"). One stateful decoder per generation holds
// the incomplete tail until the next piece completes it.
export class Utf8Stream {
  private readonly decoder = new TextDecoder("utf-8");

  // returns the text that is complete so far ("" while mid-character)
  push(bytes: Uint8Array): string {
    return this.decoder.decode(bytes, { stream: true });
  }

  // end of generation: emits whatever is left (a genuinely truncated
  // sequence becomes U+FFFD, which is correct for invalid input)
  flush(): string {
    return this.decoder.decode();
  }
}
