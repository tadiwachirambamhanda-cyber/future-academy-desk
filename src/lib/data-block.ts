// Parent text goes to Claude inside labelled blocks such as <parent_message>. Angle brackets are
// escaped so a message can never close a block or open a new one, whatever it contains.
export function escapeForDataBlock(text: string): string {
  return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
