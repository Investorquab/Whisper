/** Stable error codes. Test `code`, never `message`. */
export type WhisperErrorCode =
  | "INVALID_ADDRESS"
  | "NO_KEY"
  | "INVALID_PAYLOAD"
  | "MESSAGE_TOO_LONG"
  | "DECRYPT_FAILED"
  | "INVALID_CARD"
  | "INVALID_LINK"
  | "INVALID_SIGNATURE"
  | "KEY_MISMATCH"
  | "NO_PROVIDER"
  | "WRONG_NETWORK"
  | "REQUEST_ONLY"
  | "SENDER_BLOCKED"
  | "FEE_REQUIRED"
  | "TRANSFER_FAILED"
  | "USER_REJECTED"
  | "NETWORK";

export class WhisperError extends Error {
  readonly code: WhisperErrorCode;
  override readonly cause?: unknown;

  constructor(code: WhisperErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "WhisperError";
    this.code = code;
    this.cause = cause;
  }
}

export function isWhisperError(error: unknown, code?: WhisperErrorCode): error is WhisperError {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === "WhisperError" &&
    (code === undefined || (error as { code?: unknown }).code === code)
  );
}
