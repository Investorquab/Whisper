// Writes the WhisperMailbox ABI into the SDK as a typed constant. Run after `forge build`.
import { readFileSync, writeFileSync } from "node:fs";

const artifact = JSON.parse(readFileSync(new URL("../out/WhisperMailbox.sol/WhisperMailbox.json", import.meta.url), "utf8"));
const target = new URL("../../packages/sdk/src/abi.ts", import.meta.url);
const body = `// Generated from contracts/src/WhisperMailbox.sol by contracts/script/export-abi.mjs. Do not edit.\nexport const whisperMailboxAbi = ${JSON.stringify(artifact.abi, null, 2)} as const;\n`;
writeFileSync(target, body);
console.log(`wrote ${artifact.abi.length} ABI entries to packages/sdk/src/abi.ts`);
